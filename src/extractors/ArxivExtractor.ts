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

  get extractorVersion(): string {
    return 'v1.0.0';
  }

  async search(context: BrowserContext, query: string, maxResults = 20, signal?: AbortSignal): Promise<PaperMetadata[]> {
    const page = await context.newPage();
    
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
      await blockAdsAndTrackers(page);

      const searchUrl = `${this.BASE_URL}/search/?searchtype=all&query=${encodeURIComponent(query)}`;
      await safeGoto(page, searchUrl, 3, 'domcontentloaded');
      
      // Wait for content to stabilize
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      logger.info({
        url: page.url(),
        title: await page.title().catch(()=>'')
      }, 'Arxiv loaded');

      const resultCards = await page.locator(this.SELECTORS.results).all();
      logger.debug({ count: resultCards.length }, 'ArXiv: Found result cards');

      for (const card of resultCards) {
        if (results.length >= maxResults) break;

        const titleEl = card.locator(this.SELECTORS.title);
        const authorsEl = card.locator(this.SELECTORS.authors);
        const abstractEl = card.locator(this.SELECTORS.abstract);
        const linkEl = card.locator(this.SELECTORS.arxivId);

        const title = await titleEl.first().textContent().catch(() => null);
        if (!title) continue;

        const authorsText = await authorsEl.first().textContent().catch(() => '');
        const abstract = await abstractEl.first().textContent().catch(() => undefined);
        const href = await linkEl.first().getAttribute('href').catch((err) => {
          logger.warn({ err: err.message }, 'Arxiv href extraction failed');
          return null;
        });
        const url = href ? (href.startsWith('http') ? href : `https://arxiv.org${href}`) : `${this.BASE_URL}/search/`;

        logger.info({ title: title.trim(), paperUrl: url }, 'Arxiv parsed');

        results.push({
          title: title.trim(),
          authors: authorsText
            ? authorsText.replace('Authors:', '').split(',').map(a => a.trim()).filter(Boolean)
            : [],
          abstract: abstract?.trim(),
          source: this.sourceName,
          url,
          extractorVersion: this.extractorVersion,
          originatingQuery: query,
        });
      }

      logger.info({ count: results.length, query }, 'ArXiv extraction complete');
      return results;
    } finally {
      if (signal) signal.removeEventListener('abort', abortHandler);
      await page.close().catch(() => {});
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
