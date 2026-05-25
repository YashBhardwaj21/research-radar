import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { EmbeddingService } from '../processing/EmbeddingService';
import { logger } from '../core/logger';
import { searchLatencySeconds } from '../observability/metrics';
import { config } from '../core/config';

const pool = new Pool({ connectionString: config.postgresUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const embeddingService = new EmbeddingService();

interface SearchRequestBody {
  query: string;
  source?: string;
  year_min?: number;
  limit?: number;
  offset?: number;
}

interface SearchResult {
  id: string;
  title: string;
  abstract: string | null;
  doi: string | null;
  url: string;
  year: number | null;
  source: string;
  authors: string[];
  similarity: number;
}

export async function startSearchServer(port = 3000) {
  const app = Fastify({ loggerInstance: logger });

  // Swagger Docs
  const { setupSwagger } = require('./swagger');
  await setupSwagger(app);

  app.post<{ Body: SearchRequestBody }>('/api/search', async (request, reply) => {
    const { query, source, year_min, limit = 10, offset = 0 } = request.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return reply.status(400).send({ error: 'A non-empty "query" field is required.' });
    }

    const endTimer = searchLatencySeconds.startTimer();

    try {
      // 1. Convert the user's natural language query into a vector
      const queryVector = await embeddingService.generateEmbedding(query);
      const vectorStr = `[${queryVector.join(',')}]`;

      // 2. Build WHERE clause fragments for metadata filters
      const conditions: string[] = [`"embeddingStatus" = 'GENERATED'`];
      const params: any[] = [vectorStr, limit, offset];
      let paramIndex = 4; // $1=vector, $2=limit, $3=offset

      if (source) {
        conditions.push(`s."name" = $${paramIndex}`);
        params.push(source);
        paramIndex++;
      }

      if (year_min) {
        conditions.push(`p."year" >= $${paramIndex}`);
        params.push(year_min);
        paramIndex++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // 3. Execute cosine similarity search via raw SQL
      const results: SearchResult[] = await prisma.$queryRawUnsafe(`
        SELECT
          p."id",
          p."title",
          p."abstract",
          p."doi",
          p."url",
          p."year",
          s."name" AS "source",
          1 - (p."embedding" <=> $1::vector) AS "similarity"
        FROM "Paper" p
        JOIN "Source" s ON p."sourceId" = s."id"
        ${whereClause}
        ORDER BY p."embedding" <=> $1::vector
        LIMIT $2
        OFFSET $3
      `, ...params);

      // 4. Fetch authors for each paper
      const papersWithAuthors = await Promise.all(
        results.map(async (paper) => {
          const authorRows = await prisma.paperAuthor.findMany({
            where: { paperId: paper.id },
            include: { author: true },
          });
          return {
            ...paper,
            similarity: Number(paper.similarity),
            authors: authorRows.map((r: any) => r.author.name),
          };
        })
      );

      endTimer();

      return reply.send({
        query,
        count: papersWithAuthors.length,
        results: papersWithAuthors,
      });

    } catch (err: any) {
      endTimer();
      logger.error({ err: err.message }, 'SearchAPI: Query failed');
      return reply.status(500).send({ error: 'Internal server error during search.' });
    }
  });

  // Health check
  const { healthRoutes } = require('./health');
  app.register(healthRoutes);

  // Jobs status
  const { jobsRoutes } = require('./jobs');
  app.register(jobsRoutes);

  // Metrics
  const { metricsRoutes } = require('./metrics');
  app.register(metricsRoutes);

  // Export
  const { exportRoutes } = require('./export');
  app.register(exportRoutes);

  // Intelligence (M6)
  const { intelligenceRoutes } = require('./intelligence');
  app.register(intelligenceRoutes);

  await app.listen({ port, host: '0.0.0.0' });
  logger.info({ port }, `SearchAPI: Listening on port ${port}`);
  return app;
}

// If run directly, start the server
if (require.main === module) {
  startSearchServer().catch((err) => {
    logger.error({ err }, 'SearchAPI: Fatal startup error');
    process.exit(1);
  });
}
