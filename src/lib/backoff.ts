// Shared bounded exponential backoff for transient provider/tool failures.
// Used by the serverless creator planner (api/creator-agent.ts) and the
// in-browser edit agent (apps/edit/src/browser-agent.ts).

export const RETRY_BACKOFF = {
  baseDelayMs: 1_000,
  factor: 2,
  maxAttempts: 3,
  maxDelayMs: 30_000,
} as const;

export type BackoffPolicy = {
  baseDelayMs: number;
  factor: number;
  maxDelayMs: number;
};

/** Delay before retry number `retry` (1-based): base * factor^(retry-1), capped. */
export function backoffDelayMs(retry: number, policy: BackoffPolicy = RETRY_BACKOFF): number {
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * policy.factor ** Math.max(0, retry - 1));
}

/** Sleep for the retry's backoff delay; rejects immediately if the signal aborts. */
export function backoffSleep(
  retry: number,
  signal?: AbortSignal,
  policy: BackoffPolicy = RETRY_BACKOFF,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('backoff_aborted'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('backoff_aborted'));
    };
    const timer = setTimeout(
      () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      },
      backoffDelayMs(retry, policy),
    );
    (timer as { unref?: () => void }).unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
