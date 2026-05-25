import { BrowserContext } from 'playwright';
import { logger } from '../core/logger';
import { ExtractorFactory } from './ExtractorFactory';
import { BrowserManager } from '../browser/BrowserManager';
import { PaperMetadata } from '../extractors/BaseExtractor';

export interface JobPayload {
  job_id: string;
  source: string;
  query: string;
  maxResults?: number;
}

export class JobRunner {
  private static readonly TIMEOUT_MS = 120000;

  public static async runWithProtection(
    payload: JobPayload,
    browserManager: BrowserManager
  ): Promise<PaperMetadata[]> {
    const pool = browserManager.contextPool;
    if (!pool) throw new Error('ContextPool is not available');

    const context = await pool.acquireContext();
    let timeoutId: NodeJS.Timeout | null = null;

    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => {
        logger.warn({ job_id: payload.job_id }, 'JobRunner: Timeout — aborting extraction.');
        controller.abort();
      }, JobRunner.TIMEOUT_MS);

      const extractor = ExtractorFactory.getExtractor(payload.source);
      const results = await extractor.search(context, payload.query, payload.maxResults, controller.signal);
      return results;

    } catch (err: any) {
      logger.error({ err: err.message, job_id: payload.job_id }, 'JobRunner: Failed');
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      // Release context on normal completion/failure (timeout releases it internally)
      try { await pool.releaseContext(context); } catch (_) {}
    }
  }
}
