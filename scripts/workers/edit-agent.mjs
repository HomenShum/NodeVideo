// The edit agent bridge: streams a real Claude model over the same SSE event
// contract the panel's local rule agent uses (reasoning | tool | text |
// proposal | error | done). Every mutating tool call the model makes is
// executed on a WORKING COPY of the plan server-side (so the model sees its
// own edits) and simultaneously emitted as a proposal event — the browser
// applies a patch only when the user accepts its card. No key or profile
// configured -> the endpoint reports model_not_configured and the panel
// stays on its local rules; it never pretends a model ran.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.NODEVIDEO_EDIT_AGENT_MODEL ?? 'claude-opus-4-8';

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
  const client = new Anthropic();
  let workingPlan = plan;

  const runTool = (name, input) => {
    if (name === 'get_plan_summary') return { summary: planSummary(workingPlan) };
    const result =
      name === 'swap_clip_source'
        ? swapClipSource(workingPlan, input.clipIndex)
        : name === 'nudge_boundary'
          ? nudgeBoundary(workingPlan, input.clipIndex, input.beats)
          : name === 'reorder_clips'
            ? reorderClips(workingPlan, input.fromIndex, input.toIndex)
            : name === 'set_overlay_text'
              ? setOverlayText(workingPlan, input.overlayId, input.text)
              : { error: `unknown tool ${name}` };
    if (result.error) return { error: result.error };
    workingPlan = result.plan;
    send({ type: 'proposal', proposal: result.patch });
    return { applied: 'pending user acceptance', summary: planSummary(workingPlan).clips };
  };

  const messages = [
    ...(history ?? []).map((turn) => ({ role: turn.role, content: turn.text })),
    { role: 'user', content: String(message).slice(0, 2000) },
  ];

  // Manual streaming loop: relay thinking summaries and text deltas as our
  // SSE events, execute tool calls between turns.
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'low' },
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });
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
}
