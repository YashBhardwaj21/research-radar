import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { embeddingProvider } from '../processing/embeddings';
import { formatPaper } from '../processing/PaperFormatter';
import { logger } from '../core/logger';
import { searchLatencySeconds } from '../observability/metrics';
import { config } from '../core/config';
import crypto from 'crypto';
import Redis from 'ioredis';
import { QueueManager } from '../queue/QueueManager';
import { startBullBoard } from '../queue/bull-board';

const pool = new Pool({ connectionString: config.postgresUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const redisClient = new Redis(config.redisUrl);
const queueManager = new QueueManager();

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

  // Rate Limiting
  app.register(require('@fastify/rate-limit'), {
    max: 100,
    timeWindow: '1 minute'
  });

  // Auth Middleware
  app.addHook('onRequest', async (request, reply) => {
    // Skip auth for health/metrics endpoints
    if (request.url.startsWith('/health') || request.url.startsWith('/metrics')) return;
    
    const apiKey = request.headers['x-api-key'];
    if (apiKey !== config.apiKey) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // Swagger Docs
  const { setupSwagger } = require('./swagger');
  await setupSwagger(app);

  const searchHandler = async (request: any, reply: any) => {
    const { query, source, year_min, limit = 10, offset = 0 } = request.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return reply.status(400).send({ error: 'A non-empty "query" field is required.' });
    }

    const endTimer = searchLatencySeconds.startTimer();
    const cacheKey = `search:${crypto.createHash('sha256').update(JSON.stringify(request.body)).digest('hex')}`;

    try {
      // Check cache first (Stale-while-revalidate)
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        endTimer();
        queueManager.enqueue('arxiv', query, limit, 20).catch(() => {});
        queueManager.enqueue('pubmed', query, limit, 20).catch(() => {});
        return reply.send({ ...JSON.parse(cached), warning: "fresh scrape scheduled" });
      }

      // Convert the user's natural language query into a vector
      let queryVector: number[];
      try {
        queryVector = await embeddingProvider.generate(query);
      } catch (err: any) {
        logger.error({ dependency: 'ollama', err: err.message }, 'Failed to generate embedding for search query');
        return reply.status(503).send({
          error: "Embedding service unavailable",
          dependency: "ollama",
          status: 503
        });
      }
      
      const vectorStr = `[${queryVector.join(',')}]`;

      // Build WHERE clause fragments for metadata filters
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

      const pubmedWeight = config.sourceWeights?.pubmed || 1.10;
      const arxivWeight = config.sourceWeights?.arxiv || 1.03;

      // Execute cosine similarity search via raw SQL
      const results: SearchResult[] = await prisma.$queryRawUnsafe(`
        SELECT
          p."id",
          p."title",
          p."abstract",
          p."doi",
          p."url",
          p."year",
          s."name" AS "source",
          (1 - (p."embedding" <=> $1::vector)) * 
            CASE s."name" 
              WHEN 'pubmed' THEN ${pubmedWeight} 
              WHEN 'arxiv' THEN ${arxivWeight} 
              ELSE 1.0 
            END AS "similarity"
        FROM "Paper" p
        JOIN "Source" s ON p."sourceId" = s."id"
        ${whereClause}
        ORDER BY similarity DESC
        LIMIT $2
        OFFSET $3
      `, ...params);

      // Fetch authors for each paper
      const papersWithAuthors = await Promise.all(
        results.map(async (paper) => {
          const authorRows = await prisma.paperAuthor.findMany({
            where: { paperId: paper.id },
            include: { author: true },
          });
          const authors = authorRows.map((r: any) => r.author.name);
          return formatPaper({
            ...paper,
            authors,
          });
        })
      );

      endTimer();

      const responsePayload = {
        query,
        count: papersWithAuthors.length,
        results: papersWithAuthors,
      };

      // Cache for 1 hour
      await redisClient.set(cacheKey, JSON.stringify(responsePayload), 'EX', 3600);

      // Enqueue fresh background scrape (low priority)
      queueManager.enqueue('arxiv', query, limit, 20).catch(() => {});
      queueManager.enqueue('pubmed', query, limit, 20).catch(() => {});

      return reply.send({ ...responsePayload, warning: "fresh scrape scheduled" });

    } catch (err: any) {
      endTimer();
      logger.error({ err: err.message }, 'SearchAPI: Query failed');
      return reply.status(500).send({ error: 'Internal server error during search.' });
    }
  };

  app.post<{ Body: SearchRequestBody }>('/api/v1/search', searchHandler);
  app.post<{ Body: SearchRequestBody }>('/api/search', searchHandler); // legacy alias

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

  // Start Bull-board Dashboard on port 3001
  startBullBoard().catch(err => logger.error({ err }, 'Failed to start Bull Board'));

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
