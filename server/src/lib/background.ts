import { logger } from './logger.js';

const inflight = new Set<Promise<unknown>>();

/**
 * Runs work after the response has been sent, so response time does not depend on it (for
 * example, whether a password-reset email was sent to an existing account). Failures are logged.
 */
export function runInBackground(label: string, work: () => Promise<unknown>) {
  const p = work().catch((e) => logger.error({ task: label, error: String((e as Error)?.message ?? e).slice(0, 300) }, 'background task failed'));
  inflight.add(p);
  p.finally(() => inflight.delete(p));
}

/** Waits for background work to finish. Used by tests and on shutdown. */
export async function flushBackground() {
  while (inflight.size) await Promise.allSettled([...inflight]);
}
