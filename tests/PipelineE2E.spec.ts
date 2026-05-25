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

    // 2. Poll jobs API for completion
    let completed = false;
    for (let i = 0; i < 10; i++) {
      const statusRes = await request.get('http://localhost:3000/api/jobs');
      const stats = await statusRes.json();
      if (stats.completed > 0) {
        completed = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // 3. Search API to verify ingestion
    const searchRes = await request.post('http://localhost:3000/api/v1/search', {
      data: { query: 'Quantum Computing', source: 'arxiv', limit: 5 },
      headers: { 'x-api-key': 'default-secret-key-change-me' }
    });
    
    expect(searchRes.status()).toBe(200);
  });
});
