import { FastifyInstance } from 'fastify';
import { QueueManager } from '../queue/QueueManager';

const queueManager = new QueueManager();

export async function jobsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/jobs', async (_request, reply) => {
    try {
      const snapshot = await queueManager.getMetrics();
      // snapshot has active, waiting, failed, delayed, completed
      
      return reply.status(200).send({
        active: snapshot.active,
        waiting: snapshot.waiting,
        failed: snapshot.failed,
        retries: snapshot.delayed, // retries are typically in 'delayed' in BullMQ
        completed: snapshot.completed
      });
    } catch (error: any) {
      fastify.log.error(error, 'Failed to fetch queue jobs status');
      return reply.status(500).send({ error: 'Failed to fetch queue status' });
    }
  });

  fastify.post('/api/jobs', async (request, reply) => {
    const { source, query, maxResults, refresh } = request.body as any;

    if (!source || !query) {
      return reply.status(400).send({ error: "Missing source or query" });
    }

    const jobId = await queueManager.enqueue(source, query, maxResults ?? 10, 10, refresh === true);
    return reply.status(202).send({ jobId });
  });

  fastify.post('/api/admin/replay-failed', async (_request, reply) => {
    try {
      const count = await queueManager.retryFailedJobs();
      return reply.status(200).send({ status: 'ok', retriedCount: count });
    } catch (error: any) {
      fastify.log.error(error, 'Failed to replay failed jobs');
      return reply.status(500).send({ error: 'Failed to replay failed jobs' });
    }
  });
}
