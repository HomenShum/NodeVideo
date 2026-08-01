import { describe, expect, test } from 'vitest';
import {
  type FramingIntent,
  SMART_REFRAME_SCHEMA,
  type SubjectTrack,
  addManualCropOverride,
  planSmartReframe,
  validateSmartReframe,
} from './smart-reframe';

const track: SubjectTrack = {
  schemaVersion: SMART_REFRAME_SCHEMA,
  id: 'subject:person:0',
  assetId: 'asset:test',
  subjectType: 'person',
  frameRange: { startFrame: 0, endFrameExclusive: 91 },
  identityContinuity: 0.97,
  warnings: [],
  observations: [0, 30, 60, 90].map((timelineFrame, index) => ({
    timelineFrame,
    box: { x: 0.15 + index * 0.08, y: 0.12, width: 0.22, height: 0.78 },
    criticalRegionBox: { x: 0.13 + index * 0.08, y: 0.08, width: 0.26, height: 0.88 },
    confidence: 0.94,
  })),
};

const intent: FramingIntent = {
  subjectTrackIds: [track.id],
  aspectRatio: '9:16',
  policy: 'full-body-safe',
  anchor: 'center',
  movementMargin: 0.04,
  allowBodyClipping: false,
  motionPreset: 'full-body-safe',
};

describe('smart reframe', () => {
  test('plans a bounded smooth path without identity switches', () => {
    const plan = planSmartReframe({ track, intent, source: { width: 1920, height: 1080 } });
    expect(plan.cropKeyframes).toHaveLength(track.observations.length);
    expect(plan.cropKeyframes.every(({ box }) => box.x >= 0 && box.x + box.width <= 1)).toBe(true);
    expect(validateSmartReframe(track, plan).trackSwitchCount).toBe(0);
  });

  test('holds the previous crop during low-confidence tracking', () => {
    const uncertain = structuredClone(track);
    uncertain.observations[2].confidence = 0.2;
    const plan = planSmartReframe({
      track: uncertain,
      intent,
      source: { width: 1920, height: 1080 },
    });
    expect(plan.trackingLossRanges).toHaveLength(1);
    expect(plan.cropKeyframes[2].box).toEqual(plan.cropKeyframes[1].box);
  });

  test('manual keyframes override generated keyframes at the same frame', () => {
    const plan = planSmartReframe({ track, intent, source: { width: 1920, height: 1080 } });
    const override = {
      timelineFrame: 30,
      box: { x: 0.1, y: 0.1, width: 0.3, height: 0.8 },
    };
    const updated = addManualCropOverride(plan, override);
    expect(updated.manualOverrides).toEqual([override]);
    expect(updated.cropKeyframes.find((item) => item.timelineFrame === 30)).toEqual(override);
  });
});
