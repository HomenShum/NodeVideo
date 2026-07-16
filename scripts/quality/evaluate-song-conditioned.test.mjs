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
  assert.deepEqual(result.strictCutBoundaries, {
    method: 'one-to-one-signed-boundary-assignment',
    thresholdFrames: 2,
    generatedFrameRate: 30,
    targetFrameRate: 30,
    assignments: [
      {
        generatedIndex: 0,
        targetIndex: 0,
        generatedSeconds: 1,
        targetSeconds: 1.2,
        signedErrorSeconds: -0.2,
        signedErrorFrames: -6,
        passed: false,
      },
      {
        generatedIndex: 1,
        targetIndex: 1,
        generatedSeconds: 2,
        targetSeconds: 2.6,
        signedErrorSeconds: -0.6,
        signedErrorFrames: -18,
        passed: false,
      },
    ],
    unmatchedGeneratedIndices: [],
    unmatchedTargetIndices: [],
    passedAssignments: 0,
    totalAssignments: 2,
    meanSignedErrorFrames: -12,
    maxAbsoluteErrorFrames: 18,
    verdict: 'failed',
    claim:
      'Strict editorial timing requires one-to-one assignment, complete boundary coverage, and no signed error above two frames.',
  });
  assert.equal(result.phraseSourceAgreement.agreementRatio, 0.666667);
  assert.deepEqual(result.duration, {
    generatedSeconds: 3,
    targetSeconds: 4,
    differenceSeconds: -1,
    absoluteDifferenceSeconds: 1,
  });
});

test('strict cut assignment preserves timeline order instead of crossing matches', () => {
  const result = comparePlans(
    plan([clip('asset.take-a', 0, 30), clip('asset.take-b', 30, 60), clip('asset.take-a', 60, 90)]),
    plan(
      [
        clip('asset.source-a-original', 0, 57),
        clip('asset.source-b-original', 57, 63),
        clip('asset.source-a-original', 63, 90),
      ],
      90,
    ),
  );

  assert.deepEqual(
    result.strictCutBoundaries.assignments.map(({ generatedIndex, targetIndex }) => ({
      generatedIndex,
      targetIndex,
    })),
    [
      { generatedIndex: 0, targetIndex: 0 },
      { generatedIndex: 1, targetIndex: 1 },
    ],
  );
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
