import { FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import { config } from '../core/config';

const redisClient = new Redis(config.redisUrl);

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

  // Extractor health endpoint
  fastify.get('/api/extractors/health', async (_request, reply) => {
    const extractors = ['pubmedextractor', 'arxivextractor', 'semanticscholarextractor'];
    const response: Record<string, any> = {};

    for (const ext of extractors) {
      const key = `health:extractor:${ext}`;
      const data = await redisClient.hgetall(key);
      
      const successCount = parseInt(data.successCount || '0', 10);
      const failureCount = parseInt(data.failureCount || '0', 10);
      const totalCount = parseInt(data.totalCount || '0', 10);
      const totalLatency = parseInt(data.totalLatency || '0', 10);
      
      const successRate = totalCount > 0 ? (successCount / totalCount) * 100 : 0;
      const avgLatency = successCount > 0 ? totalLatency / successCount : 0;
      
      const isHealthy = successRate >= 50; // simple threshold
      
      let name = 'unknown';
      if (ext === 'pubmedextractor') name = 'pubmed';
      if (ext === 'arxivextractor') name = 'arxiv';
      if (ext === 'semanticscholarextractor') name = 'semantic';
      
      response[name] = {
        healthy: isHealthy,
        avgLatency: Math.round(avgLatency),
        successRate: Math.round(successRate),
        lastError: data.lastError || null
      };
    }
    
    return reply.status(200).send(response);
  });
}
