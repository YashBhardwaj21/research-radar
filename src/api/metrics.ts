import { FastifyInstance } from 'fastify';
import { registry } from '../observability/metrics';
import { QueueManager } from '../queue/QueueManager';
import { queueDepth } from '../observability/metrics';

const queueManager = new QueueManager();

export async function metricsRoutes(fastify: FastifyInstance) {
  fastify.get('/metrics', async (_req, reply) => {
    try {
      // Refresh queue depth gauges on every scrape
      const snapshot = await queueManager.getMetrics();
      queueDepth.labels('active').set(snapshot.active);
      queueDepth.labels('waiting').set(snapshot.waiting);
      queueDepth.labels('failed').set(snapshot.failed);
      queueDepth.labels('delayed').set(snapshot.delayed);
      queueDepth.labels('completed').set(snapshot.completed);
    } catch (err) {
      fastify.log.warn('Could not fetch queue metrics during Prometheus scrape');
    }

    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });
}
