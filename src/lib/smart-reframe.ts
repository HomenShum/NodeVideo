import type { CropKeyframe, EditPlan, FrameRange, NormalizedBox } from './edit-contracts.ts';

export const SMART_REFRAME_SCHEMA = 'nodevideo.smart-reframe.v1' as const;

export type SubjectObservation = {
  timelineFrame: number;
  box: NormalizedBox;
  criticalRegionBox: NormalizedBox;
  confidence: number;
};

export type SubjectTrack = {
  schemaVersion: typeof SMART_REFRAME_SCHEMA;
  id: string;
  assetId: string;
  subjectType: 'person' | 'group' | 'object' | 'animal';
  frameRange: FrameRange;
  observations: SubjectObservation[];
  identityContinuity: number;
  warnings: string[];
};

export type FramingPolicy =
  | 'full-body-safe'
  | 'performance-dynamic'
  | 'group-formation'
  | 'speaker'
  | 'object-demo'
  | 'custom';

export type FramingIntent = {
  subjectTrackIds: string[];
  aspectRatio: '16:9' | '9:16' | '1:1' | string;
  policy: FramingPolicy;
  anchor: 'center' | 'rule-of-thirds-left' | 'rule-of-thirds-right';
  movementMargin: number;
  allowBodyClipping: boolean;
  motionPreset: 'stable' | 'smooth' | 'responsive' | 'cinematic' | 'full-body-safe';
};

export type ConfidenceRange = FrameRange & { confidence: number };

export type ReframePlan = {
  schemaVersion: typeof SMART_REFRAME_SCHEMA;
  id: string;
  assetId: string;
  intent: FramingIntent;
  cropKeyframes: CropKeyframe[];
  confidenceByRange: ConfidenceRange[];
  trackingLossRanges: FrameRange[];
  manualOverrides: CropKeyframe[];
  sourceTrackId: string;
};

export type ReframeFinding = {
  severity: 'warning' | 'error';
  frameRange: FrameRange;
  message: string;
};

export type ReframeCritic = {
  subjectCoverage: number;
  criticalRegionCoverage: number;
  trackSwitchCount: number;
  cropMotionFindings: ReframeFinding[];
  clippedMoments: FrameRange[];
  lowConfidenceRanges: FrameRange[];
  verdict: 'pass' | 'review' | 'fail';
};

const MOTION = {
  stable: { deadZone: 0.05, maxSpeed: 0.005, lookAhead: 1 },
  smooth: { deadZone: 0.025, maxSpeed: 0.009, lookAhead: 2 },
  responsive: { deadZone: 0.01, maxSpeed: 0.018, lookAhead: 3 },
  cinematic: { deadZone: 0.035, maxSpeed: 0.007, lookAhead: 3 },
  'full-body-safe': { deadZone: 0.02, maxSpeed: 0.01, lookAhead: 2 },
} as const;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

function aspectValue(value: string) {
  const [width, height] = value.split(':').map(Number);
  return width > 0 && height > 0 ? width / height : 16 / 9;
}

function cropSize(
  source: { width: number; height: number },
  aspectRatio: string,
  subject: NormalizedBox,
  margin: number,
) {
  const sourceAspect = source.width / source.height;
  const targetAspect = aspectValue(aspectRatio);
  let height = clamp(subject.height * (1 + margin * 2), 0.28, 1);
  let width = height * (targetAspect / sourceAspect);
  const minimumWidth = clamp(subject.width * (1 + margin * 2), 0.2, 1);
  if (width < minimumWidth) {
    width = minimumWidth;
    height = width * (sourceAspect / targetAspect);
  }
  if (height > 1) {
    height = 1;
    width = targetAspect / sourceAspect;
  }
  if (width > 1) {
    width = 1;
    height = sourceAspect / targetAspect;
  }
  return { width: clamp(width, 0.08, 1), height: clamp(height, 0.08, 1) };
}

function cropContains(crop: NormalizedBox, subject: NormalizedBox) {
  return (
    subject.x >= crop.x &&
    subject.y >= crop.y &&
    subject.x + subject.width <= crop.x + crop.width &&
    subject.y + subject.height <= crop.y + crop.height
  );
}

