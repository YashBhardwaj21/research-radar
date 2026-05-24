import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from '../core/config';
import { logger } from '../core/logger';

const pool = new Pool({ connectionString: config.postgresUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export interface TrendPoint {
  year: number;
  count: number;
}

export interface TrendResult {
  topic: string;
  totalPapers: number;
  trend: TrendPoint[];
  growthRate: number | null; // % change between last two available years
  topAuthors: Array<{ name: string; count: number }>;
}

/**
 * TrendAnalyzer computes publication volume trends per year
 * for a given topic, based on papers already in the local database.
 *
 * This is infrastructure-level analysis over scraped data,
 * not an AI feature — it's aggregation + time-series.
 */
export class TrendAnalyzer {

  async analyze(topic: string): Promise<TrendResult> {
    const lowerTopic = topic.toLowerCase();

    // Papers whose title or abstract contains the topic keyword
    const papers = await prisma.paper.findMany({
      where: {
        OR: [
          { title: { contains: topic, mode: 'insensitive' } },
          { abstract: { contains: topic, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        year: true,
        authors: {
          include: { author: true },
        },
      },
    });

    // Build year histogram
    const yearMap = new Map<number, number>();
    const authorMap = new Map<string, number>();

    for (const paper of papers) {
      if (paper.year) {
        yearMap.set(paper.year, (yearMap.get(paper.year) || 0) + 1);
      }
      for (const pa of paper.authors) {
        const name = pa.author.name;
        authorMap.set(name, (authorMap.get(name) || 0) + 1);
      }
    }

    // Sort by year
    const trend: TrendPoint[] = Array.from(yearMap.entries())
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year - b.year);

    // Growth rate between last two years
    let growthRate: number | null = null;
    if (trend.length >= 2) {
      const last = trend[trend.length - 1].count;
      const prev = trend[trend.length - 2].count;
      if (prev > 0) {
        growthRate = Math.round(((last - prev) / prev) * 100);
      }
    }

    // Top 10 authors
    const topAuthors = Array.from(authorMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    logger.info({ topic, totalPapers: papers.length, yearsCovered: trend.length }, 'TrendAnalyzer: Analysis complete');

    return {
      topic,
      totalPapers: papers.length,
      trend,
      growthRate,
      topAuthors,
    };
  }
}
