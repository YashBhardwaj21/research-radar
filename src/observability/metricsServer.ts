import Fastify from 'fastify';
import { registry } from './metrics';
import { QueueManager } from '../queue/QueueManager';
import { queueDepth } from './metrics';
import { logger } from '../core/logger';

const queueManager = new QueueManager();

export async function startMetricsServer(port = 9090) {
  const app = Fastify({ logger: false });

  // Prometheus scrape endpoint
  app.get('/metrics', async (_req, reply) => {
    // Refresh queue depth gauges on every scrape
    const snapshot = await queueManager.getMetrics();
    queueDepth.labels('active').set(snapshot.active);
    queueDepth.labels('waiting').set(snapshot.waiting);
    queueDepth.labels('failed').set(snapshot.failed);
    queueDepth.labels('delayed').set(snapshot.delayed);
    queueDepth.labels('completed').set(snapshot.completed);

    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });

  // Liveness probe
  app.get('/health', async () => ({ status: 'ok' }));

  await app.listen({ port, host: '0.0.0.0' });
  logger.info({ port, url: `http://localhost:${port}/metrics` }, 'Metrics server running');
}
