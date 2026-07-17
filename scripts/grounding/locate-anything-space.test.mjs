import { describe, expect, it } from 'vitest';
import { toLocateResult } from './locate-anything-space.mjs';

const request = {
  requestId: 'request.test',
  traceId: 'trace.test',
  assetId: 'asset.test',
  cardinality: 'one',
};

describe('LocateAnything Space normalization', () => {
  it('converts provider 0-1000 coordinates into a contract box', () => {
    const result = toLocateResult(request, {
      modelId: 'nvidia/LocateAnything-3B',
      detections: [{ label: 'dancer', type: 'box', coords: [481, 165, 999, 892] }],
    });
    expect(result.status).toBe('valid');
    expect(result.observations[0].geometry.box).toEqual({
      x: 0.481,
      y: 0.165,
      width: 0.518,
      height: 0.727,
    });
    expect(result.observations[0].confidence).toBeUndefined();
  });

  it('fails closed as ambiguous when a one-result request receives multiple boxes', () => {
    const result = toLocateResult(request, {
      modelId: 'nvidia/LocateAnything-3B',
      detections: [
        { label: 'left dancer', type: 'box', coords: [10, 10, 200, 500] },
        { label: 'right dancer', type: 'box', coords: [600, 10, 900, 500] },
      ],
    });
    expect(result.status).toBe('ambiguous');
  });
});
