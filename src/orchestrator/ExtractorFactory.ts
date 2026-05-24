import { BaseExtractor } from '../extractors/BaseExtractor';
import { PubMedExtractor } from '../extractors/PubMedExtractor';
import { ArxivExtractor } from '../extractors/ArxivExtractor';
import { SemanticScholarExtractor } from '../extractors/SemanticScholarExtractor';

export class ExtractorFactory {
  /**
   * Instantiates the correct extractor implementation based on the source name.
   * This decouples the worker routing logic from the scraping logic.
   */
  public static getExtractor(source: string): BaseExtractor {
    switch (source.toLowerCase()) {
      case 'pubmed':
        return new PubMedExtractor();
      case 'arxiv':
        return new ArxivExtractor();
      case 'semanticscholar':
        return new SemanticScholarExtractor();
      default:
        throw new Error(`Unsupported extraction source: ${source}`);
    }
  }
}
