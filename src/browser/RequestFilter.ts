import { Page, Route, Request } from 'playwright';
import { logger } from '../core/logger';

const ABORT_RESOURCE_TYPES = new Set(['image', 'media', 'font', 'stylesheet']);
const ABORT_DOMAINS = [
  'google-analytics.com',
  'doubleclick.net',
  'facebook.net',
  'facebook.com',
  'twitter.com',
  'googletagmanager.com',
  'clarity.ms',
  'hotjar.com',
  'sentry.io'
];

/**
 * Attaches routing rules to a page to block unnecessary resources and trackers.
 * This significantly speeds up extraction and reduces bandwidth.
 */
export async function blockAdsAndTrackers(page: Page): Promise<void> {
  await page.route('**/*', (route: Route, request: Request) => {
    const type = request.resourceType();
    const url = request.url();

    // Block heavy resources
    if (ABORT_RESOURCE_TYPES.has(type)) {
      return route.abort();
    }

    // Block known trackers
    for (const domain of ABORT_DOMAINS) {
      if (url.includes(domain)) {
        return route.abort();
      }
    }

    return route.fallback();
  });

  logger.debug('RequestFilter: Attached Ad/Tracker blocking to page');
}
