import { EmbeddingProvider } from './EmbeddingProvider';
import { config } from '../core/config';
import { logger } from '../core/logger';

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;
  private model: string;

  constructor() {
    this.baseUrl = config.ollamaBaseUrl;
    this.model = config.embeddingModel;
  }

  async generate(text: string): Promise<number[]> {
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

    logger.debug({ model: this.model, dim: data.embeddings[0].length }, 'OllamaEmbeddingProvider: Generated embedding');
    return data.embeddings[0];
  }
}
