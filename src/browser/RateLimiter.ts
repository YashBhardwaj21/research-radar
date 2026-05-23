import { logger } from '../core/logger';

export class RateLimiter {
  private domainLocks: Map<string, Promise<void>> = new Map();

  /**
   * Applies an adaptive delay for a specific domain.
   * Uses a Promise chain to stagger concurrent requests, avoiding race conditions.
   */
  public async throttle(domain: string, minDelayMs = 2000, maxDelayMs = 5000): Promise<void> {
    const currentLock = this.domainLocks.get(domain) || Promise.resolve();

    const nextLock = currentLock.then(async () => {
      const jitter = Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;
      logger.debug({ domain, waitTime: jitter }, 'Throttling request to domain');
      await new Promise(resolve => setTimeout(resolve, jitter));
    });

    this.domainLocks.set(domain, nextLock);
    await nextLock;
  }
}

export const globalRateLimiter = new RateLimiter();
