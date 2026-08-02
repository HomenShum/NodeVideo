// The edit agent bridge: streams a real Claude model over the same SSE event
// contract the panel's local rule agent uses (reasoning | tool | text |
// proposal | error | done). Every mutating tool call the model makes is
// executed on a WORKING COPY of the plan server-side (so the model sees its
// own edits) and simultaneously emitted as a proposal event — the browser
// applies a patch only when the user accepts its card. No key or profile
// configured -> the endpoint reports model_not_configured and the panel
// stays on its local rules; it never pretends a model ran.

import Anthropic from '@anthropic-ai/sdk';
import nodeAgentRuntime from '../../src/lib/nodeagent-runtime.json' with { type: 'json' };

const MODEL = process.env.NODEVIDEO_EDIT_AGENT_MODEL ?? 'claude-opus-4-8';
const MAX_SOURCE_CLIPS = 64;
export const ONE_EDIT_PER_PROPOSAL_ERROR =
  'one_edit_per_proposal: apply or dismiss the pending edit before asking for another mutation';

// ---------- pure plan operations (unit-tested; mirror the studio's) ----------

export function videoClips(plan) {
  return (plan.tracks.find((t) => t.kind === 'video')?.clips ?? []).filter(
    (c) => c.kind === 'source' && c.assetId && c.sourceRange,
  );
}

export function overlayClips(plan) {
  return (plan.tracks.find((t) => t.kind === 'overlay')?.clips ?? []).filter(
    (c) => c.kind === 'text' && c.text,
  );
}

export function planSummary(plan) {
  const seconds = (frame) => (frame / plan.frameRate).toFixed(1);
  return {
    bpm: Math.round(plan.beatGrid.bpm * 10) / 10,
    durationSeconds: Number(seconds(plan.durationFrames)),
    clips: videoClips(plan).map((c, i) => ({
      index: i,
      lane: c.assetId === 'asset.take-a' ? 'A' : 'B',
      startSeconds: Number(seconds(c.timelineRange.startFrame)),
      endSeconds: Number(seconds(c.timelineRange.endFrameExclusive)),
    })),
    overlays: overlayClips(plan).map((c) => ({
      id: c.id,
      text: c.text,
      startSeconds: Number(seconds(c.timelineRange.startFrame)),
      endSeconds: Number(seconds(c.timelineRange.endFrameExclusive)),
      templateId: c.templateId,
    })),
  };
}

export function swapClipSource(plan, clipIndex) {
  const next = structuredClone(plan);
  const clips = videoClips(next);
  const clip = clips[clipIndex];
  if (!clip) return { error: `clip ${clipIndex} does not exist` };
  const offsets = {};
  for (const c of clips) {
    offsets[c.assetId] ??= c.sourceRange.startFrame - c.timelineRange.startFrame;
  }
  const other = clip.assetId === 'asset.take-a' ? 'asset.take-b' : 'asset.take-a';
  if (offsets[other] === undefined) return { error: `no alignment known for ${other}` };
  clip.assetId = other;
  clip.sourceRange = {
    startFrame: clip.timelineRange.startFrame + offsets[other],
    endFrameExclusive: clip.timelineRange.endFrameExclusive + offsets[other],
  };
  return { plan: next, patch: { kind: 'swap-source', clipIndex } };
}

