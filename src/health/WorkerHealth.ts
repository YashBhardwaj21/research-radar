import os from 'os';

/**
 * Tracks the health of an individual BullMQ worker independently of the queue.
 * Useful for diagnosing memory leaks or stuck state loops.
 */
export class WorkerHealth {
  private startTime: number = Date.now();
  private jobsProcessed: number = 0;
  private isStuck: boolean = false;

  public incrementJobsProcessed(): void {
    this.jobsProcessed++;
  }

  public setStuckState(stuck: boolean): void {
    this.isStuck = stuck;
  }

  public getHealth() {
    const memoryUsage = process.memoryUsage();
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      jobsProcessed: this.jobsProcessed,
      isStuck: this.isStuck,
      system: {
        freeMemMb: Math.round(os.freemem() / 1024 / 1024),
        processHeapUsedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        processRssMb: Math.round(memoryUsage.rss / 1024 / 1024)
      }
    };
  }
}
