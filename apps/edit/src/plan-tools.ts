// Pure, browser-safe edit-plan operations shared by the studio's direct
// manipulation, the local rule agent, and the in-browser model agent. Every
// op returns a fresh plan (never mutates the input) plus the patch descriptor
// the studio applies — so a model tool call and a hand drag are the same edit.

export type FrameRange = { startFrame: number; endFrameExclusive: number };
export type Plan = {
  id?: string;
  version?: number;
  frameRate: number;
  durationFrames: number;
  canvas: { width: number; height: number };
  beatGrid: { bpm: number; beatsMs: number[]; downbeatsMs: number[] };
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
    }>;
  }>;
};
export type SourceClip = Plan['tracks'][number]['clips'][number] & {
  assetId: string;
  sourceRange: FrameRange;
};
export type ToolResult = { plan?: Plan; patch?: PlanPatch; error?: string };
export type PlanPatch = {
  kind: 'swap-source' | 'nudge-boundary' | 'reorder-clips' | 'set-overlay-text';
  clipIndex?: number;
  beats?: number;
  fromIndex?: number;
  toIndex?: number;
  overlayId?: string;
  text?: string;
};

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
