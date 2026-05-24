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
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(async () => {
          logger.warn({ job_id: payload.job_id }, 'JobRunner: Timeout — force-closing pages and context.');
          for (const page of context.pages()) {
            await page.close().catch(() => {});
          }
          await pool.releaseContext(context);
          reject(new Error(`Job ${payload.job_id} timed out after ${JobRunner.TIMEOUT_MS}ms`));
        }, JobRunner.TIMEOUT_MS);
      });

      const extractor = ExtractorFactory.getExtractor(payload.source);
      const extractionPromise = extractor.search(context, payload.query, payload.maxResults);
      const results = await Promise.race([extractionPromise, timeoutPromise]);
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
