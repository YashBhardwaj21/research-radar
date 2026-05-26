import { EmbeddingProvider } from './EmbeddingProvider';
import { OllamaEmbeddingProvider } from './OllamaEmbeddingProvider';
import { MockEmbeddingProvider } from './MockEmbeddingProvider';

interface ProviderConfig {
  mock?: string | boolean;
}

export function createEmbeddingProvider(config: ProviderConfig): EmbeddingProvider {
  if (config.mock === 'true' || config.mock === true) {
    return new MockEmbeddingProvider();
  }
  return new OllamaEmbeddingProvider();
}

// Instantiate the singleton provider for the application
export const embeddingProvider = createEmbeddingProvider({
  mock: process.env.MOCK_EMBEDDINGS || process.env.CI
});
