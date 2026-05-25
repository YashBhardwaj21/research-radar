import { BrowserManager } from '../browser/BrowserManager';
import { Page, BrowserContext } from 'playwright';

export interface PaperMetadata {
  title: string;
  authors: string[];
  abstract?: string;
  doi?: string;
  year?: number;
  source: string;
  url: string;
  pdfUrl?: string;
}

export abstract class BaseExtractor {
  // Extractors no longer manage their own contexts. The Orchestrator manages the context
  // and injects it. This allows the Orchestrator to force-kill the context on timeouts.

  abstract get sourceName(): string;

  /**
   * Search for papers given a query
   */
  abstract search(context: BrowserContext, query: string, maxResults?: number): Promise<PaperMetadata[]>;

  /**
   * Extract details from a specific paper URL
   */
  abstract extractPaper(context: BrowserContext, url: string): Promise<PaperMetadata>;
}