export function nudgeBoundary(plan, clipIndex, beats) {
  const next = structuredClone(plan);
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

export function splitClip(plan, clipIndex, atFrame) {
  const next = structuredClone(plan);
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

export function splitClipOnNearestBeat(plan, clipIndex) {
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

function nextUniqueId(base, used) {
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  used.add(candidate);
  return candidate;
}

function sliceClip(clip, sliceStart, sliceEnd, newStart, id) {
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

function transformMarkers(markers, startMs, endMs, mode) {
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

function rebuildAudioEvents(plan, templates, origins) {
  if (!plan.audio) return;
  const audible = plan.tracks
    .filter((track) => track.kind === 'audio')
    .flatMap((track) => track.clips)
    .filter((clip) => clip.role === 'music' || clip.role === 'sfx' || clip.role === 'sting')
    .map((clip, index) => {
      const template = templates.get(origins.get(clip.id) ?? clip.id) ?? {};
      const sourceOffsetMs = ((clip.sourceRange?.startFrame ?? 0) / plan.frameRate) * 1000;
      const event = {
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
  const silence = [];
  const windows = audible
    .map((event) => [Number(event.targetStartMs), Number(event.targetEndMs)])
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

function rippleClip(plan, clipIndex, mode) {
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
  const origins = new Map();
  const templates = new Map();
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

    const transformed = [];
    for (const clip of track.clips) {
      const clipStart = clip.timelineRange.startFrame;
      const clipEnd = clip.timelineRange.endFrameExclusive;
      const append = (sliceStart, sliceEnd, newStart, suffix) => {
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

export function deleteClipRipple(plan, clipIndex) {
  return rippleClip(plan, clipIndex, 'delete');
}

export function duplicateClipRipple(plan, clipIndex) {
  return rippleClip(plan, clipIndex, 'duplicate');
}

export function reorderClips(plan, fromIndex, toIndex) {
  const next = structuredClone(plan);
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

export function setOverlayText(plan, overlayId, text) {
  const next = structuredClone(plan);
  const clip = overlayClips(next).find((c) => c.id === overlayId);
  if (!clip) return { error: `overlay ${overlayId} does not exist` };
  if (!text?.trim()) return { error: 'text must not be empty' };
  clip.text = String(text).slice(0, 80);
  return { plan: next, patch: { kind: 'set-overlay-text', overlayId, text: clip.text } };
}

export function moveOverlay(plan, overlayId, beats) {
  if (!Number.isInteger(beats) || beats === 0)
    return { error: 'overlay timing moves must use a non-zero whole beat' };
  const next = structuredClone(plan);
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

// ---------- the model bridge ----------

const TOOLS = [
  {
    name: 'get_plan_summary',
    description:
      'Read the current edit plan: bpm, duration, the ordered clips with lanes and times, and the text overlays. Call this first to ground yourself.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'swap_clip_source',
    description:
      'Swap one clip to the other take (A<->B) keeping the same beats of the song, using the alignment derived from the plan. Call when the user wants a different take for a section.',
    input_schema: {
      type: 'object',
      properties: { clipIndex: { type: 'integer', description: '0-based clip index' } },
      required: ['clipIndex'],
      additionalProperties: false,
    },
  },
  {
    name: 'duplicate_clip',
    description:
      'Duplicate a selected source clip and ripple every timed track by the same duration.',
    input_schema: {
      type: 'object',
      properties: { clipIndex: { type: 'integer' } },
      required: ['clipIndex'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_clip',
    description:
      'Delete a selected source clip and ripple every timed track. Refuses the last source clip.',
    input_schema: {
      type: 'object',
      properties: { clipIndex: { type: 'integer' } },
      required: ['clipIndex'],
      additionalProperties: false,
    },
  },
  {
    name: 'split_clip',
    description:
      'Split one clip at its nearest safe beat. NodeVideo chooses the exact frame deterministically.',
    input_schema: {
      type: 'object',
      properties: { clipIndex: { type: 'integer' } },
      required: ['clipIndex'],
      additionalProperties: false,
    },
  },
  {
    name: 'nudge_boundary',
    description:
      'Move the cut after a clip earlier (negative) or later (positive) by whole beats; the neighbor absorbs the change so the timeline stays contiguous.',
    input_schema: {
      type: 'object',
      properties: {
        clipIndex: { type: 'integer' },
        beats: { type: 'integer', description: 'whole beats; negative = earlier' },
      },
      required: ['clipIndex', 'beats'],
      additionalProperties: false,
    },
  },
  {
    name: 'reorder_clips',
    description:
      'Move a clip to a new position in the sequence. The timeline re-lays contiguously; every clip keeps its own source frames.',
    input_schema: {
      type: 'object',
      properties: { fromIndex: { type: 'integer' }, toIndex: { type: 'integer' } },
      required: ['fromIndex', 'toIndex'],
      additionalProperties: false,
    },
  },
  {
    name: 'move_overlay',
    description:
      'Move one existing overlay earlier (negative) or later (positive) by whole beats without changing its duration.',
    input_schema: {
      type: 'object',
      properties: {
        overlayId: { type: 'string' },
        beats: { type: 'integer', description: 'non-zero whole beats' },
      },
      required: ['overlayId', 'beats'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_overlay_text',
    description: 'Rewrite the text of a lyric overlay (id from get_plan_summary), max 80 chars.',
    input_schema: {
      type: 'object',
      properties: { overlayId: { type: 'string' }, text: { type: 'string' } },
      required: ['overlayId', 'text'],
      additionalProperties: false,
    },
  },
];

const SYSTEM = `You are the NodeVideo edit agent for a beat-aligned dance edit ("Sign" case: two takes A/B cut on a beat grid with lyric overlays).
Ground every claim in tool results — call get_plan_summary before proposing anything.
Each mutating tool call becomes a patch card the user must accept; the plan you see updates as if accepted, but nothing is final until the user applies it. Say so when summarizing.
Make the smallest edit that satisfies the request. Never invent clips, overlays, or timings not present in the plan. These are relative, uncalibrated edits to a creative work — no quality guarantees.
Keep replies to a few sentences; the tool cards carry the detail.`;

export function modelConfigured() {
  return Boolean(
    process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      process.env.ANTHROPIC_PROFILE ||
      process.env.CLAUDE_CODE_OAUTH_TOKEN,
  );
}

export async function runEditAgent({ plan, message, history, send }) {
  const client = new Anthropic({
    timeout: nodeAgentRuntime.limits.maxInteractiveRunMs,
    maxRetries: 1,
  });
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('edit_agent_timeout')),
    nodeAgentRuntime.limits.maxInteractiveRunMs,
  );
  timeout.unref?.();
  let workingPlan = plan;
  let mutationProposed = false;

  const runTool = (name, input) => {
    if (name === 'get_plan_summary') return { summary: planSummary(workingPlan) };
    if (mutationProposed) return { error: ONE_EDIT_PER_PROPOSAL_ERROR };
    const result =
      name === 'swap_clip_source'
        ? swapClipSource(workingPlan, input.clipIndex)
        : name === 'duplicate_clip'
          ? duplicateClipRipple(workingPlan, input.clipIndex)
          : name === 'delete_clip'
            ? deleteClipRipple(workingPlan, input.clipIndex)
            : name === 'split_clip'
              ? splitClipOnNearestBeat(workingPlan, input.clipIndex)
              : name === 'nudge_boundary'
                ? nudgeBoundary(workingPlan, input.clipIndex, input.beats)
                : name === 'reorder_clips'
                  ? reorderClips(workingPlan, input.fromIndex, input.toIndex)
                  : name === 'set_overlay_text'
                    ? setOverlayText(workingPlan, input.overlayId, input.text)
                    : name === 'move_overlay'
                      ? moveOverlay(workingPlan, input.overlayId, input.beats)
                      : { error: `unknown tool ${name}` };
    if (result.error) return { error: result.error };
    workingPlan = result.plan;
    mutationProposed = true;
    send({ type: 'proposal', proposal: result.patch });
    return { applied: 'pending user acceptance', summary: planSummary(workingPlan).clips };
  };

  const messages = [
    ...(history ?? [])
      .slice(-nodeAgentRuntime.limits.maxHistoryTurns)
      .map((turn) => ({ role: turn.role, content: turn.text })),
    {
      role: 'user',
      content: String(message).slice(0, nodeAgentRuntime.limits.maxModelMessageCharacters),
    },
  ];

  try {
    // Manual streaming loop: relay thinking summaries and text deltas as our
    // SSE events, execute tool calls between turns.
    for (let iteration = 0; iteration < nodeAgentRuntime.limits.maxToolIterations; iteration += 1) {
      const stream = client.messages.stream(
        {
          model: MODEL,
          max_tokens: 4096,
          thinking: { type: 'adaptive', display: 'summarized' },
          output_config: { effort: 'low' },
          system: SYSTEM,
          tools: TOOLS,
          messages,
        },
        { signal: controller.signal },
      );
      stream.on('streamEvent', (event) => {
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'thinking_delta' && event.delta.thinking)
            send({ type: 'reasoning', delta: event.delta.thinking });
          if (event.delta.type === 'text_delta') send({ type: 'text', delta: event.delta.text });
        }
      });
      const response = await stream.finalMessage();

      if (response.stop_reason === 'refusal') {
        send({ type: 'error', error: 'model_refused' });
        return;
      }
      const toolUses = response.content.filter((block) => block.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) return;

      messages.push({ role: 'assistant', content: response.content });
      const results = toolUses.map((use) => {
        const output = runTool(use.name, use.input);
        send({ type: 'tool', name: use.name, input: use.input, output });
        return {
          type: 'tool_result',
          tool_use_id: use.id,
          content: JSON.stringify(output),
          is_error: Boolean(output.error),
        };
      });
      messages.push({ role: 'user', content: results });
    }
    send({ type: 'error', error: 'edit_agent_iteration_limit' });
  } catch {
    send({
      type: 'error',
      error: controller.signal.aborted ? 'edit_agent_timeout' : 'edit_agent_upstream_failure',
    });
  } finally {
    clearTimeout(timeout);
  }
}
