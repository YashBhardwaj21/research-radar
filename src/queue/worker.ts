import { Worker, Job } from 'bullmq';
import { ScrapeJobPayload, NON_RETRYABLE_CODES } from './types';
import { scrapeQueue, embeddingQueue } from './QueueManager';
import { ExtractorFactory } from '../orchestrator/ExtractorFactory';
import { Deduplicator } from '../processing/Deduplicator';
import { BrowserManager } from '../browser/BrowserManager';
import { SourceHealthManager } from '../health/SourceHealthManager';
import { WorkerHealth } from '../health/WorkerHealth';
import { logContext, logger } from '../core/logger';
import { config } from '../core/config';
import {
  papersScrapedTotal,
  scrapeErrorsTotal,
  extractionDurationSeconds,
  activeWorkers,
  queueStalledJobsTotal,
  queueRetryJobsTotal,
} from '../observability/metrics';
import { startMetricsServer } from '../observability/metricsServer';

const QUEUE_NAME = 'scrape-jobs';
const JOB_TIMEOUT_MS = 120_000;

const connection = {
  host: config.redisHost,
  port: config.redisPort,
};

async function startWorker() {
  const browserManager = await BrowserManager.getInstance();
  const sourceHealth = SourceHealthManager.getInstance();
  const workerHealth = new WorkerHealth();

  // Start the Prometheus metrics server on port 9090
  await startMetricsServer(9090);

  // Hook into crash recovery event emitted by BrowserManager
  browserManager.on('BrowserCrashedEvent', async () => {
    logger.warn('Worker: BrowserCrashedEvent received. Pausing queue and restarting browser...');
    await bullWorker.pause();
    await browserManager.restart();
    logger.info('Worker: Browser restarted. Resuming queue.');
    await bullWorker.resume();
  });

  const bullWorker = new Worker<ScrapeJobPayload>(
    QUEUE_NAME,
    async (job: Job<ScrapeJobPayload>) => {
      const { job_id, source, query, maxResults } = job.data;

      // Wrap the entire execution in AsyncLocalStorage for correlation IDs
      return logContext.run({ job_id, source }, async () => {
        // 1. Circuit Breaker check
        if (!sourceHealth.isAvailable(source)) {
          logger.warn({ source }, 'Worker: Source is on cooldown. Delaying job.');
          throw new Error(`ERR_COOLDOWN: Source ${source} is in circuit breaker cooldown.`);
        }

        workerHealth.setStuckState(true);

        // 2. Acquire context from the pool (safe backpressure via ContextPool queue)
        const pool = browserManager.contextPool;
        if (!pool) throw new Error('ContextPool is not initialized');
        const context = await pool.acquireContext();

        let timeoutHandle: NodeJS.Timeout | null = null;

        let traceSaved = false;

        try {
          // Start tracing for potential failure replay
          await context.tracing.start({ screenshots: true, snapshots: true });

          // 3. Race execution against strict timeout
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(async () => {
              logger.warn({ job_id }, 'Worker: Job timed out. Force-closing page and context.');
              for (const page of context.pages()) {
                await page.close().catch(() => {});
              }
              reject(new Error(`Job ${job_id} exceeded timeout of ${JOB_TIMEOUT_MS}ms`));
            }, JOB_TIMEOUT_MS);
          });

          const endTimer = extractionDurationSeconds.startTimer({ source });
          const extractor = ExtractorFactory.getExtractor(source);
          const extractionPromise = extractor.search(context, query, maxResults);

          const results = await Promise.race([extractionPromise, timeoutPromise]);
          endTimer();

          papersScrapedTotal.labels(source).inc(results.length);
          activeWorkers.dec();
          logger.info({ job_id, source, count: results.length }, 'Worker: Extraction completed successfully, starting DB upsert...');

          // Pre-insert Deduplication & Upsert
          let insertedCount = 0;
          for (const paper of results) {
            try {
              const { paperId, isNew } = await Deduplicator.processAndInsert(paper, source);
              
              if (isNew) {
                insertedCount++;
                // Enqueue for embedding generation
                await embeddingQueue.add('generate-embedding', {
                  paperId,
                  textToEmbed: `${paper.title}. ${paper.abstract || ''}`
                });
              }
            } catch (err: any) {
              logger.error({ job_id, url: paper.url, err: err.message }, 'Worker: Failed to process/insert paper');
            }
          }

          workerHealth.incrementJobsProcessed();
          logger.info({ job_id, inserted: insertedCount, total: results.length }, 'Worker: Job fully processed and ingested');
          return results;

        } catch (err: any) {
          sourceHealth.recordFailure(source);
          scrapeErrorsTotal.labels(source, err.message?.slice(0, 30) || 'unknown').inc();
          activeWorkers.dec();

          // Save Playwright trace on failure
          const tracePath = `traces/trace-${job_id}.zip`;
          logger.error({ job_id, tracePath }, 'Worker: Job failed, saving Playwright trace for replay.');
          await context.tracing.stop({ path: tracePath }).catch(() => {});
          traceSaved = true;

          // Classify non-retryable errors to skip retry queue
          for (const code of NON_RETRYABLE_CODES) {
            if (err.message?.includes(code)) {
              logger.error({ job_id, code }, 'Worker: Non-retryable error. Sending to Dead Letter Queue.');
              const { UnrecoverableError } = await import('bullmq');
              throw new UnrecoverableError(err.message);
            }
          }
          queueRetryJobsTotal.labels(source).inc();
          throw err;

        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          workerHealth.setStuckState(false);
          if (!traceSaved) {
            await context.tracing.stop().catch(() => {});
          }
          // Always release the context back to the pool
          try { await pool.releaseContext(context); } catch (_) {}
        }
      });
    },
    {
      connection,
      concurrency: config.maxWorkers,
    }
  );

  bullWorker.on('error', (err) => {
    logger.error({ err: err.message }, 'Worker: BullMQ worker error');
  });

  bullWorker.on('active', () => activeWorkers.inc());

  bullWorker.on('stalled', (_jobId) => {
    queueStalledJobsTotal.inc();
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Worker: Shutdown signal received. Draining active jobs...');
    await bullWorker.close(); // Waits for active jobs to finish
    await scrapeQueue.close();
    await browserManager.shutdown();
    logger.info('Worker: Graceful shutdown complete.');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  logger.info({ concurrency: config.maxWorkers }, 'Worker: BullMQ worker started and waiting for jobs.');
}

startWorker().catch((err) => {
  logger.error({ err }, 'Worker: Fatal startup error');
  process.exit(1);
});
