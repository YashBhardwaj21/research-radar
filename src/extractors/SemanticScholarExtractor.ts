import { BrowserContext } from 'playwright';
import { BaseExtractor, PaperMetadata } from './BaseExtractor';
import { captureApiResponse } from '../browser/NetworkInterceptor';
import { blockAdsAndTrackers } from '../browser/RequestFilter';
import { safeGoto } from '../browser/navigation';
import { logger } from '../core/logger';

// Shape of the Semantic Scholar Graph API response
interface SemanticScholarResponse {
  data: Array<{
    paperId: string;
    title: string;
    abstract?: string;
    year?: number;
    externalIds?: { DOI?: string };
    authors: Array<{ name: string }>;
  }>;
}

export class SemanticScholarExtractor extends BaseExtractor {
  // The internal API URL intercepted from the Semantic Scholar SPA
  private readonly API_PATTERN = /api\.semanticscholar\.org\/graph\/v1\/paper\/search|api\/1\/search/;
  private readonly SEARCH_URL = 'https://www.semanticscholar.org/search';
  public extractorVersion = 'v1';

  get sourceName(): string {
    return 'semanticscholar';
  }

  async search(context: BrowserContext, query: string, maxResults = 20): Promise<PaperMetadata[]> {
    const page = await context.newPage();

    try {
      await blockAdsAndTrackers(page);

      let captchaBlocked = false;

      // Deep debug logging for API payloads as requested
      page.on('response', async (res) => {
        const url = res.url();
        const headers = res.headers();
        const waf = headers['x-amzn-waf-action'];

        if (url.includes('/api/') || waf === 'captcha') {
          try {
            const body = await res.text().catch(() => 'no body');
            
            if (waf === 'captcha' || body.includes('CaptchaScript.renderCaptcha')) {
              captchaBlocked = true;
              logger.error({
                source: 'semanticscholar',
                status: res.status(),
                reason: 'AWS_WAF_CAPTCHA'
              }, 'Semantic blocked by AWS WAF Captcha');
            } else if (url.includes('/api/')) {
              logger.info({
                url: url,
                status: res.status(),
                headers: headers,
                body: body
              }, 'Semantic API deep trace');
            }
          } catch (e) {
            // ignore
          }
        }
      });

      // Start the API capture BEFORE navigating — we must attach the listener first
      const capturePromise = captureApiResponse<SemanticScholarResponse>(page, this.API_PATTERN);

      const searchUrl = `${this.SEARCH_URL}?q=${encodeURIComponent(query)}&sort=Relevance`;
      await safeGoto(page, searchUrl);

      // Wait for the intercepted response with a timeout to avoid hangs
      const response = await Promise.race([
        capturePromise,
        new Promise<any>((_, reject) => 
          setTimeout(() => reject(new Error('SemanticScholar API interception timed out')), 15000)
        )
      ]).catch((err) => {
        logger.warn({ err: err.message }, 'SemanticScholar intercept failed or timed out');
        return null;
      });

      if (captchaBlocked) {
        const screenshotPath = `traces/semantic-captcha-${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath });
        logger.error({ screenshotPath }, 'Saved screenshot of AWS WAF Captcha block');
        throw new Error('SEMANTIC_CAPTCHA');
      }

      if (!response || !response.data) {
        logger.warn('SemanticScholar returned no valid data');
        return [];
      }

      const results: PaperMetadata[] = response.data.slice(0, maxResults).map((paper: any) => ({
        title: paper.title,
        authors: paper.authors.map((a: any) => a.name),
        abstract: paper.abstract,
        doi: paper.externalIds?.DOI,
        year: paper.year,
        source: this.sourceName,
        url: `https://www.semanticscholar.org/paper/${paper.paperId}`,
      }));

      logger.info({ count: results.length, query }, 'SemanticScholar extraction complete via network interception');
      return results;

    } finally {
      await page.close();
    }
  }

  async extractPaper(context: BrowserContext, url: string): Promise<PaperMetadata> {
    const page = await context.newPage();

    try {
      await blockAdsAndTrackers(page);

      // Intercept the paper detail API response
      const capturePromise = captureApiResponse<{ title: string; abstract?: string; authors: Array<{ name: string }>; year?: number; externalIds?: { DOI?: string } }>(
        page,
        /api\.semanticscholar\.org\/graph\/v1\/paper\//
      );

      await safeGoto(page, url);
      const paper = await capturePromise;

      return {
        title: paper.title,
        authors: paper.authors.map(a => a.name),
        abstract: paper.abstract,
        doi: paper.externalIds?.DOI,
        year: paper.year,
        source: this.sourceName,
        url,
      };
    } finally {
      await page.close();
    }
  }
}
