import { Browser, BrowserContext, BrowserContextOptions } from 'playwright';
import { logger } from '../core/logger';

interface PooledContext {
  context: BrowserContext;
  inUse: boolean;
  useCount: number;
  lastUsedAt: number;
}

export class ContextPool {
  private pool: PooledContext[] = [];
  private maxContexts: number;
  private browser: Browser;
  private maxUsesPerContext = 100;
  private waitQueue: Array<() => void> = [];

  constructor(browser: Browser, maxContexts: number) {
    this.browser = browser;
    this.maxContexts = maxContexts;
  }

  public async acquireContext(options?: BrowserContextOptions): Promise<BrowserContext> {
    // Try to find an available context in the pool (without specific options, or if options can be matched - for simplicity, we create fresh contexts for specific options and don't pool them, or we pool generic contexts).
    // Actually, storageState differs per site. We might just create contexts up to max limit.
    // For this implementation, we will track the number of active contexts.
    
    // Cleanup stale/overused contexts first
    await this.cleanup();

    while (this.pool.length >= this.maxContexts) {
      logger.debug('Max contexts reached, queuing request');
      await new Promise<void>(resolve => {
        this.waitQueue.push(resolve);
      });
      await this.cleanup();
    }

    const context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...options,
    });

    const pooledContext: PooledContext = {
      context,
      inUse: true,
      useCount: 1,
      lastUsedAt: Date.now(),
    };

    this.pool.push(pooledContext);
    logger.debug({ activeContexts: this.pool.length }, 'Acquired new browser context');

    return context;
  }

  public async releaseContext(context: BrowserContext): Promise<void> {
    const index = this.pool.findIndex(p => p.context === context);
    if (index !== -1) {
      const pooled = this.pool[index];
      pooled.inUse = false;
      pooled.lastUsedAt = Date.now();
      
      if (pooled.useCount >= this.maxUsesPerContext) {
        await this.removeContext(index);
      }
    } else {
      // Not in pool, just close it
      await context.close().catch(() => {});
    }
    
    this.processQueue();
  }

  private processQueue() {
    if (this.waitQueue.length > 0 && this.pool.length < this.maxContexts) {
      const resolve = this.waitQueue.shift();
      if (resolve) {
        resolve();
      }
    }
  }

  private async removeContext(index: number): Promise<void> {
    const pooled = this.pool[index];
    this.pool.splice(index, 1);
    await pooled.context.close().catch(err => logger.error({ err }, 'Error closing context'));
    logger.debug({ remaining: this.pool.length }, 'Closed and removed context from pool');
  }

  private async cleanup(): Promise<void> {
    const now = Date.now();
    // Close unused contexts that have been idle for > 5 minutes
    const staleTime = 5 * 60 * 1000;

    for (let i = this.pool.length - 1; i >= 0; i--) {
      const pooled = this.pool[i];
      if (!pooled.inUse && (now - pooled.lastUsedAt > staleTime)) {
        await this.removeContext(i);
      }
    }
  }

  public async closeAll(): Promise<void> {
    for (const p of this.pool) {
      await p.context.close().catch(err => logger.error({ err }, 'Error closing context on shutdown'));
    }
    this.pool = [];
  }

  public getStats() {
    return {
      total: this.pool.length,
      active: this.pool.filter(p => p.inUse).length,
      idle: this.pool.filter(p => !p.inUse).length,
    };
  }
}
