import { test, expect } from '@playwright/test';
import { Deduplicator } from '../src/processing/Deduplicator';
import levenshtein from 'fast-levenshtein';

test.describe('Deduplicator Unit Tests', () => {
  test('normalizeTitle removes special characters and lowercases', () => {
    const title = 'ADHD in Adults: A comprehensive review (2024)!';
    const normalized = Deduplicator.normalizeTitle(title);
    expect(normalized).toBe('adhdinadultsacomprehensivereview2024');
  });

  test('Fuzzy matching recognizes similar titles', () => {
    const title1 = Deduplicator.normalizeTitle('ADHD in Adults');
    const title2 = Deduplicator.normalizeTitle('ADHD in Adult populations');
    
    const distance = levenshtein.get(title1, title2);
    const maxLen = Math.max(title1.length, title2.length);
    const similarity = 1 - (distance / maxLen);
    
    // They should not match if threshold is 0.92, this ensures our test shows the difference
    expect(similarity).toBeLessThan(0.92);

    const title3 = Deduplicator.normalizeTitle('Effects of Sleep');
    const title4 = Deduplicator.normalizeTitle('Effect of Sleep');
    const sim2 = 1 - (levenshtein.get(title3, title4) / Math.max(title3.length, title4.length));
    
    expect(sim2).toBeGreaterThanOrEqual(0.92); // These should match
  });
});
