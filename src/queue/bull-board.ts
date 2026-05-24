import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import Fastify from 'fastify';
import { scrapeQueue } from './QueueManager';
import { logger } from '../core/logger';
import { config } from '../core/config';

// Bull-board is strictly a development tool. Do not expose in production.
export async function startBullBoard() {
  if (config.environment === 'production') {
    logger.warn('Bull Board is disabled in production for security reasons.');
    return;
  }

  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath('/ui');

  createBullBoard({
    queues: [new BullMQAdapter(scrapeQueue)],
    serverAdapter,
  });

  const app = Fastify();
  await app.register(serverAdapter.registerPlugin(), { prefix: '/ui' });

  const port = 3001;
  await app.listen({ port, host: '0.0.0.0' });
  logger.info({ port, url: `http://localhost:${port}/ui` }, 'Bull Board dev dashboard is running');
}
