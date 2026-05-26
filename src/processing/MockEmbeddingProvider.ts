import { EmbeddingProvider } from './EmbeddingProvider';

export class MockEmbeddingProvider implements EmbeddingProvider {
  async generate(text: string): Promise<number[]> {
    // Return a dummy 768-dimensional vector so pgvector similarity search still works perfectly
    return Array(768).fill(0.1);
  }
}
