import { Worker, Job } from 'bullmq';
import crypto from 'crypto';
import Redis from 'ioredis';
import { ScrapeJobPayload, NON_RETRYABLE_CODES } from './types';
import { scrapeQueue, embeddingQueue } from './QueueManager';
import { ExtractorFactory } from '../orchestrator/ExtractorFactory';
import { Deduplicator } from '../processing/Deduplicator';
import { BrowserManager } from '../browser/BrowserManager';
import { SourceHealthManager } from '../health/SourceHealthManager';
import { WorkerHealth } from '../health/WorkerHealth';
import { logContext, logger } from '../core/logger';
import { config, SOURCE_TTL } from '../core/config';
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
const redisClient = new Redis(connection);

async function ingestResults(results: any[], source: string, job_id: string, workerHealth: WorkerHealth) {
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
  return insertedCount;
}

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
      const { job_id, source, query, maxResults, refresh } = job.data;

      return logContext.run({ job_id, source }, async () => {
        workerHealth.setStuckState(true);

        let targetExtractors: any[] = [];
        if (source === 'all') {
          targetExtractors = ExtractorFactory.getAllExtractors();
        } else {
          targetExtractors = [ExtractorFactory.getExtractor(source)];
        }

        const STALE_THRESHOLD_RATIO = 0.3;
        let cacheHits: any[] = [];
        let extractorsToRun: any[] = [];
        
        // 1. Partial Caching & Health Check Loop
        for (const extractor of targetExtractors) {
          const extName = extractor.constructor.name.toLowerCase();
          
          if (!sourceHealth.isAvailable(extName)) {
             logger.warn({ source: extName }, 'Worker: Source is unhealthy. Will use stale cache and skip refresh.');
          }

          const cacheKey = `extract:${crypto.createHash('sha256').update(JSON.stringify({ query, limit: maxResults, source: extName, version: config.cacheVersion })).digest('hex')}`;
          const cachedStr = await redisClient.get(cacheKey);
          let cachedData = cachedStr ? JSON.parse(cachedStr) : null;

          if (cachedData && !refresh) {
            const ageMs = Date.now() - new Date(cachedData.cachedAt).getTime();
            const ttlMs = (SOURCE_TTL[extName] || 86400) * 1000;
            const isStale = ageMs > (ttlMs * STALE_THRESHOLD_RATIO);

            if (isStale && sourceHealth.isAvailable(extName)) {
               logger.info({ source: extName, ageMs }, 'CACHE STALE');
               const refreshLockKey = `refresh:${query}:${extName}`;
               const locked = await redisClient.setnx(refreshLockKey, '1');
               if (locked) {
                 await redisClient.expire(refreshLockKey, 300);
                 logger.info({ source: extName }, 'REFRESH QUEUED');
                 await scrapeQueue.add(QUEUE_NAME, { job_id: crypto.randomUUID(), source: extName as any, query, maxResults, refresh: true }, { priority: 20 });
               }
               logger.info({ source: extName }, 'RETURN CACHE');
               cacheHits.push(...cachedData.results);
            } else {
               logger.info({ source: extName }, 'CACHE HIT');
               logger.info({ source: extName }, 'RETURN CACHE');
               cacheHits.push(...cachedData.results);
            }
          } else {
             logger.info({ source: extName }, 'CACHE MISS');
             if (sourceHealth.isAvailable(extName)) {
               extractorsToRun.push({ extractor, cacheKey, extName });
             }
          }
        }

        if (extractorsToRun.length === 0) {
           await ingestResults(cacheHits, source, job_id, workerHealth);
           workerHealth.setStuckState(false);
           return cacheHits;
        }

        logger.info({ job_id, sourcesToRun: extractorsToRun.map(e => e.extName) }, 'EXTRACTORS');

        const pool = browserManager.contextPool;
        if (!pool) throw new Error('ContextPool is not initialized');
        const context = await pool.acquireContext();

        let timeoutHandle: NodeJS.Timeout | null = null;
        let traceSaved = false;
        let scrapedResults: any[] = [];

        try {
          await context.tracing.start({ screenshots: true, snapshots: true });
          const controller = new AbortController();
          timeoutHandle = setTimeout(() => {
            logger.warn({ job_id }, 'Worker: Job timed out. Aborting extraction.');
            controller.abort();
          }, JOB_TIMEOUT_MS);

          const EXTRACTOR_TIMEOUTS: Record<string, number> = {
            'pubmedextractor': 45000,
            'arxivextractor': 30000
          };

          const fallbacks = [
            query,
            query.replace(/quantum/i, '').replace(/\s+/g, ' ').trim(),
            query.split(' ').slice(0, 5).join(' ')
          ];

          let settledResults: PromiseSettledResult<any[]>[] = [];
          
          for (const currentQuery of fallbacks) {
            if (!currentQuery) continue;
            
            logger.info({ currentQuery }, 'Worker: Attempting query extraction');

            settledResults = await Promise.allSettled(
              extractorsToRun.map(async ({ extractor, cacheKey, extName }) => {
                const start = Date.now();
                const timeoutMs = EXTRACTOR_TIMEOUTS[extName] || 25000;
                
                // Use currentQuery for lock so fallbacks get distinct locks
                const scrapeLockKey = `scrape:${currentQuery}:${extName}`;
                const locked = await redisClient.setnx(scrapeLockKey, '1');
                if (!locked) {
                   logger.info({ source: extName }, 'Worker: Scrape lock acquired by another worker. Skipping.');
                   return [];
                }
                await redisClient.expire(scrapeLockKey, 60);

                logger.info({ extractor: extName, started: start, timeoutMs }, 'Worker: Extractor start');
                
                return Promise.race([
                  extractor.search(context, currentQuery, maxResults, controller.signal).then(async (res: any[]) => {
                    const elapsed = Date.now() - start;
                    logger.info({ extractor: extName, count: res.length, elapsed }, 'Worker: Extractor finished');
                    await redisClient.del(scrapeLockKey);

                    try {
                      const healthKey = `health:extractor:${extName}`;
                      const pipeline = redisClient.pipeline();
                      pipeline.hincrby(healthKey, 'successCount', 1);
                      pipeline.hincrby(healthKey, 'totalCount', 1);
                      pipeline.hincrby(healthKey, 'totalLatency', elapsed);
                      await pipeline.exec();
                    } catch (err) {}
                    
                    const baseTtl = SOURCE_TTL[extName] || 86400;
                    const cachePayload = {
                      results: res,
                      cachedAt: new Date().toISOString(),
                      age: 0,
                      cacheHitCount: 0,
                      extractorLatency: elapsed,
                      failureCount: 0,
                      pipelineVersion: config.cacheVersion,
                      source: extName
                    };
                    
                    if (res.length > 0) {
                      // Note: always storing in original query cacheKey for consistency when returned to user
                      await redisClient.set(cacheKey, JSON.stringify(cachePayload), 'EX', baseTtl);
                      logger.info({ source: extName, keysStored: res.length }, 'CACHE STORE');
                    } else {
                      logger.info({ source: extName }, 'CACHE SKIP (Empty array)');
                    }

                    return res;
                  }),
                  new Promise<any[]>((_, reject) => 
                    setTimeout(() => reject(new Error(`Extractor timeout (${timeoutMs}ms)`)), timeoutMs)
                  )
                ]).catch(async (err) => {
                  await redisClient.del(scrapeLockKey);
                  try {
                    const healthKey = `health:extractor:${extName}`;
                    const pipeline = redisClient.pipeline();
                    pipeline.hincrby(healthKey, 'failureCount', 1);
                    pipeline.hincrby(healthKey, 'totalCount', 1);
                    pipeline.hset(healthKey, 'lastError', err.message);
                    await pipeline.exec();
                  } catch (redisErr) {}
                  SourceHealthManager.getInstance().recordFailure(extName, err.message);

                  await redisClient.del(cacheKey);
                  throw err;
                });
              })
            );

            const rawScraped = settledResults.flatMap(r => r.status === 'fulfilled' ? r.value : []);
            if (rawScraped.length > 0) {
              logger.info({ currentQuery, count: rawScraped.length }, 'Worker: Found results, stopping fallbacks');
              break;
            }
          }

          const rejected = settledResults.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
          if (rejected.length > 0) {
            logger.error({ errors: rejected.map(r => r.reason?.message) }, 'Worker: Some extractors failed');
          }

          const rawScraped = settledResults.flatMap(r => r.status === 'fulfilled' ? r.value : []);
          scrapedResults = [...cacheHits, ...rawScraped];

          if (scrapedResults.length === 0) {
            throw new Error('No extractors returned papers');
          }

          logger.info({ urls: scrapedResults.map(x=>x.url) }, 'PRE_DEDUP');

          let uniqueMap = new Map();
          for (const paper of scrapedResults) {
            const key = paper.doi || (paper.title ? paper.title.toLowerCase().replace(/\W/g, '') : paper.url) || Math.random().toString();
            if (!uniqueMap.has(key)) {
              uniqueMap.set(key, paper);
            }
          }
          const finalResults = Array.from(uniqueMap.values());
          
          const inserted = await ingestResults(finalResults, source, job_id, workerHealth);

          if (source === 'all') {
            logger.info({
              job: job_id,
              pubmed: finalResults.filter((p: any) => p.source === 'pubmed').length,
              arxiv: finalResults.filter((p: any) => p.source === 'arxiv').length,
              flattened: scrapedResults.length,
              duplicatesRemoved: scrapedResults.length - finalResults.length,
              deduplicated: finalResults.length,
              inserted: inserted
            }, 'Pipeline summary');
          }
          
          return finalResults;

        } catch (err: any) {
          sourceHealth.recordFailure(source, err.message);
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
      settings: {
        backoffStrategy: (attemptsMade: number, type?: string) => {
          if (type === 'jitter') {
            return Math.round(1000 + Math.random() * 500);
          }
          return 5000;
        },
      },
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
