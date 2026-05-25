import { chromium, Browser, BrowserContext } from 'playwright';
import { EventEmitter } from 'events';
import { config } from '../core/config';
import { logger } from '../core/logger';
import { ContextPool } from './ContextPool';

export class BrowserManager extends EventEmitter {
  private static instance: BrowserManager;
  private browser: Browser | null = null;
  public contextPool: ContextPool | null = null;

  private constructor() {
    super();
  }

  public static async getInstance(): Promise<BrowserManager> {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
      await BrowserManager.instance.launch();
    }
    return BrowserManager.instance;
  }

  private async launch(): Promise<void> {
    logger.info({ headless: config.browserHeadless }, 'Launching browser instance...');
    this.browser = await chromium.launch({
      headless: config.browserHeadless,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    this.contextPool = new ContextPool(this.browser, config.maxContexts);

    this.browser.on('disconnected', () => {
      logger.error('Playwright Browser disconnected unexpectedly!');
      this.emit('BrowserCrashedEvent');
      this.browser = null;
      this.contextPool = null;
    });

    logger.info('Browser instance launched successfully');
  }

  public getBrowser(): Browser {
    if (!this.browser) {
      throw new Error('Browser is not launched');
    }
    return this.browser;
  }

  public async shutdown(): Promise<void> {
    if (this.contextPool) {
      await this.contextPool.closeAll();
    }
    if (this.browser) {
      // Remove the disconnected listener so it doesn't trigger a crash event during normal shutdown
      this.browser.removeAllListeners('disconnected');
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    logger.info('Browser instance shut down');
  }

  public async restart(): Promise<void> {
    logger.warn('Restarting BrowserManager after crash...');
    await this.shutdown(); // ensure any dangling handlers are removed
    await this.launch();
  }
}
