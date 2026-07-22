import { describe, expect, it } from 'vitest';
import { cohensKappa, median, wilsonRate } from './creatorbench-statistics';

describe('CreatorBench statistics', () => {
  it('publishes counts with a Wilson confidence interval', () => {
    const result = wilsonRate(70, 100);
    expect(result.rate).toBe(0.7);
    expect(result.confidenceInterval.lower).toBeLessThan(0.7);
    expect(result.confidenceInterval.upper).toBeGreaterThan(0.7);
  });
  it('measures correction time and reviewer agreement without a quality scalar', () => {
    expect(median([1, 3, 2, 10])).toBe(2.5);
    expect(cohensKappa(['usable', 'bad', 'usable'], ['usable', 'bad', 'bad'])).toBeLessThan(1);
  });
});
