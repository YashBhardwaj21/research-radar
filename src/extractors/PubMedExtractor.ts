import { BrowserContext } from 'playwright';
import { BaseExtractor, PaperMetadata } from './BaseExtractor';
import { safeGoto } from '../browser/navigation';
import { blockAdsAndTrackers } from '../browser/RequestFilter';
import { logger } from '../core/logger';

export class PubMedExtractor extends BaseExtractor {
  private readonly BASE_URL = 'https://pubmed.ncbi.nlm.nih.gov';

  private readonly SELECTORS = {
    title: '.docsum-title',
    authors: '.docsum-authors',
    abstract: '#abstract',
    doi: '.identifier.doi .id-link',
  };

  get sourceName(): string {
    return 'pubmed';
  }

  async search(context: BrowserContext, query: string, maxResults = 20): Promise<PaperMetadata[]> {
    const page = await context.newPage();
    const results: PaperMetadata[] = [];

    try {
      const searchUrl = `${this.BASE_URL}/?term=${encodeURIComponent(query)}&format=abstract`;
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 180000 });

      try {
        await page.waitForSelector('article', { timeout: 15000 });
      } catch (e) {
        logger.warn('Timeout waiting for PubMed results container');
      }

      const rawPapers = await page.$$eval(
        'div.search-results-chunk article',
        articles => articles.map(article => {
            const titleNode = article.querySelector('a[data-ga-category="result_click"]');
            const abstractNode = article.querySelector('.full-view-snippet');
            const journalNode = article.querySelector('.docsum-journal-citation');
            const authorNode = article.querySelector('.docsum-authors');
            const pmid = article.getAttribute("data-article-id");

            const title = titleNode?.textContent?.trim() || null;
            const relative = titleNode?.getAttribute("href");
            const url = relative ? `https://pubmed.ncbi.nlm.nih.gov${relative}` : null;

            let doi = null;
            const links = [...article.querySelectorAll("a")];
            const doiLink = links.find(x => x.href?.includes("doi.org"));
            if (doiLink) {
                doi = doiLink.href.replace("https://doi.org/", "");
            }

            let year = null;
            const citation = journalNode?.textContent;
            const match = citation?.match(/(19|20)\d{2}/);
            if (match) year = parseInt(match[0]);

            const authors = authorNode?.textContent?.split(",")
                .map(x => x.trim())
                .filter(Boolean) || [];

            return {
                title,
                abstract: abstractNode?.textContent?.trim() || null,
                doi,
                url,
                year,
                source: "pubmed",
                authors,
                pmid
            };
        })
      );

      const topPapers = rawPapers.slice(0, Math.min(5, maxResults));

      await Promise.all(
        topPapers.map(async (p) => {
          if (!p.title || !p.url) return;
          
          const detail = await context.newPage();
          let fullAbstract = p.abstract || undefined;
          let fullAuthors = p.authors || [];
          let fullYear = p.year || undefined;
          
          try {
            await detail.goto(p.url, { waitUntil: "domcontentloaded", timeout: 15000 });
            
            // Abstract extraction
            let extractedAbstract = await detail.locator('.abstract-content.selected').textContent().catch(() => null);
            if (!extractedAbstract) {
                extractedAbstract = await detail.locator('.abstract').textContent().catch(() => null);
            }
            if (extractedAbstract) {
                fullAbstract = extractedAbstract.replace(/\s+/g, ' ').trim();
            }

            // Author extraction
            const extractedAuthors = await detail.locator('.authors-list .full-name').allTextContents().catch(() => []);
            if (extractedAuthors.length > 0) {
                fullAuthors = [...new Set(
                    extractedAuthors
                        .map(a => a.replace(/\s+/g, ' ').replace(/┬á/g, '').trim())
                        .filter(Boolean)
                )];
            }

            // Year extraction
            const citation = await detail.locator('.cit').textContent().catch(() => '');
            if (citation) {
                const yearMatch = citation.match(/\b(19|20)\d{2}\b/);
                if (yearMatch) {
                    fullYear = Number(yearMatch[0]);
                }
            }
          } catch (e) {
            logger.warn({ url: p.url }, 'Failed to extract deep metadata from article page, falling back to search card data');
          } finally {
            await detail.close();
          }

          const paperObj: PaperMetadata = {
            title: p.title,
            authors: fullAuthors,
            abstract: fullAbstract,
            doi: p.doi || undefined,
            year: fullYear,
            source: p.source,
            url: p.url
          };
          logger.info(JSON.stringify(paperObj, null, 2));
          results.push(paperObj);
        })
      );

      logger.info({ count: results.length, query }, 'PubMed extraction complete');
      return results;
    } finally {
      await page.close();
    }
  }

  async extractPaper(context: BrowserContext, url: string): Promise<PaperMetadata> {
    const page = await context.newPage();

    try {
      await blockAdsAndTrackers(page);
      await safeGoto(page, url);

      const title = await page.locator(this.SELECTORS.title).textContent().catch(() => 'Unknown Title');
      const abstract = await page.locator(this.SELECTORS.abstract).textContent().catch(() => undefined);
      const doi = await page.locator(this.SELECTORS.doi).textContent().catch(() => undefined);
      const authorsText = await page.locator(this.SELECTORS.authors).textContent().catch(() => '');

      return {
        title: title?.trim() || 'Unknown Title',
        authors: authorsText ? authorsText.split(',').map(a => a.trim()) : [],
        abstract: abstract?.trim(),
        doi: doi?.trim(),
        source: this.sourceName,
        url,
      };
    } finally {
      await page.close();
    }
  }
}
