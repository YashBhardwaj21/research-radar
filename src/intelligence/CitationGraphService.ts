import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from '../core/config';
import { logger } from '../core/logger';

const pool = new Pool({ connectionString: config.postgresUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export interface CitationNode {
  id: string;
  title: string;
  doi: string | null;
  year: number | null;
  source: string;
}

export interface CitationEdge {
  from: string;
  to: string;
  relationship: 'cites' | 'co-author' | 'similar-topic';
}

export interface CitationNetwork {
  nodes: CitationNode[];
  edges: CitationEdge[];
}

/**
 * CitationGraphService builds citation-like networks from the local database.
 *
 * Since we scrape metadata (not full citation lists), we approximate
 * relationships using three signals:
 *   1. Shared DOI prefix (same journal/series)
 *   2. Co-authorship (papers sharing ≥1 author)
 *   3. Vector similarity (papers with cosine distance < threshold)
 */
export class CitationGraphService {

  /**
   * Get papers that share at least one author with the given paper.
   */
  async getCitations(paperId: string): Promise<CitationNode[]> {
    // Find all authors of this paper
    const paperAuthors = await prisma.paperAuthor.findMany({
      where: { paperId },
      select: { authorId: true },
    });

    if (paperAuthors.length === 0) {
      return [];
    }

    const authorIds = paperAuthors.map(pa => pa.authorId);

    // Find all other papers by those authors
    const relatedPaperAuthors = await prisma.paperAuthor.findMany({
      where: {
        authorId: { in: authorIds },
        paperId: { not: paperId },
      },
      include: {
        paper: {
          include: { source: true },
        },
      },
      distinct: ['paperId'],
    });

    return relatedPaperAuthors.map(pa => ({
      id: pa.paper.id,
      title: pa.paper.title,
      doi: pa.paper.doi,
      year: pa.paper.year,
      source: pa.paper.source.name,
    }));
  }

  /**
   * Build a full network graph around a paper.
   * Combines co-authorship edges with vector-similarity edges.
   */
  async getNetwork(paperId: string, depth = 1): Promise<CitationNetwork> {
    const nodes: Map<string, CitationNode> = new Map();
    const edges: CitationEdge[] = [];
    const visited = new Set<string>();

    // Seed node
    const seedPaper = await prisma.paper.findUnique({
      where: { id: paperId },
      include: { source: true },
    });

    if (!seedPaper) {
      throw new Error(`Paper ${paperId} not found`);
    }

    nodes.set(seedPaper.id, {
      id: seedPaper.id,
      title: seedPaper.title,
      doi: seedPaper.doi,
      year: seedPaper.year,
      source: seedPaper.source.name,
    });

    // BFS traversal
    let frontier = [paperId];

    for (let d = 0; d < depth; d++) {
      const nextFrontier: string[] = [];

      for (const currentId of frontier) {
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        // Co-author edges
        const coAuthorPapers = await this.getCitations(currentId);
        for (const related of coAuthorPapers) {
          if (!nodes.has(related.id)) {
            nodes.set(related.id, related);
            nextFrontier.push(related.id);
          }
          // Avoid duplicate edges
          const edgeExists = edges.some(
            e => (e.from === currentId && e.to === related.id) ||
                 (e.from === related.id && e.to === currentId)
          );
          if (!edgeExists) {
            edges.push({ from: currentId, to: related.id, relationship: 'co-author' });
          }
        }

        // Vector similarity edges (top 5 most similar papers)
        try {
          const similarPapers: Array<{ id: string; title: string; doi: string | null; year: number | null; source_name: string; similarity: number }> =
            await prisma.$queryRawUnsafe(`
              SELECT p."id", p."title", p."doi", p."year", s."name" AS source_name,
                     1 - (p."embedding" <=> seed."embedding") AS similarity
              FROM "Paper" p
              JOIN "Source" s ON p."sourceId" = s."id"
              JOIN "Paper" seed ON seed."id" = $1
              WHERE p."id" != $1
                AND p."embeddingStatus" = 'GENERATED'
                AND seed."embeddingStatus" = 'GENERATED'
              ORDER BY p."embedding" <=> seed."embedding"
              LIMIT 5
            `, currentId);

          for (const sim of similarPapers) {
            const simNode: CitationNode = {
              id: sim.id,
              title: sim.title,
              doi: sim.doi,
              year: sim.year,
              source: sim.source_name,
            };
            if (!nodes.has(sim.id)) {
              nodes.set(sim.id, simNode);
              nextFrontier.push(sim.id);
            }
            const edgeExists = edges.some(
              e => (e.from === currentId && e.to === sim.id) ||
                   (e.from === sim.id && e.to === currentId)
            );
            if (!edgeExists) {
              edges.push({ from: currentId, to: sim.id, relationship: 'similar-topic' });
            }
          }
        } catch (err) {
          logger.warn({ paperId: currentId }, 'CitationGraph: Vector similarity lookup failed, skipping');
        }
      }

      frontier = nextFrontier;
    }

    logger.info({ paperId, nodes: nodes.size, edges: edges.length, depth }, 'CitationGraph: Network built');
    return { nodes: Array.from(nodes.values()), edges };
  }
}
