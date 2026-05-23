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
      await blockAdsAndTrackers(page);
      const searchUrl = `${this.BASE_URL}/?term=${encodeURIComponent(query)}&format=abstract`;
      await safeGoto(page, searchUrl);

      const elements = await page.locator(this.SELECTORS.title).all();

      for (const el of elements) {
        if (results.length >= maxResults) break;
        const title = await el.textContent();
        if (title) {
          results.push({
            title: title.trim(),
            authors: [],
            source: this.sourceName,
            url: this.BASE_URL,
          });
        }
      }

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
