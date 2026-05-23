import { BrowserManager } from './BrowserManager';
import os from 'os';

export async function getBrowserHealth() {
  const browserManager = await BrowserManager.getInstance();
  const poolStats = browserManager.contextPool?.getStats() || { total: 0, active: 0, idle: 0 };
  
  let pageCount = 0;
  try {
    const browser = browserManager.getBrowser();
    pageCount = browser.contexts().reduce((acc, ctx) => acc + ctx.pages().length, 0);
  } catch (err) {
    // Browser might be down
  }

  const memoryUsage = process.memoryUsage();
  
  return {
    uptimeSeconds: process.uptime(),
    pool: poolStats,
    browser: {
      pageCount,
      activeContexts: poolStats.active
    },
    system: {
      freeMemMb: Math.round(os.freemem() / 1024 / 1024),
      totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
      processHeapUsedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      processRssMb: Math.round(memoryUsage.rss / 1024 / 1024)
    },
    status: 'healthy'
  };
}
