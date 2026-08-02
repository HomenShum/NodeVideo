// Pure, browser-safe edit-plan operations shared by the studio's direct
// manipulation, the local rule agent, and the in-browser model agent. Every
// op returns a fresh plan (never mutates the input) plus the patch descriptor
// the studio applies — so a model tool call and a hand drag are the same edit.

export const ONE_EDIT_PER_PROPOSAL_ERROR =
  'one_edit_per_proposal: apply or dismiss the pending edit before asking for another mutation';

export type FrameRange = { startFrame: number; endFrameExclusive: number };
export type Plan = {
  id?: string;
  version?: number;
  frameRate: number;
  durationFrames: number;
  canvas: { width: number; height: number };
  beatGrid: {
    bpm: number;
    offsetMs?: number;
    confidence?: number;
    beatsMs: number[];
    downbeatsMs: number[];
  };
  audio?: {
    routing: Array<Record<string, unknown>>;
    events: Array<Record<string, unknown>>;
  };
  tracks: Array<{
    id: string;
    kind: string;
    clips: Array<{
      id: string;
      kind: string;
      assetId?: string;
      text?: string;
      templateId?: string;
      animation?: 'fade' | 'pop' | 'slide-up' | string;
      timelineRange: FrameRange;
      sourceRange?: FrameRange;
      sourceFrame?: number;
      playbackRate?: number;
      fit?: 'fit' | 'fill' | 'crop';
      cropKeyframes?: Array<{
        timelineFrame?: number;
        box: { x: number; y: number; width: number; height: number };
      }>;
      grade?: { kind: string; artifactId?: string };
      box?: { x: number; y: number; width: number; height: number };
      role?: string;
      gainDb?: number;
      fadeInFrames?: number;
      fadeOutFrames?: number;
      license?: Record<string, unknown>;
    }>;
  }>;
};
export type SourceClip = Plan['tracks'][number]['clips'][number] & {
  assetId: string;
  sourceRange: FrameRange;
};
export type ToolResult = { plan?: Plan; patch?: PlanPatch; error?: string };
export const MAX_SOURCE_CLIPS = 64;
export type PlanPatch = {
  kind:
    | 'swap-source'
    | 'nudge-boundary'
    | 'reorder-clips'
    | 'set-overlay-text'
    | 'move-overlay'
    | 'split-clip'
    | 'delete-clip'
    | 'duplicate-clip';
  clipIndex?: number;
  beats?: number;
  atFrame?: number;
  fromIndex?: number;
  toIndex?: number;
  overlayId?: string;
  text?: string;
};

type PlanClip = Plan['tracks'][number]['clips'][number];

function nextUniqueId(base: string, used: Set<string>) {
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  used.add(candidate);
  return candidate;
}

function sliceClip(
  clip: PlanClip,
  sliceStart: number,
  sliceEnd: number,
  newStart: number,
  id: string,
): PlanClip {
  const next = structuredClone(clip);
  const originalStart = clip.timelineRange.startFrame;
  const duration = sliceEnd - sliceStart;
  next.id = id;
  next.timelineRange = { startFrame: newStart, endFrameExclusive: newStart + duration };
  if (clip.sourceRange) {
    const rate = clip.playbackRate ?? 1;
    const sourceStart =
      clip.sourceRange.startFrame + Math.round((sliceStart - originalStart) * rate);
    next.sourceRange = {
      startFrame: sourceStart,
      endFrameExclusive: sourceStart + Math.round(duration * rate),
    };
  }
  if (next.cropKeyframes) {
    next.cropKeyframes = next.cropKeyframes
      .filter(
        (keyframe) =>
          keyframe.timelineFrame === undefined ||
          (sliceStart <= keyframe.timelineFrame && keyframe.timelineFrame < sliceEnd),
      )
      .map((keyframe) => ({
        ...keyframe,
        timelineFrame:
          keyframe.timelineFrame === undefined
            ? undefined
            : keyframe.timelineFrame - sliceStart + newStart,
      }));
  }
  if (typeof next.fadeInFrames === 'number')
    next.fadeInFrames = Math.min(next.fadeInFrames, duration);
  if (typeof next.fadeOutFrames === 'number')
    next.fadeOutFrames = Math.min(next.fadeOutFrames, duration);
  return next;
}

