import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// Single shared registry for the entire process
export const registry = new Registry();

// Collect default Node.js metrics (heap, GC, event loop lag etc.)
collectDefaultMetrics({ register: registry });

// --- Extraction Metrics ---

export const papersScrapedTotal = new Counter({
  name: 'papers_scraped_total',
  help: 'Total number of papers successfully scraped',
  labelNames: ['source'],
  registers: [registry],
});

export const scrapeErrorsTotal = new Counter({
  name: 'scrape_errors_total',
  help: 'Total number of scrape errors',
  labelNames: ['source', 'error_type'],
  registers: [registry],
});

export const extractionDurationSeconds = new Histogram({
  name: 'extraction_duration_seconds',
  help: 'Duration of extraction jobs in seconds',
  labelNames: ['source'],
  buckets: [1, 5, 10, 30, 60, 120],
  registers: [registry],
});

export const activeWorkers = new Gauge({
  name: 'active_workers',
  help: 'Number of currently active BullMQ workers',
  registers: [registry],
});

// --- Queue Metrics ---

export const queueDepth = new Gauge({
  name: 'queue_depth',
  help: 'Current number of waiting jobs in the queue',
  labelNames: ['status'],
  registers: [registry],
});

export const queueFailedJobsTotal = new Counter({
  name: 'queue_failed_jobs_total',
  help: 'Total number of permanently failed jobs',
  registers: [registry],
});

export const queueStalledJobsTotal = new Counter({
  name: 'queue_stalled_jobs_total',
  help: 'Total number of jobs that stalled and were requeued',
  registers: [registry],
});

export const queueRetryJobsTotal = new Counter({
  name: 'queue_retry_jobs_total',
  help: 'Total number of jobs that entered retry',
  labelNames: ['source'],
  registers: [registry],
});

// --- M3: Persistence & Embedding Metrics ---

export const papersInsertedTotal = new Counter({
  name: 'papers_inserted_total',
  help: 'Total number of papers inserted into the database',
  registers: [registry],
});

export const duplicatesDetectedTotal = new Counter({
  name: 'duplicates_detected_total',
  help: 'Total number of duplicate papers detected and skipped',
  labelNames: ['method'], // doi, title, url
  registers: [registry],
});

export const embeddingQueueDepth = new Gauge({
  name: 'embedding_queue_depth',
  help: 'Current number of waiting jobs in the embedding queue',
  registers: [registry],
});

export const embeddingFailuresTotal = new Counter({
  name: 'embedding_failures_total',
  help: 'Total number of embedding generation failures',
  registers: [registry],
});

export const embeddingDurationSeconds = new Histogram({
  name: 'embedding_duration_seconds',
  help: 'Duration of embedding generation in seconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

export const searchLatencySeconds = new Histogram({
  name: 'search_latency_seconds',
  help: 'Duration of vector search queries in seconds',
  buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1],
  registers: [registry],
});

