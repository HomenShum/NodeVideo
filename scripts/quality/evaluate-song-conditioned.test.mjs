import assert from 'node:assert/strict';
import { test } from 'vitest';
import { comparePlans, neutralSourceLabel } from './evaluate-song-conditioned.mjs';

test('scores cut proximity and source identity without preserving asset names', () => {
  assert.equal(neutralSourceLabel('asset.take-a'), 'A');
  assert.equal(neutralSourceLabel('asset.source-a-original'), 'A');
  assert.equal(neutralSourceLabel('asset.take-b'), 'B');
  assert.equal(neutralSourceLabel('asset.chosen-song'), null);

  const result = comparePlans(
    plan([clip('asset.take-a', 0, 30), clip('asset.take-b', 30, 60), clip('asset.take-a', 60, 90)]),
    plan(
      [
        clip('asset.source-a-original', 0, 36),
        clip('asset.source-b-original', 36, 78),
        clip('asset.source-a-original', 78, 120),
      ],
      120,
    ),
  );

  assert.deepEqual(result.cutBoundaries, {
    method: 'one-to-one-nearest-neighbor',
    toleranceSeconds: 0.75,
    generatedCount: 2,
    targetCount: 2,
    matchedCount: 2,
    precision: 1,
    recall: 1,
    f1: 1,
    meanNearestNeighborErrorSeconds: 0.4,
    maxNearestNeighborErrorSeconds: 0.6,
  });
  assert.equal(result.phraseSourceAgreement.agreementRatio, 0.666667);
  assert.deepEqual(result.duration, {
    generatedSeconds: 3,
    targetSeconds: 4,
    differenceSeconds: -1,
    absoluteDifferenceSeconds: 1,
  });
});

function plan(clips, durationFrames = 90) {
  return {
    frameRate: 30,
    durationFrames,
    tracks: [{ kind: 'video', role: 'primary', clips }],
  };
}

function clip(assetId, startFrame, endFrameExclusive) {
  return {
    kind: 'source',
    assetId,
    timelineRange: { startFrame, endFrameExclusive },
  };
}
