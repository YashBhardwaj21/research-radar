import pino from 'pino';
import { config } from './config';
import { AsyncLocalStorage } from 'async_hooks';

export interface LogContext {
  job_id?: string;
  source?: string;
  worker_id?: string;
  requestId?: string;
  traceId?: string;
}

export const logContext = new AsyncLocalStorage<LogContext>();

import os from 'os';
const globalWorkerId = `${os.hostname()}-${process.pid}`;

export const logger = pino({
  level: config.logLevel,
  mixin() {
    const context = logContext.getStore();
    return { worker_id: globalWorkerId, ...context };
  },
  transport: config.environment === 'development'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
        },
      }
    : undefined,
});
