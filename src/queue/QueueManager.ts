import { Queue, QueueEvents } from 'bullmq';
import { ScrapeJobPayload } from './types';
import { config } from '../core/config';
import { logger } from '../core/logger';
import crypto from 'crypto';

const QUEUE_NAME = 'scrape-jobs';

const connection = {
  host: config.redisHost,
  port: config.redisPort,
};

// Singleton queue instance
export const scrapeQueue = new Queue<ScrapeJobPayload>(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'jitter',
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export const embeddingQueue = new Queue<any>('embedding-jobs', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export class QueueManager {
  private queueEvents: QueueEvents;

  constructor() {
    this.queueEvents = new QueueEvents(QUEUE_NAME, { connection });
    this.attachEventListeners();
  }

  /**
   * Generates a deterministic job ID from source + query to enforce idempotency.
   * Retrying the same query will update the existing job, not create a duplicate.
   */
  public static generateJobId(source: string, query: string): string {
    return crypto.createHash('sha256').update(`${source}:${query}`).digest('hex').slice(0, 16);
  }

  /**
   * Enqueues a job. Uses deterministic jobId to prevent duplicate ingestion.
   */
  public async enqueue(source: ScrapeJobPayload['source'], query: string, maxResults = 10, priority = 10, refresh = false): Promise<string> {
    const job_id = crypto.randomUUID();

    await scrapeQueue.add(
      QUEUE_NAME,
      { job_id, source, query, maxResults, refresh },
      {
        jobId: job_id,
        priority, // 1 is highest priority, higher numbers are lower priority in BullMQ
      }
    );

    logger.info({ job_id, source, query, priority }, 'QueueManager: Job enqueued');
    return job_id;
  }

  /**
   * Schedules a weekly recrawl for a query.
   */
  public async scheduleRecrawl(source: ScrapeJobPayload['source'], query: string): Promise<void> {
    const job_id = `cron-${source}-${query}`.replace(/[^a-zA-Z0-9-]/g, '-');
    await scrapeQueue.add(
      QUEUE_NAME,
      { job_id, source, query, maxResults: 50 },
      {
        jobId: job_id,
        priority: 20, // Lower priority
        repeat: { pattern: '0 0 * * 0' }, // Every Sunday
      }
    );
    logger.info({ job_id, source, query }, 'QueueManager: Scheduled recrawl');
  }

  /**
   * Returns a snapshot of current queue depth metrics.
   */
  public async getMetrics() {
    const [active, waiting, failed, delayed, completed] = await Promise.all([
      scrapeQueue.getActiveCount(),
      scrapeQueue.getWaitingCount(),
      scrapeQueue.getFailedCount(),
      scrapeQueue.getDelayedCount(),
      scrapeQueue.getCompletedCount(),
    ]);
    return { active, waiting, failed, delayed, completed };
  }

  /**
   * Retries all failed jobs in the queue
   */
  public async retryFailedJobs(): Promise<number> {
    const failedJobs = await scrapeQueue.getFailed();
    for (const job of failedJobs) {
      await job.retry();
    }
    logger.info({ count: failedJobs.length }, 'QueueManager: Retried failed jobs');
    return failedJobs.length;
  }

  private attachEventListeners(): void {
    this.queueEvents.on('stalled', ({ jobId }) => {
      logger.warn({ jobId }, 'QueueManager: Job stalled. BullMQ will attempt to requeue.');
    });

    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error({ jobId, failedReason }, 'QueueManager: Job failed permanently');
    });

    this.queueEvents.on('completed', ({ jobId }) => {
      logger.debug({ jobId }, 'QueueManager: Job completed');
    });
  }

  public async close(): Promise<void> {
    await this.queueEvents.close();
    await scrapeQueue.close();
    await embeddingQueue.close();
  }
}