function cropAtFrame(keyframes: CropKeyframe[], frame: number): NormalizedBox | undefined {
  const before =
    [...keyframes].reverse().find((item) => item.timelineFrame <= frame) ?? keyframes[0];
  const after = keyframes.find((item) => item.timelineFrame >= frame) ?? keyframes.at(-1);
  if (!before || !after) return undefined;
  if (after.timelineFrame <= before.timelineFrame) return before.box;
  const ratio = (frame - before.timelineFrame) / (after.timelineFrame - before.timelineFrame);
  return {
    x: before.box.x + (after.box.x - before.box.x) * ratio,
    y: before.box.y + (after.box.y - before.box.y) * ratio,
    width: before.box.width + (after.box.width - before.box.width) * ratio,
    height: before.box.height + (after.box.height - before.box.height) * ratio,
  };
}

export function planSmartReframe(input: {
  track: SubjectTrack;
  intent: FramingIntent;
  source: { width: number; height: number };
}): ReframePlan {
  if (!input.track.observations.length) throw new Error('A subject track needs observations.');
  const observations = [...input.track.observations].sort(
    (left, right) => left.timelineFrame - right.timelineFrame,
  );
  const motion = MOTION[input.intent.motionPreset];
  const requiredRegion = observations.reduce(
    (largest, observation) => ({
      x: 0,
      y: 0,
      width: Math.max(largest.width, observation.criticalRegionBox.width),
      height: Math.max(largest.height, observation.criticalRegionBox.height),
    }),
    { x: 0, y: 0, width: 0, height: 0 },
  );
  // A fixed crop size keeps browser preview and FFmpeg export geometry identical.
  // The camera moves; it does not zoom unpredictably between sampled poses.
  const size = cropSize(
    input.source,
    input.intent.aspectRatio,
    requiredRegion,
    input.intent.movementMargin,
  );
  const cropKeyframes: CropKeyframe[] = [];
  const confidenceByRange: ConfidenceRange[] = [];
  const trackingLossRanges: FrameRange[] = [];
  let previous: NormalizedBox | undefined;

  observations.forEach((observation, index) => {
    const nextFrame = observations[index + 1]?.timelineFrame ?? observation.timelineFrame + 1;
    confidenceByRange.push({
      startFrame: observation.timelineFrame,
      endFrameExclusive: Math.max(observation.timelineFrame + 1, nextFrame),
      confidence: observation.confidence,
    });
    if (observation.confidence < 0.45) {
      trackingLossRanges.push({
        startFrame: observation.timelineFrame,
        endFrameExclusive: Math.max(observation.timelineFrame + 1, nextFrame),
      });
      if (previous) {
        cropKeyframes.push({ timelineFrame: observation.timelineFrame, box: { ...previous } });
        return;
      }
    }
    const lookAhead = observations[Math.min(observations.length - 1, index + motion.lookAhead)];
    const currentCenter = {
      x: observation.box.x + observation.box.width / 2,
      y: observation.box.y + observation.box.height / 2,
    };
    const futureCenter = {
      x: lookAhead.box.x + lookAhead.box.width / 2,
      y: lookAhead.box.y + lookAhead.box.height / 2,
    };
    const anchorOffset =
      input.intent.anchor === 'rule-of-thirds-left'
        ? size.width / 6
        : input.intent.anchor === 'rule-of-thirds-right'
          ? -size.width / 6
          : 0;
    let centerX = currentCenter.x * 0.72 + futureCenter.x * 0.28 + anchorOffset;
    let centerY = currentCenter.y * 0.8 + futureCenter.y * 0.2;
    if (previous) {
      const previousCenterX = previous.x + previous.width / 2;
      const previousCenterY = previous.y + previous.height / 2;
      const deltaX = centerX - previousCenterX;
      const deltaY = centerY - previousCenterY;
      centerX =
        Math.abs(deltaX) <= motion.deadZone
          ? previousCenterX
          : previousCenterX + clamp(deltaX, -motion.maxSpeed, motion.maxSpeed);
      centerY =
        Math.abs(deltaY) <= motion.deadZone
          ? previousCenterY
          : previousCenterY + clamp(deltaY, -motion.maxSpeed, motion.maxSpeed);
    }
    const box = {
      x: clamp(centerX - size.width / 2, 0, 1 - size.width),
      y: clamp(centerY - size.height / 2, 0, 1 - size.height),
      width: size.width,
      height: size.height,
    };
    cropKeyframes.push({ timelineFrame: observation.timelineFrame, box });
    previous = box;
  });

  return {
    schemaVersion: SMART_REFRAME_SCHEMA,
    id: `reframe:${input.track.id}:${input.intent.aspectRatio}:${input.intent.motionPreset}`,
    assetId: input.track.assetId,
    intent: input.intent,
    cropKeyframes,
    confidenceByRange,
    trackingLossRanges,
    manualOverrides: [],
    sourceTrackId: input.track.id,
  };
}

