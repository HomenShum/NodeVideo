import { describe, expect, test } from 'vitest';
import { RETRY_BACKOFF, backoffDelayMs, backoffSleep } from './backoff';

describe('bounded retry backoff', () => {
  test('an agent hammered by transient provider failures waits on a growing, capped schedule', () => {
    // The schedule grows exponentially from the base...
    expect(backoffDelayMs(1)).toBe(RETRY_BACKOFF.baseDelayMs);
    expect(backoffDelayMs(2)).toBe(RETRY_BACKOFF.baseDelayMs * RETRY_BACKOFF.factor);
    expect(backoffDelayMs(3)).toBe(RETRY_BACKOFF.baseDelayMs * RETRY_BACKOFF.factor ** 2);
    // ...is monotonically non-decreasing...
    const schedule = Array.from({ length: 12 }, (_, index) => backoffDelayMs(index + 1));
    for (let index = 1; index < schedule.length; index += 1) {
      expect(schedule[index]).toBeGreaterThanOrEqual(schedule[index - 1]);
    }
    // ...and never exceeds the cap, even for absurd retry counts an agent loop could reach.
    expect(backoffDelayMs(99)).toBe(RETRY_BACKOFF.maxDelayMs);
    expect(Math.max(...schedule)).toBeLessThanOrEqual(RETRY_BACKOFF.maxDelayMs);
    expect(RETRY_BACKOFF.maxDelayMs).toBeGreaterThanOrEqual(RETRY_BACKOFF.baseDelayMs);
    expect(RETRY_BACKOFF.maxAttempts).toBeLessThanOrEqual(3);
  });

  test('a user who cancels mid-backoff is not held hostage by the sleep', async () => {
    const controller = new AbortController();
    const pending = backoffSleep(1, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('backoff_aborted');
    // An already-aborted signal never starts the timer.
    await expect(backoffSleep(1, controller.signal)).rejects.toThrow('backoff_aborted');
  });
});
