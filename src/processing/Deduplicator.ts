import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { logger } from '../core/logger';
import { config } from '../core/config';
import levenshtein from 'fast-levenshtein';
import { PaperMetadata } from '../extractors/BaseExtractor';

const pool = new Pool({ connectionString: config.postgresUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export class Deduplicator {
  /**
   * Normalizes a title for robust comparison:
   * - Lowercase
   * - Remove all non-alphanumeric characters (punctuation, special chars)
   */
  static normalizeTitle(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Processes a paper extracted from a source, checks for duplicates,
   * and inserts it into the database if new.
   * Returns the database ID of the paper (existing or new) and a boolean indicating if it was new.
   */
  static async processAndInsert(metadata: PaperMetadata, sourceName: string): Promise<{ paperId: string; isNew: boolean }> {
    // Check for exact DOI match
    if (metadata.doi) {
      const existingByDoi = await prisma.paper.findUnique({ where: { doi: metadata.doi } });
      if (existingByDoi) {
        logger.debug({ doi: metadata.doi }, 'Deduplicator: Duplicate found via DOI');
        return { paperId: existingByDoi.id, isNew: false };
      }
    }

    // Check for exact URL match
    if (metadata.url) {
      const existingByUrl = await prisma.paper.findUnique({ where: { url: metadata.url } });
      if (existingByUrl) {
        logger.debug({ url: metadata.url }, 'Deduplicator: Duplicate found via URL');
        return { paperId: existingByUrl.id, isNew: false };
      }
    }

    // Check for exact normalized title match
    const normalizedTitle = this.normalizeTitle(metadata.title);
    if (normalizedTitle && normalizedTitle.length > 5) {
      const existingByTitle = await prisma.paper.findFirst({ where: { normalizedTitle } });
      if (existingByTitle) {
        logger.debug({ title: metadata.title }, 'Deduplicator: Duplicate found via Normalized Title');
        return { paperId: existingByTitle.id, isNew: false };
      }
    }

    // Check source and prepare for insertion
    const actualSource = metadata.source || sourceName;
    let dbSource = await prisma.source.findUnique({ where: { name: actualSource } });
    if (!dbSource) {
      dbSource = await prisma.source.create({ data: { name: actualSource } });
      logger.info({ source: actualSource }, 'connectOrCreate source (created)');
    } else {
      logger.info({ source: actualSource }, 'connectOrCreate source (found)');
    }

    // Perform fuzzy check against recent candidates for the same source and year
    if (normalizedTitle && normalizedTitle.length > 5 && dbSource) {
      const candidates = await prisma.paper.findMany({
        where: { year: metadata.year, sourceId: dbSource.id },
        select: { id: true, normalizedTitle: true },
        take: 500, // limit to recent for performance
        orderBy: { createdAt: 'desc' }
      });

      for (const candidate of candidates) {
        if (!candidate.normalizedTitle) continue;
        const distance = levenshtein.get(normalizedTitle, candidate.normalizedTitle);
        const maxLen = Math.max(normalizedTitle.length, candidate.normalizedTitle.length);
        const similarity = 1 - (distance / maxLen);

        if (similarity >= config.titleSimThreshold) {
          logger.debug({ title: metadata.title, similarity }, 'Deduplicator: Duplicate found via Fuzzy Title');
          return { paperId: candidate.id, isNew: false };
        }
      }
    }

    // Insert Authors safely. We can use connectOrCreate for the Many-to-Many relationship.
    const authorConnectOrCreate = metadata.authors
      .filter((a: string) => a && a.trim().length > 0)
      .map((authorName: string) => ({
        author: {
          connectOrCreate: {
            where: { name: authorName.trim() },
            create: { name: authorName.trim() },
          }
        }
      }));

    logger.info({ title: metadata.title, source: actualSource, url: metadata.url }, 'Deduplicator: Paper before insert');

    try {
      const newPaper = await prisma.paper.create({
        data: {
          title: metadata.title,
          normalizedTitle,
          abstract: metadata.abstract,
          doi: metadata.doi,
          url: metadata.url,
          year: metadata.year,
          sourceId: dbSource.id,
          scrapedAt: new Date(),
          extractorVersion: metadata.extractorVersion || 'unknown',
          originatingQuery: metadata.originatingQuery || 'unknown',
          embeddingModel: config.embeddingModel,
          authors: {
            create: authorConnectOrCreate
          }
        }
      });
      logger.debug({ paperId: newPaper.id }, 'Deduplicator: Inserted new paper');
      return { paperId: newPaper.id, isNew: true };
    } catch (err: any) {
      // Handle edge cases where concurrent inserts try to create the same URL/DOI exactly at the same time
      logger.warn({ err: err.message, url: metadata.url }, 'Deduplicator: Conflict during insertion, likely a race condition.');
      // Attempt to fetch it again
      const raceExisting = await prisma.paper.findUnique({ where: { url: metadata.url } });
      if (raceExisting) {
        return { paperId: raceExisting.id, isNew: false };
      }
      throw err; // Rethrow if it wasn't a unique constraint violation we can recover from
    }
  }
}