function transformMarkers(
  markers: number[],
  startMs: number,
  endMs: number,
  mode: 'delete' | 'duplicate',
) {
  const delta = endMs - startMs;
  if (mode === 'delete')
    return markers
      .filter((marker) => marker < startMs || marker >= endMs)
      .map((marker) => (marker >= endMs ? marker - delta : marker));
  const duplicated = markers
    .filter((marker) => startMs <= marker && marker < endMs)
    .map((marker) => marker + delta);
  return [
    ...markers.map((marker) => (marker >= endMs ? marker + delta : marker)),
    ...duplicated,
  ].sort((left, right) => left - right);
}

function rebuildAudioEvents(
  plan: Plan,
  templates: Map<string, Record<string, unknown>>,
  origins: Map<string, string>,
) {
  if (!plan.audio) return;
  const audible = plan.tracks
    .filter((track) => track.kind === 'audio')
    .flatMap((track) => track.clips)
    .filter((clip) => clip.role === 'music' || clip.role === 'sfx' || clip.role === 'sting')
    .map((clip, index) => {
      const originId = origins.get(clip.id) ?? clip.id;
      const template = templates.get(originId) ?? {};
      const sourceOffsetMs = ((clip.sourceRange?.startFrame ?? 0) / plan.frameRate) * 1000;
      const event: Record<string, unknown> = {
        ...template,
        id: `event.${clip.id}.${index}`,
        kind: clip.role,
        clipId: clip.id,
        sourceOffsetMs,
        targetStartMs: (clip.timelineRange.startFrame / plan.frameRate) * 1000,
        targetEndMs: (clip.timelineRange.endFrameExclusive / plan.frameRate) * 1000,
        gainDb: clip.gainDb ?? 0,
      };
      if (clip.role === 'music') {
        event.releasedMasterOffsetMs = sourceOffsetMs;
        event.releasedMasterGainDb = Number(template.releasedMasterGainDb ?? 0);
      }
      return event;
    });
  const silence: Array<Record<string, unknown>> = [];
  const windows = audible
    .map((event) => [Number(event.targetStartMs), Number(event.targetEndMs)] as const)
    .sort((left, right) => left[0] - right[0]);
  let cursor = 0;
  const durationMs = (plan.durationFrames / plan.frameRate) * 1000;
  for (const [start, end] of windows) {
    if (start > cursor)
      silence.push({
        id: `event.silence.${silence.length}`,
        kind: 'silence',
        targetStartMs: cursor,
        targetEndMs: start,
      });
    cursor = Math.max(cursor, end);
  }
  if (cursor < durationMs)
    silence.push({
      id: `event.silence.${silence.length}`,
      kind: 'silence',
      targetStartMs: cursor,
      targetEndMs: durationMs,
    });
  plan.audio.events = [...audible, ...silence];
}

