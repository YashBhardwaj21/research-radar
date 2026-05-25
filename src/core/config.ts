import dotenv from 'dotenv';
import path from 'path';

// Load .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Parse Redis host/port from REDIS_URL when individual vars aren't set
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379/0';
function parseRedisUrl(url: string): { host: string; port: number } {
  try {
    const parsed = new URL(url);
    return { host: parsed.hostname, port: parseInt(parsed.port || '6379', 10) };
  } catch {
    return { host: 'localhost', port: 6379 };
  }
}
const parsedRedis = parseRedisUrl(redisUrl);

// Cache versioning based on deployment state
const packageVersion = process.env.npm_package_version || '1.0.0';
const cacheVersion = process.env.GIT_SHA || packageVersion;

export const SOURCE_TTL: Record<string, number> = {
  pubmedextractor: 86400, // 24h
  arxivextractor: 21600, // 6h
  semanticscholarextractor: 43200 // 12h
};

export const config = {
  cacheVersion,
  environment: process.env.ENVIRONMENT || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  postgresUrl: process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/pipeline',
  redisUrl,
  redisHost: process.env.REDIS_HOST || parsedRedis.host,
  redisPort: parseInt(process.env.REDIS_PORT || String(parsedRedis.port), 10),
  browserHeadless: process.env.BROWSER_HEADLESS !== 'false',
  browserTimeoutMs: parseInt(process.env.BROWSER_TIMEOUT_MS || '30000', 10),
  maxWorkers: parseInt(process.env.MAX_WORKERS || '5', 10),
  maxContexts: parseInt(process.env.MAX_CONTEXTS || '10', 10),
  apiKey: process.env.API_KEY || 'default-secret-key-change-me',
  titleSimThreshold: parseFloat(process.env.TITLE_SIM_THRESHOLD || '0.92'),
  sourceWeights: process.env.SOURCE_WEIGHTS ? JSON.parse(process.env.SOURCE_WEIGHTS) : { pubmed: 1.10, arxiv: 1.03 },
  embeddingProvider: (process.env.EMBEDDING_PROVIDER || 'ollama') as 'ollama' | 'openai',
  embeddingBaseUrl: process.env.EMBEDDING_BASE_URL || 'http://localhost:11434', // For LM Studio use http://localhost:1234/v1
  embeddingModel: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
  embeddingDim: parseInt(process.env.EMBEDDING_DIM || '768', 10),
  sessionDir: process.env.SESSION_DIR || './sessions',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
};
