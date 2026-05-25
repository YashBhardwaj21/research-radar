import { BrowserContext } from 'playwright';
import { BaseExtractor, PaperMetadata } from './BaseExtractor';
import { safeGoto } from '../browser/navigation';
import { blockAdsAndTrackers } from '../browser/RequestFilter';
import { logger } from '../core/logger';
import { debugSnapshot } from '../utils/debugExtractor';

export class ArxivExtractor extends BaseExtractor {
  private readonly BASE_URL = 'https://arxiv.org';

  private readonly SELECTORS = {
    // individual paper cards
    results: 'li.arxiv-result',
    // paper title
    title: 'p.title',
    // author block
    authors: 'p.authors',
    // abstract text
    abstract: 'span.abstract-full',
    // canonical paper link
    absLink: 'p.list-title a[href*="/abs/"]',
    // pdf link
    pdfLink: 'a[href*="/pdf/"]'
  };

  get sourceName(): string {
    return 'arxiv';
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
      await blockAdsAndTrackers(page);

      const searchUrl = `${this.BASE_URL}/search/?searchtype=all&query=${encodeURIComponent(query)}`;
      logger.info({ url: searchUrl, stage: 'URL_BUILT' });

      await safeGoto(page, searchUrl, 3, 'domcontentloaded');
      logger.info({ url: page.url(), title: await page.title().catch(()=>''), stage: 'NAVIGATION_OK' });

      await page.waitForLoadState('networkidle').catch(()=>{});
      
      const content = await page.content();
      if (content.includes('Sorry') || content.includes('No results')) {
        logger.warn({ query }, 'ARXIV_ZERO_RESULTS');
        return [];
      }

      logger.info({ selector: 'li.arxiv-result', stage: 'WAIT_SELECTOR' });
      const foundWrapper = await page.waitForSelector('li.arxiv-result', { timeout: 10000 }).catch(() => null);
      if (!foundWrapper) {
        await debugSnapshot(page, this.sourceName, 'selector-failed');
        logger.error({ selector: 'li.arxiv-result' }, 'SELECTOR_TIMEOUT');
        return [];
      }

      const cards = page.locator('li.arxiv-result');
      const count = await cards.count();
      logger.info({ count, stage: 'RESULT_COUNT' });

      if (count === 0) {
        await debugSnapshot(page, this.sourceName, 'zero-results');
      }

      for (let i = 0; i < Math.min(count, maxResults); i++) {
        const card = cards.nth(i);
        
        const title = await card.locator('p.title').innerText().catch(() => null);
        const authors = await card.locator('p.authors a').allTextContents().catch(() => []);
        
        const abstractText = await card.locator('span.abstract-full').innerText().catch(() => '');
        const cleanAbstract = abstractText.replace('△ Less', '').trim();
        
        const href = await card.locator('a[href*="/abs/"]').first().getAttribute('href').catch(() => null);
        const url = href ? new URL(href, 'https://arxiv.org').href : null;
        
        const pdfHref = await card.locator('a[href*="/pdf/"]').first().getAttribute('href').catch(() => null);
        const pdf = pdfHref ? new URL(pdfHref, 'https://arxiv.org').href : undefined;

        if (!title || !title.trim()) continue;

        logger.info({
          title: title.trim(),
          authors: authors.map((a: string) => a.trim()),
          url,
          hasAbstract: !!cleanAbstract,
          stage: 'PARSED'
        });

        results.push({
          title: title.trim(),
          authors: authors.map((a: string) => a.trim()),
          abstract: cleanAbstract,
          source: this.sourceName,
          url: url as string,
          pdf,
          extractorVersion: this.extractorVersion,
          originatingQuery: query,
        } as PaperMetadata & { pdf?: string });
      }

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
