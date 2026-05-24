import { config } from '../core/config';
import { logger } from '../core/logger';

/**
 * EmbeddingService wraps the Ollama REST API for local embedding generation.
 * Uses `nomic-embed-text` (768-dim) by default.
 *
 * NOTE: Embedding dimensions are tightly coupled to the configured embedding model.
 * Changing models requires a raw SQL migration to alter the pgvector column size.
 */
export class EmbeddingService {
  private baseUrl: string;
  private model: string;

  constructor() {
    this.baseUrl = config.ollamaBaseUrl;
    this.model = config.embeddingModel;
  }

  /**
   * Generates a dense vector embedding for the provided text.
   * Returns a number[] of length equal to the model's dimensionality (768 for nomic-embed-text).
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const url = `${this.baseUrl}/api/embed`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama embedding failed (${response.status}): ${body}`);
    }

    const data = await response.json() as { embeddings: number[][] };

    if (!data.embeddings || !data.embeddings[0]) {
      throw new Error('Ollama returned empty embeddings array');
    }

    logger.debug({ model: this.model, dim: data.embeddings[0].length }, 'EmbeddingService: Generated embedding');
    return data.embeddings[0];
  }
}
