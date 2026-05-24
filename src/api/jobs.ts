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
}
