import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from '../core/config';

const pool = new Pool({ connectionString: config.postgresUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

interface ExportRequestBody {
  format: 'csv' | 'json' | 'bibtex';
  limit?: number;
}

export async function exportRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: ExportRequestBody }>('/api/export', async (request, reply) => {
    const { format, limit = 100 } = request.body;

    if (!['csv', 'json', 'bibtex'].includes(format)) {
      return reply.status(400).send({ error: 'Invalid format. Use csv, json, or bibtex' });
    }

    try {
      const papers = await prisma.paper.findMany({
        take: limit,
        include: {
          source: true,
          authors: {
            include: { author: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      if (format === 'json') {
        reply.header('Content-Type', 'application/json');
        return reply.send(papers);
      }

      if (format === 'csv') {
        reply.header('Content-Type', 'text/csv');
        reply.header('Content-Disposition', 'attachment; filename="export.csv"');
        
        const header = ['ID', 'Title', 'DOI', 'Year', 'Source', 'URL', 'Authors'].join(',');
        const rows = papers.map(p => {
          const authors = p.authors.map(a => a.author.name).join('; ');
          // Basic escaping for CSV
          const title = `"${p.title.replace(/"/g, '""')}"`;
          return `${p.id},${title},${p.doi || ''},${p.year || ''},${p.source.name},${p.url},"${authors}"`;
        });
        
        return reply.send([header, ...rows].join('\n'));
      }

      if (format === 'bibtex') {
        reply.header('Content-Type', 'text/plain');
        reply.header('Content-Disposition', 'attachment; filename="export.bib"');
        
        const entries = papers.map(p => {
          const authorList = p.authors.map(a => a.author.name).join(' and ');
          const citeKey = p.authors[0]?.author.name.split(' ').pop() || 'Unknown';
          const year = p.year || new Date().getFullYear();
          
          return `@article{${citeKey}${year},
  title={${p.title}},
  author={${authorList}},
  year={${p.year || ''}},
  url={${p.url}},
  doi={${p.doi || ''}}
}`;
        });

        return reply.send(entries.join('\n\n'));
      }

    } catch (err) {
      fastify.log.error(err, 'Failed to export data');
      return reply.status(500).send({ error: 'Internal server error during export' });
    }
  });
}
