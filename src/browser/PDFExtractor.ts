import { BrowserContext } from 'playwright';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { config } from '../core/config';
import { logger } from '../core/logger';
import pdfParse from 'pdf-parse';

const pool = new Pool({ connectionString: config.postgresUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export class PDFExtractor {
  
  /**
   * Navigates to a PDF URL using Playwright's request context (to bypass basic bot protections),
   * downloads the buffer, and parses the text using pdf-parse.
   */
  static async extractTextFromPDF(context: BrowserContext, pdfUrl: string): Promise<string> {
    logger.info({ pdfUrl }, 'PDFExtractor: Attempting to download PDF');
    
    // Use Playwright's APIRequestContext to inherit cookies/user-agent
    const response = await context.request.get(pdfUrl, {
      timeout: 30000,
    });

    if (!response.ok()) {
      throw new Error(`Failed to fetch PDF from ${pdfUrl}: ${response.status()} ${response.statusText()}`);
    }

    const buffer = await response.body();
    logger.info({ pdfUrl, bytes: buffer.length }, 'PDFExtractor: PDF downloaded successfully');

    const data = await pdfParse(buffer);
    return data.text;
  }

  /**
   * Fully processes a Paper by downloading its PDF and saving the text to PaperContent.
   */
  static async processPaper(context: BrowserContext, paperId: string, pdfUrl: string): Promise<void> {
    try {
      const existing = await prisma.paperContent.findUnique({ where: { paperId } });
      if (existing) {
        logger.info({ paperId }, 'PDFExtractor: PaperContent already exists. Skipping.');
        return;
      }

      const fullText = await this.extractTextFromPDF(context, pdfUrl);

      await prisma.paperContent.create({
        data: {
          paperId,
          fullText,
        }
      });

      logger.info({ paperId, textLength: fullText.length }, 'PDFExtractor: Saved PaperContent successfully');
    } catch (err: any) {
      logger.error({ paperId, pdfUrl, err: err.message }, 'PDFExtractor: Failed to process paper PDF');
      throw err;
    }
  }
}
