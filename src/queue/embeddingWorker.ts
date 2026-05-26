import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { EmbeddingJobPayload } from './types';
import { embeddingProvider } from '../processing/embeddings';
import { logContext, logger } from '../core/logger';
import { config } from '../core/config';
import {
  embeddingFailuresTotal,
  embeddingDurationSeconds,
} from '../observability/metrics';

const QUEUE_NAME = 'embedding-jobs';

const connection = {
  host: config.redisHost,
  port: config.redisPort,
};

const pool = new Pool({ connectionString: config.postgresUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function startEmbeddingWorker() {
  const bullWorker = new Worker<EmbeddingJobPayload>(
    QUEUE_NAME,
    async (job: Job<EmbeddingJobPayload>) => {
      const { paperId, textToEmbed } = job.data;

      return logContext.run({ job_id: paperId, source: 'embedding' }, async () => {
        logger.info({ paperId }, 'EmbeddingWorker: Processing embedding job');

        const endTimer = embeddingDurationSeconds.startTimer();

        try {
          // 1. Generate embedding via DI provider
          const vector = await embeddingProvider.generate(textToEmbed);

          // 2. Write vector to DB using raw SQL (Prisma doesn't natively support pgvector writes)
          const vectorStr = `[${vector.join(',')}]`;
          await prisma.$executeRawUnsafe(
            `UPDATE "Paper" SET "embedding" = $1::vector, "embeddingStatus" = 'GENERATED', "updatedAt" = NOW() WHERE "id" = $2`,
            vectorStr,
            paperId,
          );

          endTimer();
          logger.info({ paperId }, 'EmbeddingWorker: Embedding stored successfully');
          return { paperId, status: 'GENERATED' };

        } catch (err: any) {
          endTimer();
          embeddingFailuresTotal.inc();

          // Mark as FAILED in DB so it's visible
          try {
            await prisma.$executeRawUnsafe(
              `UPDATE "Paper" SET "embeddingStatus" = 'FAILED', "updatedAt" = NOW() WHERE "id" = $1`,
              paperId,
            );
          } catch (_) { /* best effort */ }

          logger.error({ paperId, err: err.message }, 'EmbeddingWorker: Failed to generate embedding');
          throw err; // Let BullMQ retry policy handle it
        }
      });
    },
    {
      connection,
      concurrency: 3, // Embedding is CPU-light (Ollama does the work), so moderate concurrency
    }
  );

  bullWorker.on('error', (err) => {
    logger.error({ err: err.message }, 'EmbeddingWorker: BullMQ worker error');
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'EmbeddingWorker: Shutdown signal received.');
    await bullWorker.close();
    await prisma.$disconnect();
    logger.info('EmbeddingWorker: Graceful shutdown complete.');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  logger.info('EmbeddingWorker: Started and waiting for embedding jobs.');
}

startEmbeddingWorker().catch((err) => {
  logger.error({ err }, 'EmbeddingWorker: Fatal startup error');
  process.exit(1);
});