function rippleClip(plan: Plan, clipIndex: number, mode: 'delete' | 'duplicate'): ToolResult {
  const sourceClips = videoClips(plan);
  const selected = sourceClips[clipIndex];
  if (!selected) return { error: `clip ${clipIndex} does not exist` };
  if (mode === 'delete' && sourceClips.length <= 1)
    return { error: 'the last source clip cannot be deleted' };
  if (mode === 'duplicate' && sourceClips.length >= MAX_SOURCE_CLIPS)
    return { error: `a plan cannot exceed ${MAX_SOURCE_CLIPS} source clips` };
  const next = structuredClone(plan);
  const selectedNext = videoClips(next)[clipIndex];
  const start = selectedNext.timelineRange.startFrame;
  const end = selectedNext.timelineRange.endFrameExclusive;
  const delta = end - start;
  const used = new Set(next.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
  const origins = new Map<string, string>();
  const templates = new Map<string, Record<string, unknown>>();
  for (const event of next.audio?.events ?? [])
    if (typeof event.clipId === 'string') templates.set(event.clipId, event);

  for (const track of next.tracks) {
    if (track.kind === 'video') {
      const selectedTrackIndex = track.clips.findIndex((clip) => clip.id === selectedNext.id);
      if (selectedTrackIndex >= 0) {
        if (mode === 'delete') track.clips.splice(selectedTrackIndex, 1);
        else {
          for (let index = selectedTrackIndex + 1; index < track.clips.length; index += 1) {
            track.clips[index].timelineRange.startFrame += delta;
            track.clips[index].timelineRange.endFrameExclusive += delta;
          }
          const duplicate = structuredClone(selectedNext);
          duplicate.id = nextUniqueId(`${selectedNext.id}.duplicate`, used);
          duplicate.timelineRange = { startFrame: end, endFrameExclusive: end + delta };
          track.clips.splice(selectedTrackIndex + 1, 0, duplicate);
        }
        if (mode === 'delete')
          for (let index = selectedTrackIndex; index < track.clips.length; index += 1) {
            track.clips[index].timelineRange.startFrame -= delta;
            track.clips[index].timelineRange.endFrameExclusive -= delta;
          }
        continue;
      }
    }

    const transformed: PlanClip[] = [];
    for (const clip of track.clips) {
      const clipStart = clip.timelineRange.startFrame;
      const clipEnd = clip.timelineRange.endFrameExclusive;
      const append = (sliceStart: number, sliceEnd: number, newStart: number, suffix: string) => {
        if (sliceEnd <= sliceStart) return;
        const id = transformed.some((item) => item.id === clip.id)
          ? nextUniqueId(`${clip.id}.${suffix}`, used)
          : clip.id;
        const fragment = sliceClip(clip, sliceStart, sliceEnd, newStart, id);
        origins.set(fragment.id, clip.id);
        transformed.push(fragment);
      };
      if (mode === 'delete') {
        append(clipStart, Math.min(clipEnd, start), clipStart, 'before');
        const afterStart = Math.max(clipStart, end);
        append(afterStart, clipEnd, afterStart - delta, 'after');
      } else {
        append(clipStart, Math.min(clipEnd, end), clipStart, 'before');
        const intersectionStart = Math.max(clipStart, start);
        const intersectionEnd = Math.min(clipEnd, end);
        append(intersectionStart, intersectionEnd, end + (intersectionStart - start), 'duplicate');
        const afterStart = Math.max(clipStart, end);
        append(afterStart, clipEnd, afterStart + delta, 'after');
      }
    }
    track.clips = transformed.sort(
      (left, right) => left.timelineRange.startFrame - right.timelineRange.startFrame,
    );
  }

  next.durationFrames += mode === 'delete' ? -delta : delta;
  const startMs = (start / next.frameRate) * 1000;
  const endMs = (end / next.frameRate) * 1000;
  next.beatGrid.beatsMs = transformMarkers(next.beatGrid.beatsMs, startMs, endMs, mode);
  next.beatGrid.downbeatsMs = transformMarkers(next.beatGrid.downbeatsMs, startMs, endMs, mode);
  next.beatGrid.offsetMs = next.beatGrid.beatsMs[0] ?? 0;
  if (next.audio) {
    const sourceAssets = new Set(videoClips(next).map((clip) => clip.assetId));
    next.audio.routing = next.audio.routing.filter(
      (route) => route.sourceKind !== 'asset-audio' || sourceAssets.has(String(route.sourceId)),
    );
  }
  rebuildAudioEvents(next, templates, origins);
  return {
    plan: next,
    patch: { kind: mode === 'delete' ? 'delete-clip' : 'duplicate-clip', clipIndex },
  };
}

export function deleteClipRipple(plan: Plan, clipIndex: number) {
  return rippleClip(plan, clipIndex, 'delete');
}

export function duplicateClipRipple(plan: Plan, clipIndex: number) {
  return rippleClip(plan, clipIndex, 'duplicate');
}

export function splitClip(plan: Plan, clipIndex: number, atFrame: number): ToolResult {
  const next: Plan = structuredClone(plan);
  const track = next.tracks.find((item) => item.kind === 'video');
  const clip = videoClips(next)[clipIndex];
  if (!track || !clip) return { error: `clip ${clipIndex} does not exist` };
  const framesPerBeat = Math.max(1, Math.round((60 / next.beatGrid.bpm) * next.frameRate));
  if (
    !Number.isFinite(atFrame) ||
    atFrame < clip.timelineRange.startFrame + framesPerBeat ||
    atFrame > clip.timelineRange.endFrameExclusive - framesPerBeat
  )
    return { error: 'split must leave at least one beat on each side' };

  const sourceDelta = Math.round(
    (atFrame - clip.timelineRange.startFrame) * (clip.playbackRate ?? 1),
  );
  const sourceFrame = clip.sourceRange.startFrame + sourceDelta;
  const right = structuredClone(clip);
  let suffix = 1;
  let rightId = `${clip.id}.split-${atFrame}`;
  while (track.clips.some((item) => item.id === rightId)) {
    suffix += 1;
    rightId = `${clip.id}.split-${atFrame}-${suffix}`;
  }
  right.id = rightId;
  right.timelineRange.startFrame = atFrame;
  right.sourceRange.startFrame = sourceFrame;
  clip.timelineRange.endFrameExclusive = atFrame;
  clip.sourceRange.endFrameExclusive = sourceFrame;

  const trackIndex = track.clips.findIndex((item) => item.id === clip.id);
  track.clips.splice(trackIndex + 1, 0, right);
  return { plan: next, patch: { kind: 'split-clip', clipIndex, atFrame } };
}

export function splitClipOnNearestBeat(plan: Plan, clipIndex: number): ToolResult {
  const clip = videoClips(plan)[clipIndex];
  if (!clip) return { error: `clip ${clipIndex} does not exist` };
  const framesPerBeat = Math.max(1, Math.round((60 / plan.beatGrid.bpm) * plan.frameRate));
  const minimum = clip.timelineRange.startFrame + framesPerBeat;
  const maximum = clip.timelineRange.endFrameExclusive - framesPerBeat;
  if (minimum > maximum) return { error: 'split must leave at least one beat on each side' };
  const midpoint = (clip.timelineRange.startFrame + clip.timelineRange.endFrameExclusive) / 2;
  const atFrame =
    plan.beatGrid.beatsMs
      .map((milliseconds) => Math.round((milliseconds / 1000) * plan.frameRate))
      .filter((frame) => minimum <= frame && frame <= maximum)
      .sort((left, right) => Math.abs(left - midpoint) - Math.abs(right - midpoint))[0] ??
    Math.round(midpoint);
  return splitClip(plan, clipIndex, atFrame);
}

export function videoClips(plan: Plan): SourceClip[] {
  return (plan.tracks.find((t) => t.kind === 'video')?.clips ?? []).filter(
    (c) => c.kind === 'source' && c.assetId && c.sourceRange,
  ) as SourceClip[];
}

export function overlayClips(plan: Plan) {
  return (plan.tracks.find((t) => t.kind === 'overlay')?.clips ?? []).filter(
    (c) => c.kind === 'text' && c.text,
  );
}

export function planSummary(plan: Plan) {
  const seconds = (frame: number) => Math.round((frame / plan.frameRate) * 10) / 10;
  return {
    bpm: Math.round(plan.beatGrid.bpm * 10) / 10,
    durationSeconds: seconds(plan.durationFrames),
    clips: videoClips(plan).map((c, i) => ({
      index: i,
      lane: c.assetId === 'asset.take-a' ? 'A' : 'B',
      startSeconds: seconds(c.timelineRange.startFrame),
      endSeconds: seconds(c.timelineRange.endFrameExclusive),
    })),
    overlays: overlayClips(plan).map((c) => ({
      id: c.id,
      text: c.text,
      startSeconds: seconds(c.timelineRange.startFrame),
      endSeconds: seconds(c.timelineRange.endFrameExclusive),
      templateId: c.templateId,
    })),
  };
}

function assetOffsets(plan: Plan): Record<string, number> {
  const offsets: Record<string, number> = {};
  for (const clip of videoClips(plan)) {
    offsets[clip.assetId] ??= clip.sourceRange.startFrame - clip.timelineRange.startFrame;
  }
  return offsets;
}

export function swapClipSource(plan: Plan, clipIndex: number): ToolResult {
  const next: Plan = structuredClone(plan);
  const clips = videoClips(next);
  const clip = clips[clipIndex];
  if (!clip) return { error: `clip ${clipIndex} does not exist` };
  const other = clip.assetId === 'asset.take-a' ? 'asset.take-b' : 'asset.take-a';
  const offset = assetOffsets(next)[other];
  if (offset === undefined) return { error: `no alignment known for ${other}` };
  clip.assetId = other;
  clip.sourceRange = {
    startFrame: clip.timelineRange.startFrame + offset,
    endFrameExclusive: clip.timelineRange.endFrameExclusive + offset,
  };
  return { plan: next, patch: { kind: 'swap-source', clipIndex } };
}

export function nudgeBoundary(plan: Plan, clipIndex: number, beats: number): ToolResult {
  const next: Plan = structuredClone(plan);
  const clips = videoClips(next);
  const clip = clips[clipIndex];
  const neighbor = clips[clipIndex + 1];
  if (!clip || !neighbor) return { error: `no movable boundary after clip ${clipIndex}` };
  const framesPerBeat = (60 / next.beatGrid.bpm) * next.frameRate;
  const delta = Math.round(beats * framesPerBeat);
  const boundary = clip.timelineRange.endFrameExclusive + delta;
  if (
    boundary <= clip.timelineRange.startFrame + framesPerBeat ||
    boundary >= neighbor.timelineRange.endFrameExclusive - framesPerBeat
  )
    return { error: 'nudge would collapse a clip below one beat' };
  clip.timelineRange.endFrameExclusive = boundary;
  clip.sourceRange.endFrameExclusive += delta;
  neighbor.timelineRange.startFrame = boundary;
  neighbor.sourceRange.startFrame += delta;
  return { plan: next, patch: { kind: 'nudge-boundary', clipIndex, beats } };
}

export function reorderClips(plan: Plan, fromIndex: number, toIndex: number): ToolResult {
  const next: Plan = structuredClone(plan);
  const track = next.tracks.find((t) => t.kind === 'video');
  const count = track?.clips.length ?? 0;
  if (!track || fromIndex < 0 || toIndex < 0 || fromIndex >= count || toIndex >= count)
    return { error: 'clip index out of range' };
  const [moved] = track.clips.splice(fromIndex, 1);
  track.clips.splice(toIndex, 0, moved);
  let cursor = 0;
  for (const clip of track.clips) {
    const duration = clip.timelineRange.endFrameExclusive - clip.timelineRange.startFrame;
    clip.timelineRange = { startFrame: cursor, endFrameExclusive: cursor + duration };
    cursor += duration;
  }
  return { plan: next, patch: { kind: 'reorder-clips', fromIndex, toIndex } };
}

export function setOverlayText(plan: Plan, overlayId: string, text: string): ToolResult {
  const next: Plan = structuredClone(plan);
  const clip = overlayClips(next).find((c) => c.id === overlayId);
  if (!clip) return { error: `overlay ${overlayId} does not exist` };
  if (!text?.trim()) return { error: 'text must not be empty' };
  clip.text = String(text).slice(0, 80);
  return { plan: next, patch: { kind: 'set-overlay-text', overlayId, text: clip.text } };
}

export function moveOverlay(plan: Plan, overlayId: string, beats: number): ToolResult {
  if (!Number.isInteger(beats) || beats === 0)
    return { error: 'overlay timing moves must use a non-zero whole beat' };
  const next: Plan = structuredClone(plan);
  const clip = overlayClips(next).find((item) => item.id === overlayId);
  if (!clip) return { error: `overlay ${overlayId} does not exist` };
  const framesPerBeat = Math.round((60 / next.beatGrid.bpm) * next.frameRate);
  const delta = beats * framesPerBeat;
  const startFrame = clip.timelineRange.startFrame + delta;
  const endFrameExclusive = clip.timelineRange.endFrameExclusive + delta;
  if (startFrame < 0 || endFrameExclusive > next.durationFrames)
    return { error: 'overlay move would leave the accepted timeline' };
  clip.timelineRange = { startFrame, endFrameExclusive };
  return { plan: next, patch: { kind: 'move-overlay', overlayId, beats } };
}
