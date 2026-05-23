import fs from 'fs/promises';
import path from 'path';
import { BrowserContext } from 'playwright';
import { config } from '../core/config';
import { logger } from '../core/logger';
import { BrowserManager } from './BrowserManager';

export class SessionManager {
  private sessionDir: string;

  constructor() {
    this.sessionDir = path.resolve(process.cwd(), config.sessionDir);
  }

  public async init(): Promise<void> {
    try {
      await fs.mkdir(this.sessionDir, { recursive: true });
    } catch (err) {
      logger.error({ err }, 'Failed to create session directory');
    }
  }

  private getSessionPath(source: string): string {
    return path.join(this.sessionDir, `${source}_state.json`);
  }

  public async saveSession(context: BrowserContext, source: string): Promise<void> {
    const sessionPath = this.getSessionPath(source);
    try {
      await context.storageState({ path: sessionPath });
      logger.debug({ source, sessionPath }, 'Session state saved successfully');
    } catch (err) {
      logger.error({ err, source }, 'Failed to save session state');
    }
  }

  public async loadSession(source: string): Promise<string | undefined> {
    const sessionPath = this.getSessionPath(source);
    try {
      await fs.access(sessionPath);
      logger.debug({ source }, 'Found existing session state');
      return sessionPath;
    } catch (err) {
      return undefined;
    }
  }
}
