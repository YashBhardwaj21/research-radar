import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PaperMetadata } from '../extractors/BaseExtractor';
import { logger } from '../core/logger';
import { config } from '../core/config';

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
    // 1. Check DOI
    if (metadata.doi) {
      const existingByDoi = await prisma.paper.findUnique({ where: { doi: metadata.doi } });
      if (existingByDoi) {
        logger.debug({ doi: metadata.doi }, 'Deduplicator: Duplicate found via DOI');
        return { paperId: existingByDoi.id, isNew: false };
      }
    }

    // 2. Check URL
    if (metadata.url) {
      const existingByUrl = await prisma.paper.findUnique({ where: { url: metadata.url } });
      if (existingByUrl) {
        logger.debug({ url: metadata.url }, 'Deduplicator: Duplicate found via URL');
        return { paperId: existingByUrl.id, isNew: false };
      }
    }

    // 3. Check Normalized Title
    const normalizedTitle = this.normalizeTitle(metadata.title);
    if (normalizedTitle && normalizedTitle.length > 5) {
      const existingByTitle = await prisma.paper.findFirst({ where: { normalizedTitle } });
      if (existingByTitle) {
        logger.debug({ title: metadata.title }, 'Deduplicator: Duplicate found via Normalized Title');
        return { paperId: existingByTitle.id, isNew: false };
      }
    }

    // 4. Insert New Record
    let dbSource = await prisma.source.findUnique({ where: { name: sourceName } });
    if (!dbSource) {
      dbSource = await prisma.source.create({ data: { name: sourceName } });
    }

    // Insert Authors safely. We can use connectOrCreate for the Many-to-Many relationship.
    const authorConnectOrCreate = metadata.authors
      .filter(a => a && a.trim().length > 0)
      .map((authorName) => ({
        author: {
          connectOrCreate: {
            where: { name: authorName.trim() },
            create: { name: authorName.trim() },
          }
        }
      }));

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
