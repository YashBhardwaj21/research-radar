import { FastifyInstance } from 'fastify';
import { CitationGraphService } from '../intelligence/CitationGraphService';
import { TrendAnalyzer } from '../intelligence/TrendAnalyzer';
import { QueryExpansion } from '../intelligence/QueryExpansion';
import { LLMAnalyzer } from '../intelligence/LLMAnalyzer';

const citationGraph = new CitationGraphService();
const trendAnalyzer = new TrendAnalyzer();
const queryExpansion = new QueryExpansion();
const llmAnalyzer = new LLMAnalyzer();

export async function intelligenceRoutes(fastify: FastifyInstance) {

  // ── Citation Graph ──────────────────────────────────────────────

  fastify.get<{ Params: { id: string } }>('/api/paper/:id/citations', async (request, reply) => {
    try {
      const citations = await citationGraph.getCitations(request.params.id);
      return reply.send({ paperId: request.params.id, count: citations.length, citations });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to fetch citations');
      return reply.status(err.message?.includes('not found') ? 404 : 500).send({ error: err.message });
    }
  });

  fastify.get<{ Params: { id: string }; Querystring: { depth?: string } }>(
    '/api/paper/:id/network',
    async (request, reply) => {
      try {
        const depth = Math.min(parseInt(request.query.depth || '1', 10), 3); // cap at 3
        const network = await citationGraph.getNetwork(request.params.id, depth);
        return reply.send(network);
      } catch (err: any) {
        fastify.log.error(err, 'Failed to build citation network');
        return reply.status(err.message?.includes('not found') ? 404 : 500).send({ error: err.message });
      }
    }
  );

  // ── Trend Analysis ──────────────────────────────────────────────

  fastify.get<{ Querystring: { topic: string } }>('/api/trends', async (request, reply) => {
    const { topic } = request.query;
    if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
      return reply.status(400).send({ error: 'A non-empty "topic" query parameter is required.' });
    }

    try {
      const result = await trendAnalyzer.analyze(topic.trim());
      return reply.send(result);
    } catch (err: any) {
      fastify.log.error(err, 'Failed to analyze trends');
      return reply.status(500).send({ error: 'Internal server error during trend analysis.' });
    }
  });

  // ── Query Expansion ─────────────────────────────────────────────

  fastify.get<{ Querystring: { q: string } }>('/api/expand', async (request, reply) => {
    const { q } = request.query;
    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      return reply.status(400).send({ error: 'A non-empty "q" query parameter is required.' });
    }
    const expanded = queryExpansion.expand(q.trim());
    return reply.send(expanded);
  });

  // ── LLM Analysis ───────────────────────────────────────────────

  fastify.post<{ Body: { title: string; abstract: string } }>('/api/analyze', async (request, reply) => {
    const { title, abstract } = request.body;

    if (!title || !abstract) {
      return reply.status(400).send({ error: 'Both "title" and "abstract" fields are required.' });
    }

    // Check Ollama availability first
    const available = await llmAnalyzer.isAvailable();
    if (!available) {
      return reply.status(503).send({
        error: 'Ollama is not available. Ensure it is running locally with the llama3.1:8b model.',
      });
    }

    const result = await llmAnalyzer.analyze(title, abstract);
    if (!result) {
      return reply.status(502).send({ error: 'LLM analysis failed. Check Ollama logs.' });
    }

    return reply.send(result);
  });

  // ── LLM Health Check ───────────────────────────────────────────

  fastify.get('/api/llm/status', async (_request, reply) => {
    const available = await llmAnalyzer.isAvailable();
    return reply.send({ ollama: available ? 'connected' : 'unavailable' });
  });
}