export function addManualCropOverride(plan: ReframePlan, override: CropKeyframe): ReframePlan {
  const manualOverrides = [
    ...plan.manualOverrides.filter((item) => item.timelineFrame !== override.timelineFrame),
    override,
  ].sort((left, right) => left.timelineFrame - right.timelineFrame);
  const cropKeyframes = [
    ...plan.cropKeyframes.filter((item) => item.timelineFrame !== override.timelineFrame),
    override,
  ].sort((left, right) => left.timelineFrame - right.timelineFrame);
  return { ...plan, manualOverrides, cropKeyframes };
}

export function validateSmartReframe(track: SubjectTrack, plan: ReframePlan): ReframeCritic {
  const clippedMoments: FrameRange[] = [];
  const cropMotionFindings: ReframeFinding[] = [];
  let subjectHits = 0;
  let criticalHits = 0;
  const observations = track.observations;
  observations.forEach((observation, index) => {
    const crop = cropAtFrame(plan.cropKeyframes, observation.timelineFrame);
    if (!crop) return;
    if (cropContains(crop, observation.box)) subjectHits += 1;
    if (cropContains(crop, observation.criticalRegionBox)) criticalHits += 1;
    else {
      clippedMoments.push({
        startFrame: observation.timelineFrame,
        endFrameExclusive: observation.timelineFrame + 1,
      });
    }
    const previousObservation = observations[index - 1];
    const previous = previousObservation
      ? cropAtFrame(plan.cropKeyframes, previousObservation.timelineFrame)
      : undefined;
    if (!previous || !previousObservation) return;
    const movement = Math.hypot(crop.x - previous.x, crop.y - previous.y);
    if (movement > 0.04) {
      cropMotionFindings.push({
        severity: 'warning',
        frameRange: {
          startFrame: previousObservation.timelineFrame,
          endFrameExclusive: observation.timelineFrame + 1,
        },
        message: 'Crop movement exceeds the comfortable per-sample threshold.',
      });
    }
  });
  const divisor = Math.max(1, observations.length);
  const subjectCoverage = subjectHits / divisor;
  const criticalRegionCoverage = criticalHits / divisor;
  const verdict =
    criticalRegionCoverage < 0.8
      ? 'fail'
      : plan.trackingLossRanges.length || cropMotionFindings.length
        ? 'review'
        : 'pass';
  return {
    subjectCoverage,
    criticalRegionCoverage,
    trackSwitchCount: 0,
    cropMotionFindings,
    clippedMoments,
    lowConfidenceRanges: plan.trackingLossRanges,
    verdict,
  };
}

export function compileReframeIntoEditPlan(editPlan: EditPlan, reframe: ReframePlan): EditPlan {
  const next = structuredClone(editPlan);
  for (const track of next.tracks) {
    if (track.kind !== 'video') continue;
    for (const clip of track.clips) {
      if (clip.kind === 'black') continue;
      const keyframes = reframe.cropKeyframes
        .filter(
          (item) =>
            item.timelineFrame >= clip.timelineRange.startFrame &&
            item.timelineFrame < clip.timelineRange.endFrameExclusive,
        )
        .map((item) => ({ ...item, box: { ...item.box } }));
      const fallback = reframe.cropKeyframes[0];
      clip.fit = 'crop';
      clip.cropKeyframes = keyframes.length
        ? keyframes
        : fallback
          ? [{ timelineFrame: clip.timelineRange.startFrame, box: { ...fallback.box } }]
          : [];
    }
  }
  return next;
}
