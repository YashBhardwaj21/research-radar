import { logger } from '../core/logger';

/**
 * Advanced Circuit Breaker pattern.
 * Tracks consecutive failures per source and places a domain on cooldown 
 * to avoid IP bans when a threshold is breached.
 */
export class SourceHealthManager {
  private static instance: SourceHealthManager;
  private failures: Map<string, number[]> = new Map();
  private cooldowns: Map<string, number> = new Map();

  // E.g., 10 failures
  private readonly FAILURE_THRESHOLD = 10;
  // within 5 minutes
  private readonly WINDOW_MS = 5 * 60 * 1000;
  // triggers 15 minute cooldown
  private readonly COOLDOWN_MS = 15 * 60 * 1000;

  private constructor() {}

  public static getInstance(): SourceHealthManager {
    if (!SourceHealthManager.instance) {
      SourceHealthManager.instance = new SourceHealthManager();
    }
    return SourceHealthManager.instance;
  }

  public recordFailure(source: string): void {
    const now = Date.now();
    const history = this.failures.get(source) || [];
    
    // Clean up old failures outside the window
    const recentFailures = history.filter(time => now - time < this.WINDOW_MS);
    recentFailures.push(now);
    
    this.failures.set(source, recentFailures);

    if (recentFailures.length >= this.FAILURE_THRESHOLD) {
      logger.warn({ source, failures: recentFailures.length, cooldownMinutes: this.COOLDOWN_MS / 60000 }, 'SourceHealthManager: Circuit breaker tripped! Source is now on cooldown.');
      this.cooldowns.set(source, now + this.COOLDOWN_MS);
      
      // Reset history after tripping to prevent immediate re-trip after cooldown
      this.failures.set(source, []);
    }
  }

  public isAvailable(source: string): boolean {
    const cooldownUntil = this.cooldowns.get(source);
    if (!cooldownUntil) return true;

    const now = Date.now();
    if (now > cooldownUntil) {
      // Cooldown expired
      this.cooldowns.delete(source);
      logger.info({ source }, 'SourceHealthManager: Cooldown expired. Source is available again.');
      return true;
    }

    return false;
  }
}
