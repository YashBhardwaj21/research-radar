export type ScrapeSource = 'pubmed' | 'arxiv' | 'semanticscholar' | 'all';

export interface ScrapeJobPayload {
  job_id: string;       // Deterministic: hash(source + query)
  source: ScrapeSource;
  query: string;
  maxResults?: number;
  refresh?: boolean;
}

// Errors that should bypass retries and go directly to Dead Letter Queue
export const NON_RETRYABLE_CODES = [
  'ERR_403',
  'ERR_BLOCKED',
  'ERR_CAPTCHA',
  'ERR_AUTH',
];

export interface EmbeddingJobPayload {
  paperId: string;
  textToEmbed: string; // The concatenated Title + Abstract
}
