import { FastifyInstance } from 'fastify';

export async function healthRoutes(fastify: FastifyInstance) {
  // Basic liveness check for container orchestration
  fastify.get('/live', async (_request, reply) => {
    return reply.status(200).send({ status: 'ok' });
  });

  // Readiness check to verify if the service is ready to accept traffic
  // In a real scenario, this might check DB connections or Redis connectivity
  fastify.get('/ready', async (_request, reply) => {
    // Add logic here to check Redis/DB if needed
    return reply.status(200).send({ status: 'ready' });
  });

  // Comprehensive health check
  fastify.get('/health', async (_request, reply) => {
    return reply.status(200).send({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  });
}
