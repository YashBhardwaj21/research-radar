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
  private readonly API_PATTERN = /api\.semanticscholar\.org\/graph\/v1\/paper\/search/;
  private readonly SEARCH_URL = 'https://www.semanticscholar.org/search';

  get sourceName(): string {
    return 'semanticscholar';
  }

  async search(context: BrowserContext, query: string, maxResults = 20): Promise<PaperMetadata[]> {
    const page = await context.newPage();

    try {
      await blockAdsAndTrackers(page);

      // Start the API capture BEFORE navigating — we must attach the listener first
      const capturePromise = captureApiResponse<SemanticScholarResponse>(page, this.API_PATTERN);

      const searchUrl = `${this.SEARCH_URL}?q=${encodeURIComponent(query)}&sort=Relevance`;
      await safeGoto(page, searchUrl);

      // Wait for the intercepted response
      const response = await capturePromise;

      const results: PaperMetadata[] = response.data.slice(0, maxResults).map(paper => ({
        title: paper.title,
        authors: paper.authors.map(a => a.name),
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
