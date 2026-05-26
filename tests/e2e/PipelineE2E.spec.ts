import { test, expect } from '@playwright/test';
// Note: In a real environment, you'd spin up Fastify, Redis, and Postgres before tests.

test.describe('E2E Pipeline Test', () => {
  test('API -> Queue -> DB', async ({ request }) => {
    // 1. Submit job to API
    const response = await request.post('http://localhost:3000/api/jobs', {
      data: { source: 'arxiv', query: 'Quantum Computing', maxResults: 2 },
      headers: { 'x-api-key': 'default-secret-key-change-me' }
    });
    
    expect(response.status()).toBe(202);
    const { jobId } = await response.json();
    expect(jobId).toBeDefined();

    // 2. Poll the search API directly to verify the pipeline completed and data was ingested
    await expect.poll(async () => {
      const searchRes = await request.post('http://localhost:3000/api/v1/search', {
        data: { query: 'Quantum Computing', source: 'arxiv', limit: 1 },
        headers: { 'x-api-key': 'default-secret-key-change-me' }
      });
      if (!searchRes.ok()) return 0;
      const data = await searchRes.json();
      return data.results ? data.results.length : 0;
    }, { 
      timeout: 60000, 
      message: 'Pipeline failed waiting for ingestion: no search results appeared.'
    }).toBeGreaterThan(0);
  });
});
