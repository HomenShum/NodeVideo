import {
  SMART_REFRAME_SCHEMA,
  type SubjectObservation,
  type SubjectTrack,
} from '@/lib/smart-reframe';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

type Landmark = { x: number; y: number; visibility?: number };

function center(observation: SubjectObservation) {
  return {
    x: observation.box.x + observation.box.width / 2,
    y: observation.box.y + observation.box.height / 2,
  };
}

function observationFromPose(
  landmarks: Landmark[],
  timelineFrame: number,
): SubjectObservation | null {
  const visible = landmarks.filter(
    (landmark) => (landmark.visibility ?? 1) >= 0.45 && Number.isFinite(landmark.x + landmark.y),
  );
  if (visible.length < 8) return null;
  const xs = visible.map(({ x }) => x);
  const ys = visible.map(({ y }) => y);
  const x0 = Math.max(0, Math.min(...xs));
  const y0 = Math.max(0, Math.min(...ys));
  const x1 = Math.min(1, Math.max(...xs));
  const y1 = Math.min(1, Math.max(...ys));
  const marginX = Math.max(0.025, (x1 - x0) * 0.12);
  const marginY = Math.max(0.035, (y1 - y0) * 0.08);
  const criticalRegionBox = {
    x: Math.max(0, x0 - marginX),
    y: Math.max(0, y0 - marginY),
    width: Math.min(1, x1 + marginX) - Math.max(0, x0 - marginX),
    height: Math.min(1, y1 + marginY) - Math.max(0, y0 - marginY),
  };
  return {
    timelineFrame,
    box: { x: x0, y: y0, width: Math.max(0.01, x1 - x0), height: Math.max(0.01, y1 - y0) },
    criticalRegionBox,
    confidence: visible.reduce((sum, item) => sum + (item.visibility ?? 1), 0) / visible.length,
  };
}

async function seek(video: HTMLVideoElement, seconds: number) {
  if (Math.abs(video.currentTime - seconds) < 0.005) return;
  await new Promise<void>((resolve, reject) => {
    const done = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error('Could not seek the local source for subject analysis.'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', failed);
    };
    video.addEventListener('seeked', done, { once: true });
    video.addEventListener('error', failed, { once: true });
    video.currentTime = seconds;
  });
}

export async function trackLocalPoseSubjects(input: {
  url: string;
  assetId: string;
  durationMs: number;
  frameRate: number;
  maxSamples?: number;
  onProgress?: (ratio: number) => void;
}): Promise<SubjectTrack[]> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = input.url;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('The source could not be decoded for local tracking.'));
  });
  const vision = await FilesetResolver.forVisionTasks('/mediapipe-wasm');
  const landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task' },
    runningMode: 'VIDEO',
    numPoses: 4,
    minPoseDetectionConfidence: 0.45,
    minTrackingConfidence: 0.45,
  });
  const durationSeconds = input.durationMs / 1_000;
  const sampleCount = Math.max(2, Math.min(input.maxSamples ?? 72, Math.ceil(durationSeconds * 2)));
  const tracks: Array<{ observations: SubjectObservation[]; distances: number[] }> = [];
  try {
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const seconds = Math.min(
        Math.max(0, durationSeconds - 0.001),
        (sample / Math.max(1, sampleCount - 1)) * durationSeconds,
      );
      await seek(video, seconds);
      const result = landmarker.detectForVideo(video, seconds * 1_000);
      const observations = (result.landmarks as Landmark[][])
        .map((landmarks) => observationFromPose(landmarks, Math.round(seconds * input.frameRate)))
        .filter((item): item is SubjectObservation => Boolean(item));
      const unused = new Set(tracks.map((_, index) => index));
      for (const observation of observations) {
        const nextCenter = center(observation);
        let selected = -1;
        let selectedDistance = Number.POSITIVE_INFINITY;
        for (const index of unused) {
          const previous = tracks[index].observations.at(-1);
          if (!previous) continue;
          const previousCenter = center(previous);
          const distance = Math.hypot(
            nextCenter.x - previousCenter.x,
            nextCenter.y - previousCenter.y,
          );
          if (distance < selectedDistance) {
            selected = index;
            selectedDistance = distance;
          }
        }
        if (selected >= 0 && selectedDistance <= 0.28) {
          tracks[selected].observations.push(observation);
          tracks[selected].distances.push(selectedDistance);
          unused.delete(selected);
        } else {
          tracks.push({ observations: [observation], distances: [] });
        }
      }
      input.onProgress?.((sample + 1) / sampleCount);
    }
  } finally {
    landmarker.close();
    video.removeAttribute('src');
    video.load();
  }
  return tracks
    .filter((track) => track.observations.length >= Math.max(2, Math.floor(sampleCount * 0.2)))
    .sort((left, right) => right.observations.length - left.observations.length)
    .map((track, index) => {
      const averageDistance = track.distances.length
        ? track.distances.reduce((sum, value) => sum + value, 0) / track.distances.length
        : 0;
      const coverage = track.observations.length / sampleCount;
      return {
        schemaVersion: SMART_REFRAME_SCHEMA,
        id: `subject:person:${index}`,
        assetId: input.assetId,
        subjectType: 'person' as const,
        frameRange: {
          startFrame: track.observations[0].timelineFrame,
          endFrameExclusive: (track.observations.at(-1)?.timelineFrame ?? 0) + 1,
        },
        observations: track.observations,
        identityContinuity: Math.max(0, Math.min(1, coverage * (1 - averageDistance))),
        warnings:
          coverage < 0.7 ? ['Subject is occluded or outside the frame in sampled ranges.'] : [],
      };
    });
}
