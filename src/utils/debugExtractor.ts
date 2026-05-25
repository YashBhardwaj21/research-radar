import fs from 'fs/promises';
import path from 'path';
import { Page } from 'playwright';
import { logger } from '../core/logger';

export async function debugSnapshot(
  page: Page,
  extractor: string,
  stage: string,
  jobId?: string
) {
  const ts = Date.now();
  const dir = `traces/${extractor}`;

  await fs.mkdir(dir, { recursive: true }).catch(() => {});

  const screenshot = path.join(dir, `${stage}-${ts}.png`);
  const html = path.join(dir, `${stage}-${ts}.html`);

  try {
    await page.screenshot({ path: screenshot, fullPage: true });
    await fs.writeFile(html, await page.content());

    logger.info({
      extractor,
      stage,
      url: page.url(),
      title: await page.title().catch(() => ''),
      screenshot,
      html
    }, 'TRACE');
  } catch (err) {
    logger.error({ err }, 'SNAPSHOT FAILED');
  }
}
