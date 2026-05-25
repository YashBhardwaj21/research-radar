import { Page } from 'playwright';
import { logger } from '../core/logger';
import { globalRateLimiter } from './RateLimiter';
import path from 'path';
import crypto from 'crypto';

/**
 * Generates a random hash for screenshot naming
 */
function getHash(url: string): string {
  return crypto.createHash('md5').update(url).digest('hex').substring(0, 8);
}

/**
 * Safely navigates to a URL with exponential backoff retries and screenshots on failure.
 */
export async function safeGoto(page: Page, url: string, retries = 3, waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'networkidle'): Promise<boolean> {
  const domain = new URL(url).hostname;
  await globalRateLimiter.throttle(domain);

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await page.goto(url, { waitUntil, timeout: 30000 });
      
      if (response) {
        const status = response.status();
        if (status === 403 || status === 429) {
          throw new Error(`ERR_BLOCKED: Received HTTP ${status}. Rate limit or IP block detected.`);
        }
      }

      // CAPTCHA / Block Content Detection
      const pageContent = await page.content();
      const blockIndicators = ['captcha', 'cloudflare', 'unusual traffic', 'prove you are human', 'access denied', 'turn on javascript'];
      const lowerContent = pageContent.toLowerCase();
      
      for (const indicator of blockIndicators) {
        if (lowerContent.includes(indicator)) {
          const hasCaptcha = await page.$('iframe[src*="captcha"], #cf-challenge-form, .g-recaptcha').catch(() => null);
          if (hasCaptcha) {
            throw new Error(`ERR_CAPTCHA: Automated access blocked by CAPTCHA.`);
          }
        }
      }

      logger.info({ url, attempt }, 'Navigation success');
      return true;
    } catch (error: any) {
      logger.warn({ url, attempt, error: error.message }, 'Navigation failed');
      
      if (attempt < retries - 1) {
        // Exponential backoff
        const backoffMs = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        await screenshotOnFail(page, url, attempt);
      } else {
        await screenshotOnFail(page, url, attempt);
        throw error;
      }
    }
  }
  return false;
}

/**
 * Captures a full page screenshot on failure for observability.
 */
async function screenshotOnFail(page: Page, url: string, attempt: number): Promise<void> {
  try {
    const screenshotDir = path.resolve(process.cwd(), 'logs', 'screenshots');
    const fs = require('fs/promises');
    await fs.mkdir(screenshotDir, { recursive: true });
    
    const filePath = path.join(screenshotDir, `fail_${attempt}_${getHash(url)}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    logger.warn({ path: filePath }, 'Screenshot saved on failure');
  } catch (err) {
    // We swallow screenshot errors to prevent crashing the main pipeline
    logger.error({ err }, 'Failed to take failure screenshot');
  }
}

/**
 * Safely clicks an element with retries
 */
export async function safeClick(page: Page, selector: string, retries = 3): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await page.waitForSelector(selector, { state: 'visible', timeout: 10000 });
      await page.click(selector);
      return;
    } catch (error: any) {
      if (attempt === retries - 1) {
        await screenshotOnFail(page, page.url(), attempt);
        throw error;
      }
      const backoffMs = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
}

export async function waitForNetworkIdle(page: Page, timeoutMs = 5000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
}
