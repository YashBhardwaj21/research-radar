import { Page, Response } from 'playwright';
import { logger } from '../core/logger';

/**
 * Attaches a listener to capture raw JSON payloads from XHR/Fetch API responses.
 * This completely bypasses fragile DOM scraping for modern web applications.
 * 
 * @param page The Playwright Page instance
 * @param urlPattern The regex pattern of the API endpoint to intercept
 * @returns A promise that resolves with the parsed JSON payload
 */
export async function captureApiResponse<T>(page: Page, urlPattern: RegExp): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // We add a timeout just in case the API call never fires
    const timeout = setTimeout(() => {
      page.removeListener('response', handler);
      reject(new Error(`Timed out waiting for API response matching pattern: ${urlPattern}`));
    }, 30000);

    const handler = async (response: Response) => {
      try {
        const url = response.url();
        if (urlPattern.test(url) && response.request().resourceType() === 'fetch' || response.request().resourceType() === 'xhr') {
          // Check for successful status
          if (response.status() >= 200 && response.status() < 300) {
            clearTimeout(timeout);
            page.removeListener('response', handler);
            
            logger.debug({ url }, 'NetworkInterceptor: Captured target API response');
            const json = await response.json();
            resolve(json as T);
          }
        }
      } catch (err) {
        // Log but don't reject yet, as there might be multiple responses and this one just failed to parse
        logger.debug({ err }, 'NetworkInterceptor: Failed to parse a matched response as JSON');
      }
    };

    page.on('response', handler);
  });
}
