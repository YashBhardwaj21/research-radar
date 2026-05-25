import { BrowserContext } from 'playwright';
import { BaseExtractor, PaperMetadata } from './BaseExtractor';
import { safeGoto } from '../browser/navigation';
import { blockAdsAndTrackers } from '../browser/RequestFilter';
import { logger } from '../core/logger';
import { debugSnapshot } from '../utils/debugExtractor';

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

  get extractorVersion(): string {
    return 'v1.0.0';
  }

  async search(context: BrowserContext, query: string, maxResults = 20, signal?: AbortSignal): Promise<PaperMetadata[]> {
    const start = Date.now();
    logger.info({ query, maxResults, stage: 'QUERY' }, 'START');

    const page = await context.newPage();
    logger.info({ extractor: this.sourceName, stage: 'PAGE_CREATED' });
    
    const abortHandler = () => {
      page.close().catch(() => {});
    };
    if (signal) {
      if (signal.aborted) {
        await page.close().catch(() => {});
        throw new Error('AbortError');
      }
      signal.addEventListener('abort', abortHandler);
    }

    const results: PaperMetadata[] = [];

    try {
      const searchUrl = `${this.BASE_URL}/?term=${encodeURIComponent(query)}&format=abstract`;
      logger.info({ url: searchUrl, stage: 'URL_BUILT' });

      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 180000 });
      logger.info({ url: page.url(), title: await page.title().catch(()=>''), stage: 'NAVIGATION_OK' });

      await page.waitForLoadState('networkidle').catch(() => {});
      const cards = page.locator('article.full-docsum');
      await cards.first().waitFor({ timeout: 10000 }).catch(() => null);

      const rawPapers = await page.$$eval(
        'div.search-results-chunk article',
        articles => articles.map(article => {
            const titleNode = article.querySelector('a[data-ga-category="result_click"]');
            const abstractNode = article.querySelector('.full-view-snippet');
            const journalNode = article.querySelector('.docsum-journal-citation');
            const authorNode = article.querySelector('.docsum-authors');
            const pmid = article.getAttribute("data-article-id");

            const title = (titleNode as HTMLElement)?.innerText?.trim() || null;
            const relative = titleNode?.getAttribute("href");
            const url = relative ? `https://pubmed.ncbi.nlm.nih.gov${relative}` : null;

            let doi = null;
            const links = [...article.querySelectorAll("a")];
            const doiLink = links.find(x => x.href?.includes("doi.org"));
            if (doiLink) {
                doi = doiLink.href.replace("https://doi.org/", "");
            }

            let year = null;
            const citation = (journalNode as HTMLElement)?.innerText;
            const match = citation?.match(/(19|20)\d{2}/);
            if (match) year = parseInt(match[0]);

            const authors = (authorNode as HTMLElement)?.innerText?.split(",")
                .map(x => x.trim())
                .filter(Boolean) || [];

            return {
                title,
                abstract: (abstractNode as HTMLElement)?.innerText?.trim() || null,
                doi,
                url,
                year,
                source: "pubmed",
                authors,
                pmid
            };
        })
      );

      logger.info({ count: rawPapers.length, stage: 'RESULT_COUNT' });

      if (rawPapers.length === 0) {
        await debugSnapshot(page, this.sourceName, 'zero-results');
        return [];
      }

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
            let extractedAbstract = await detail.locator('.abstract-content.selected').innerText().catch(() => null);
            if (!extractedAbstract) {
                extractedAbstract = await detail.locator('.abstract').innerText().catch(() => null);
            }
            if (extractedAbstract) {
                fullAbstract = extractedAbstract.replace(/\s+/g, ' ').trim();
            }

            // Author extraction
            const extractedAuthors = await detail.locator('.authors-list .full-name').allInnerTexts().catch(() => []);
            if (extractedAuthors.length > 0) {
                fullAuthors = [...new Set(
                    extractedAuthors
                        .map(a => a.replace(/\s+/g, ' ').replace(/┬á/g, '').trim())
                        .filter(Boolean)
                )];
            }

            // Year extraction
            const citation = await detail.locator('.cit').innerText().catch(() => '');
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
            url: p.url,
            extractorVersion: this.extractorVersion,
            originatingQuery: query,
          };

          logger.info({
            title: paperObj.title,
            authors: paperObj.authors,
            url: paperObj.url,
            hasAbstract: !!paperObj.abstract,
            stage: 'PARSED'
          });

          results.push(paperObj);
        })
      );

      logger.info({ stage: 'FINISHED', count: results.length, elapsed: Date.now() - start });
      return results;
    } catch (err: any) {
      await debugSnapshot(page, this.sourceName, 'error');
      logger.error({ err: err.message, stack: err.stack, url: page.url() }, 'EXTRACTOR_FAILED');
      throw err;
    } finally {
      logger.info({ stage: 'PAGE_CLOSED' });
      if (signal) signal.removeEventListener('abort', abortHandler);
      await page.close().catch(() => {});
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
