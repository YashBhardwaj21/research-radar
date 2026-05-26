import { test, expect } from '@playwright/test';
import { ArxivExtractor } from '../../src/extractors/ArxivExtractor';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Integration: Extractors', () => {
  let arxivExtractor: ArxivExtractor;

  test.beforeEach(async ({ context }) => {
    arxivExtractor = new ArxivExtractor();

    // Read the mock HTML fixture
    const arxivHtml = fs.readFileSync(path.join(__dirname, '../fixtures/arxiv.html'), 'utf-8');

    // Mock ALL requests to arxiv.org in this BrowserContext
    await context.route('https://arxiv.org/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: arxivHtml,
      });
    });
  });

  test('ArxivExtractor should correctly parse mocked HTML', async ({ context }) => {
    const results = await arxivExtractor.search(context, 'Quantum Computing', 1);
    
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Quantum Computing Advancements');
    expect(results[0].authors).toEqual(['Alan Turing', 'John von Neumann']);
    expect(results[0].abstract).toBe('This paper discusses advancements in quantum computing.');
    expect(results[0].url).toBe('https://arxiv.org/abs/2101.12345');
    expect(results[0].pdfUrl).toBe('https://arxiv.org/pdf/2101.12345');
  });
});
