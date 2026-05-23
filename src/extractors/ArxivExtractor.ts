import { BrowserContext } from 'playwright';
import { BaseExtractor, PaperMetadata } from './BaseExtractor';
import { safeGoto } from '../browser/navigation';
import { blockAdsAndTrackers } from '../browser/RequestFilter';
import { logger } from '../core/logger';

export class ArxivExtractor extends BaseExtractor {
  private readonly BASE_URL = 'https://arxiv.org';

  private readonly SELECTORS = {
    results: 'li.arxiv-result',
    title: '.title.mathjax',
    authors: '.authors',
    abstract: '.abstract.mathjax',
    arxivId: 'p.list-title a',
  };

  get sourceName(): string {
    return 'arxiv';
  }

  async search(context: BrowserContext, query: string, maxResults = 20): Promise<PaperMetadata[]> {
    const page = await context.newPage();
    const results: PaperMetadata[] = [];

    try {
      await blockAdsAndTrackers(page);

      const searchUrl = `${this.BASE_URL}/search/?searchtype=all&query=${encodeURIComponent(query)}`;
      await safeGoto(page, searchUrl);

      const resultCards = await page.locator(this.SELECTORS.results).all();
      logger.debug({ count: resultCards.length }, 'ArXiv: Found result cards');

      for (const card of resultCards) {
        if (results.length >= maxResults) break;

        const titleEl = card.locator(this.SELECTORS.title);
        const authorsEl = card.locator(this.SELECTORS.authors);
        const abstractEl = card.locator(this.SELECTORS.abstract);
        const linkEl = card.locator(this.SELECTORS.arxivId);

        const title = await titleEl.textContent().catch(() => null);
        if (!title) continue;

        const authorsText = await authorsEl.textContent().catch(() => '');
        const abstract = await abstractEl.textContent().catch(() => undefined);
        const href = await linkEl.getAttribute('href').catch(() => null);
        const url = href ? `https://arxiv.org${href}` : `${this.BASE_URL}/search/`;

        results.push({
          title: title.trim(),
          authors: authorsText
            ? authorsText.replace('Authors:', '').split(',').map(a => a.trim()).filter(Boolean)
            : [],
          abstract: abstract?.trim(),
          source: this.sourceName,
          url,
        });
      }

      logger.info({ count: results.length, query }, 'ArXiv extraction complete');
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

      const title = await page.locator('h1.title.mathjax').textContent().catch(() => 'Unknown Title');
      const authorsText = await page.locator('.authors').textContent().catch(() => '');
      const abstract = await page.locator('blockquote.abstract.mathjax').textContent().catch(() => undefined);

      return {
        title: title?.replace('Title:', '').trim() || 'Unknown Title',
        authors: authorsText ? authorsText.replace('Authors:', '').split(',').map(a => a.trim()) : [],
        abstract: abstract?.replace('Abstract:', '').trim(),
        source: this.sourceName,
        url,
      };
    } finally {
      await page.close();
    }
  }
}
