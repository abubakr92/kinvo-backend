import type { Logger } from 'pino';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id for this request. Set by the requestId middleware. */
      id: string;
      /** Request-scoped child logger carrying `request_id`. */
      log: Logger;
    }
  }
}

export {};
