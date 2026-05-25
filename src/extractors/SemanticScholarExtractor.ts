import { BrowserContext } from 'playwright';
import { BaseExtractor, PaperMetadata } from './BaseExtractor';
import { logger } from '../core/logger';
import axios from 'axios';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class SemanticScholarExtractor extends BaseExtractor {
  public extractorVersion = 'v2';

  get sourceName(): string {
    return 'semanticscholar';
  }

  async search(context: BrowserContext, query: string, maxResults = 20, signal?: AbortSignal): Promise<PaperMetadata[]> {
    const start = Date.now();
    logger.info({ query, maxResults, stage: 'QUERY' }, 'START');
    logger.info({ url: 'https://api.semanticscholar.org/graph/v1/paper/search', stage: 'URL_BUILT' });
    const headers: Record<string, string> = {};
    if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
      headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
    }

    for (let i = 0; i < 3; i++) {
      try {
        logger.info({ attempt: i + 1, stage: 'API_START' });
        const res = await axios.get(
          'https://api.semanticscholar.org/graph/v1/paper/search',
          {
            params: {
              query,
              limit: maxResults,
              fields: 'title,abstract,authors,year,externalIds,url'
            },
            headers,
            signal
          }
        );

        if (!res.data || !res.data.data) {
          logger.info({ count: 0, stage: 'RESULT_COUNT' });
          return [];
        }

        const rawData = res.data.data;
        logger.info({ count: rawData.length, stage: 'RESULT_COUNT' });

        const results = rawData.map((paper: any) => {
          const p = {
            title: paper.title,
            authors: paper.authors?.map((a: any) => a.name) || [],
            abstract: paper.abstract,
            doi: paper.externalIds?.DOI,
            year: paper.year,
            source: this.sourceName,
            url: paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`,
            extractorVersion: this.extractorVersion,
            originatingQuery: query
          };
          
          logger.info({
            title: p.title,
            authors: p.authors,
            url: p.url,
            hasAbstract: !!p.abstract,
            stage: 'PARSED'
          });

          return p;
        });

        logger.info({ stage: 'FINISHED', count: results.length, elapsed: Date.now() - start });
        return results;

      } catch (e: any) {
        if (axios.isCancel(e) || (signal && signal.aborted)) {
           throw new Error('AbortError');
        }
        
        logger.warn({ attempt: i + 1, status: e.response?.status, error: e.message }, 'SemanticScholar API search request failed');
        
        if (e.response?.status === 429) {
          await sleep((3 ** i) * 2000); // Wait longer on 429: 2s, 6s, 18s
        } else {
          await sleep((2 ** i) * 1000);
        }
        
        if (i === 2) {
          logger.error({ err: e.message, stack: e.stack }, 'EXTRACTOR_FAILED');
          throw e;
        }
      }
    }
    
    logger.info({ stage: 'FINISHED', count: 0, elapsed: Date.now() - start });
    return [];
  }

  async extractPaper(context: BrowserContext, urlOrId: string): Promise<PaperMetadata> {
    const headers: Record<string, string> = {};
    if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
      headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
    }

    // Determine paperId. If URL, extract the 40-char SHA at the end or just the whole thing if it's already an ID.
    const parts = urlOrId.split('/');
    const paperId = parts[parts.length - 1];

    for (let i = 0; i < 3; i++) {
      try {
        const res = await axios.get(
          `https://api.semanticscholar.org/graph/v1/paper/${paperId}`,
          {
            params: {
              fields: 'title,abstract,authors,year,externalIds,url'
            },
            headers
          }
        );

        const p = res.data;
        return {
          title: p.title,
          authors: p.authors?.map((a: any) => a.name) || [],
          abstract: p.abstract,
          doi: p.externalIds?.DOI,
          year: p.year,
          source: this.sourceName,
          url: p.url || `https://www.semanticscholar.org/paper/${paperId}`,
          extractorVersion: this.extractorVersion
        };
      } catch (e: any) {
        logger.warn({ attempt: i + 1, status: e.response?.status, error: e.message }, 'SemanticScholar API extract request failed');
        if (i === 2) throw e;

        if (e.response?.status === 429) {
          await sleep((3 ** i) * 2000);
        } else {
          await sleep((2 ** i) * 1000);
        }
      }
    }
    throw new Error('Failed to extract paper from SemanticScholar after retries');
  }
}
