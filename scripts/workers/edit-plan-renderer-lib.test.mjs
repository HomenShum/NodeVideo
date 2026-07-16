import { describe, expect, it } from 'vitest';

import { sourceRangeSeconds } from './edit-plan-renderer-lib.mjs';

describe('sourceRangeSeconds', () => {
  it('keeps EditPlan frame ranges time-correct for higher-rate source media', () => {
    expect(sourceRangeSeconds({ startFrame: 0, endFrameExclusive: 1149 }, 30)).toEqual({
      start: 0,
      end: 38.3,
    });
  });

  it('preserves non-zero source offsets in EditPlan time', () => {
    expect(sourceRangeSeconds({ startFrame: 90, endFrameExclusive: 150 }, 30)).toEqual({
      start: 3,
      end: 5,
    });
  });
});
