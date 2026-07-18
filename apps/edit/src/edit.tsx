import './edit.css';
import { Conversation, ConversationContent } from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input';
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Player } from '@remotion/player';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AbsoluteFill, Sequence, Video } from 'remotion';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';

// ---------- plan model (the committed, hash-verified Sign case) ----------

type FrameRange = { startFrame: number; endFrameExclusive: number };
type SourceClip = {
  id: string;
  kind: string;
  assetId?: string;
  timelineRange: FrameRange;
  sourceRange?: FrameRange;
};
type OverlayClip = {
  id: string;
  kind: string;
  text?: string;
  timelineRange: FrameRange;
  box?: { x: number; y: number; width: number; height: number };
};
type Plan = {
  frameRate: number;
  durationFrames: number;
  canvas: { width: number; height: number };
  beatGrid: { bpm: number; beatsMs: number[]; downbeatsMs: number[] };
  tracks: Array<{ id: string; kind: string; clips: Array<SourceClip & OverlayClip> }>;
};
type PlanPatch = {
  kind: 'swap-source' | 'nudge-boundary';
  clipIndex: number;
  beats?: number;
  summary: string;
  before: string;
  after: string;
  accepted?: boolean;
};
type AgentTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  steps: Array<{ name: string; input: unknown; output: unknown }>;
  patch?: PlanPatch;
};

const PLAN_URL = '/media/integrated-source-only-v1/edit-plan.json';
const ASSETS: Record<string, string> = {
  'asset.take-a': '/media/authorized-real-v1/source-a-web.mp4',
  'asset.take-b': '/media/authorized-real-v1/source-b-web.mp4',
};

const videoClips = (plan: Plan) =>
  (plan.tracks.find((t) => t.kind === 'video')?.clips ?? []).filter(
    (c) => c.kind === 'source' && c.assetId && c.sourceRange,
  ) as Required<SourceClip>[];
const overlayClips = (plan: Plan) =>
  (plan.tracks.find((t) => t.kind === 'overlay')?.clips ?? []).filter(
    (c) => c.kind === 'text' && c.text,
  );

// Per-asset timeline->source frame offset, derived from the plan's own clips,
// so a lane swap keeps the choreography instant aligned.
function assetOffsets(plan: Plan) {
  const offsets: Record<string, number> = {};
  for (const clip of videoClips(plan)) {
    offsets[clip.assetId] ??= clip.sourceRange.startFrame - clip.timelineRange.startFrame;
  }
  return offsets;
}

function applyPatch(plan: Plan, patch: PlanPatch): Plan {
  const next: Plan = JSON.parse(JSON.stringify(plan));
  const clips = videoClips(next);
  const clip = clips[patch.clipIndex];
  if (!clip) return plan;
  if (patch.kind === 'swap-source') {
    const other = clip.assetId === 'asset.take-a' ? 'asset.take-b' : 'asset.take-a';
    const offset = assetOffsets(next)[other];
    if (offset === undefined) return plan;
    clip.assetId = other;
    clip.sourceRange = {
      startFrame: clip.timelineRange.startFrame + offset,
      endFrameExclusive: clip.timelineRange.endFrameExclusive + offset,
    };
  }
  if (patch.kind === 'nudge-boundary' && patch.beats) {
    const framesPerBeat = (60 / next.beatGrid.bpm) * next.frameRate;
    const delta = Math.round(patch.beats * framesPerBeat);
    const neighbor = clips[patch.clipIndex + 1];
    if (!neighbor) return plan;
    const boundary = clip.timelineRange.endFrameExclusive + delta;
    if (
      boundary <= clip.timelineRange.startFrame + framesPerBeat ||
      boundary >= neighbor.timelineRange.endFrameExclusive - framesPerBeat
    )
      return plan;
    clip.timelineRange.endFrameExclusive = boundary;
    clip.sourceRange.endFrameExclusive += delta;
    neighbor.timelineRange.startFrame = boundary;
    neighbor.sourceRange.startFrame += delta;
  }
  return next;
}

// ---------- deterministic preview (Remotion) ----------

function PlanComposition({ plan }: { plan: Plan }) {
  return (
    <AbsoluteFill style={{ backgroundColor: '#0c0e0a' }}>
      {videoClips(plan).map((clip) => (
        <Sequence
          durationInFrames={clip.timelineRange.endFrameExclusive - clip.timelineRange.startFrame}
          from={clip.timelineRange.startFrame}
          key={clip.id}
        >
          <Video
            muted
            src={ASSETS[clip.assetId]}
            startFrom={clip.sourceRange.startFrame}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </Sequence>
      ))}
      {overlayClips(plan).map((clip) => (
        <Sequence
          durationInFrames={clip.timelineRange.endFrameExclusive - clip.timelineRange.startFrame}
          from={clip.timelineRange.startFrame}
          key={clip.id}
        >
          <div
            style={{
              position: 'absolute',
              left: `${(clip.box?.x ?? 0.1) * 100}%`,
              top: `${(clip.box?.y ?? 0.8) * 100}%`,
              width: `${(clip.box?.width ?? 0.8) * 100}%`,
              textAlign: 'center',
              color: 'white',
              fontFamily: 'Geist Variable, system-ui, sans-serif',
              fontWeight: 700,
              fontSize: 42,
              textShadow: '0 2px 12px rgba(0,0,0,0.8)',
            }}
          >
            {clip.text}
          </div>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

// ---------- the studio ----------

function StitchStudio() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [history, setHistory] = useState<Plan[]>([]);
  const [thread, setThread] = useState<AgentTurn[]>([]);
  const waveRef = useRef<HTMLDivElement>(null);
  const surferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const syncingRef = useRef(false);
  const planRef = useRef<Plan | null>(null);
  planRef.current = plan;

  useEffect(() => {
    void fetch(PLAN_URL)
      .then((r) => r.json())
      .then(setPlan);
  }, []);

  // Waveform of take A's own audio (the Sign master is not distributed);
  // the beat grid comes from the frozen plan and drives all snapping. The
  // surfer is created once when the plan first loads (patches update regions
  // via syncRegions, never by rebuilding the waveform).
  const planLoaded = plan !== null;
  useEffect(() => {
    if (!waveRef.current || !planLoaded || surferRef.current) return;
    const surfer = WaveSurfer.create({
      container: waveRef.current,
      url: ASSETS['asset.take-a'],
      height: 88,
      waveColor: '#3a4034',
      progressColor: '#cfff4a',
      cursorColor: '#eef0e8',
      minPxPerSec: 18,
    });
    const regions = surfer.registerPlugin(RegionsPlugin.create());
    surferRef.current = surfer;
    regionsRef.current = regions;
    surfer.on('ready', () => {
      // Wavesurfer's internal scroller must be keyboard-reachable.
      const scroller = surfer.getWrapper().parentElement;
      if (scroller) {
        scroller.setAttribute('tabindex', '0');
        scroller.setAttribute('role', 'region');
        scroller.setAttribute('aria-label', 'Waveform scroll area');
      }
      syncRegions();
    });
    regions.on('region-updated', (region) => {
      if (syncingRef.current) return;
      const current = planRef.current;
      if (!current) return;
      const index = Number(String(region.id).replace('clip-', ''));
      const clips = videoClips(current);
      const clip = clips[index];
      const neighbor = clips[index + 1];
      if (!clip || !neighbor) return syncRegions();
      // Snap the moved end boundary to the nearest beat from the plan's grid.
      const beatSeconds = current.beatGrid.beatsMs.map((ms) => ms / 1000);
      const snapped = beatSeconds.reduce(
        (best, b) => (Math.abs(b - region.end) < Math.abs(best - region.end) ? b : best),
        beatSeconds[0] ?? region.end,
      );
      const beats =
        (snapped * current.frameRate - clip.timelineRange.endFrameExclusive) /
        ((60 / current.beatGrid.bpm) * current.frameRate);
      const rounded = Math.round(beats);
      if (rounded === 0) return syncRegions();
      pushPlan(
        applyPatch(current, {
          kind: 'nudge-boundary',
          clipIndex: index,
          beats: rounded,
          summary: '',
          before: '',
          after: '',
        }),
      );
    });
    return () => {
      surfer.destroy();
      surferRef.current = null;
    };
  }, [planLoaded]);

  function syncRegions() {
    const current = planRef.current;
    const regions = regionsRef.current;
    if (!current || !regions) return;
    syncingRef.current = true;
    regions.clearRegions();
    for (const ms of current.beatGrid.downbeatsMs) {
      regions.addRegion({ start: ms / 1000, color: 'rgba(238,240,232,0.35)', drag: false });
    }
    videoClips(current).forEach((clip, index) => {
      regions.addRegion({
        id: `clip-${index}`,
        start: clip.timelineRange.startFrame / current.frameRate,
        end: clip.timelineRange.endFrameExclusive / current.frameRate,
        color: clip.assetId === 'asset.take-a' ? 'rgba(207,255,74,0.18)' : 'rgba(154,161,144,0.22)',
        content: clip.assetId === 'asset.take-a' ? 'A' : 'B',
        drag: false,
        resize: true,
      });
    });
    syncingRef.current = false;
  }

  function pushPlan(next: Plan) {
    setHistory((h) => [...h.slice(-19), planRef.current as Plan]);
    setPlan(next);
    queueMicrotask(syncRegions);
  }

  function undo() {
    setHistory((h) => {
      const previous = h.at(-1);
      if (previous) {
        setPlan(previous);
        queueMicrotask(syncRegions);
      }
      return h.slice(0, -1);
    });
  }

  // Local rule-grounded edit agent: every step is a real operation on the
  // loaded plan in this tab; patches apply only when accepted. No cloud model.
  function askAgent(text: string) {
    if (!plan || !text.trim()) return;
    const id = String(Date.now());
    const clips = videoClips(plan);
    const describe = (c: Required<SourceClip>, i: number) =>
      `#${i} ${c.assetId === 'asset.take-a' ? 'A' : 'B'} ${(c.timelineRange.startFrame / plan.frameRate).toFixed(1)}–${(c.timelineRange.endFrameExclusive / plan.frameRate).toFixed(1)}s`;
    const turn: AgentTurn = { id: `${id}-a`, role: 'assistant', text: '', steps: [] };

    const swap = text.match(/swap\D*(\d+)/i);
    const nudge = text.match(/(tighten|extend|nudge)\D*(\d+)\D*?(-?\d+)?\s*beat/i);
    if (swap && clips[Number(swap[1])]) {
      const index = Number(swap[1]);
      const clip = clips[index];
      const other = clip.assetId === 'asset.take-a' ? 'take B' : 'take A';
      turn.steps.push({
        name: 'inspect_clip',
        input: { clipIndex: index },
        output: { clip: describe(clip, index), lane: clip.assetId },
      });
      turn.patch = {
        kind: 'swap-source',
        clipIndex: index,
        summary: `Swap clip #${index} to ${other}`,
        before: describe(clip, index),
        after: `#${index} ${other === 'take A' ? 'A' : 'B'} same timeline range, source re-aligned`,
      };
      turn.text = `Clip #${index} currently plays ${clip.assetId === 'asset.take-a' ? 'take A' : 'take B'}. Swapping keeps the same beats of the song but pulls the aligned frames from ${other}. Review the patch below.`;
    } else if (nudge && clips[Number(nudge[2])]) {
      const index = Number(nudge[2]);
      const beats = nudge[3] ? Number(nudge[3]) : nudge[1].toLowerCase() === 'tighten' ? -1 : 1;
      turn.steps.push({
        name: 'measure_boundary',
        input: { clipIndex: index, beats },
        output: {
          boundary: describe(clips[index], index),
          beatLengthMs: Math.round(60000 / plan.beatGrid.bpm),
        },
      });
      turn.patch = {
        kind: 'nudge-boundary',
        clipIndex: index,
        beats,
        summary: `Move the cut after clip #${index} by ${beats} beat${Math.abs(beats) === 1 ? '' : 's'}`,
        before: describe(clips[index], index),
        after: `cut shifts ${((beats * 60) / plan.beatGrid.bpm).toFixed(2)}s ${beats > 0 ? 'later' : 'earlier'}, next clip absorbs the change`,
      };
      turn.text = `The boundary after clip #${index} sits on the grid at ${plan.beatGrid.bpm.toFixed(1)} bpm. This patch moves it ${beats > 0 ? 'later' : 'earlier'} by ${Math.abs(beats)} beat${Math.abs(beats) === 1 ? '' : 's'} and keeps the timeline contiguous.`;
    } else {
      turn.steps.push({
        name: 'list_clips',
        input: {},
        output: clips.map(describe),
      });
      turn.text = `${clips.length} cuts across the two takes at ${plan.beatGrid.bpm.toFixed(1)} bpm. Try "swap 2", "tighten 1 by 1 beat", or drag a cut on the timeline — everything snaps to the beat grid.`;
    }
    setThread((current) => [...current, { id: `${id}-u`, role: 'user', text, steps: [] }, turn]);
  }

  function acceptPatch(turnId: string) {
    const turn = thread.find((t) => t.id === turnId);
    if (!turn?.patch || turn.patch.accepted || !plan) return;
    pushPlan(applyPatch(plan, turn.patch));
    setThread((current) =>
      current.map((t) =>
        t.id === turnId && t.patch ? { ...t, patch: { ...t.patch, accepted: true } } : t,
      ),
    );
  }

  const composition = useMemo(() => plan && <PlanComposition plan={plan} />, [plan]);
  return (
    <main className="mx-auto min-h-svh max-w-7xl space-y-4 p-4 sm:p-6" data-testid="stitch-studio">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            NodeVideo · Stitch studio
          </p>
          <h1 className="font-heading text-2xl font-semibold sm:text-3xl">
            Edit the Sign cut, on the beat.
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {plan ? `${plan.beatGrid.bpm.toFixed(1)} bpm` : 'loading plan'}
          </Badge>
          <Button disabled={history.length === 0} onClick={undo} size="sm" variant="outline">
            Undo last patch
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.55fr)_minmax(0,0.45fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Deterministic preview</CardTitle>
            <CardDescription>
              The frozen plan rendered live by Remotion from the public web takes — same clips, same
              lyric overlays; music and final grading render in the studio pipeline.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {plan && composition ? (
              <div className="mx-auto max-w-70" data-testid="plan-preview">
                <Player
                  acknowledgeRemotionLicense
                  component={PlanComposition}
                  compositionHeight={plan.canvas.height}
                  compositionWidth={plan.canvas.width}
                  controls
                  durationInFrames={plan.durationFrames}
                  fps={plan.frameRate}
                  inputProps={{ plan }}
                  style={{ width: '100%', aspectRatio: '9 / 16' }}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Loading the frozen edit plan…</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Edit agent</CardTitle>
            <CardDescription>
              Rule-grounded and local — every step is a real operation on the plan in this tab;
              patches change the timeline only when you accept them. No cloud model.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Conversation className="max-h-80 rounded-lg border border-border">
              <ConversationContent className="space-y-3">
                {thread.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Ask about the cuts, swap a clip between takes, or nudge a boundary by beats.
                  </p>
                )}
                {thread.map((turn) =>
                  turn.role === 'user' ? (
                    <Message from="user" key={turn.id}>
                      <MessageContent>{turn.text}</MessageContent>
                    </Message>
                  ) : (
                    <Message from="assistant" key={turn.id}>
                      <MessageContent className="w-full space-y-2">
                        {turn.steps.map((step) => (
                          <Tool key={`${turn.id}-${step.name}`}>
                            <ToolHeader
                              state="output-available"
                              toolName={step.name}
                              type="dynamic-tool"
                            />
                            <ToolContent>
                              <ToolInput input={step.input} />
                              <ToolOutput output={step.output} />
                            </ToolContent>
                          </Tool>
                        ))}
                        {turn.text && <MessageResponse>{turn.text}</MessageResponse>}
                        {turn.patch && (
                          <div className="rounded-lg border border-border bg-card p-3">
                            <p className="text-sm font-medium">{turn.patch.summary}</p>
                            <p className="font-mono text-xs text-muted-foreground">
                              {turn.patch.before} → {turn.patch.after}
                            </p>
                            <Button
                              className="mt-2"
                              disabled={turn.patch.accepted}
                              onClick={() => acceptPatch(turn.id)}
                              size="sm"
                              type="button"
                            >
                              {turn.patch.accepted ? 'Patch applied' : 'Apply patch'}
                            </Button>
                          </div>
                        )}
                      </MessageContent>
                    </Message>
                  ),
                )}
              </ConversationContent>
            </Conversation>
            {thread.length === 0 && (
              <Suggestions className="w-full flex-wrap">
                {['Show the cuts', 'Swap 2', 'Tighten 1 by 1 beat'].map((s) => (
                  <Suggestion key={s} onClick={() => askAgent(s)} suggestion={s} />
                ))}
              </Suggestions>
            )}
            <PromptInput onSubmit={({ text }) => askAgent(text ?? '')}>
              <PromptInputBody>
                <PromptInputTextarea
                  aria-label="Ask the edit agent"
                  placeholder="Ask the edit agent — swap 2, tighten 1 by 1 beat…"
                />
              </PromptInputBody>
              <PromptInputFooter>
                <PromptInputSubmit />
              </PromptInputFooter>
            </PromptInput>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Beat timeline</CardTitle>
          <CardDescription>
            Take A's own audio waveform (the Sign master is not distributed); lime regions are take
            A cuts, grey are take B, hairlines are downbeats. Drag a cut edge — it snaps to the
            plan's beat grid.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div aria-label="Beat-aligned edit timeline" ref={waveRef} role="region" />
        </CardContent>
      </Card>

      <footer className="text-xs text-muted-foreground">
        Edits here are proposals on the loaded plan; the hash-verified render remains the studio
        pipeline's job. Nothing uploads.
      </footer>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Stitch studio root missing.');
createRoot(root).render(
  <StrictMode>
    <StitchStudio />
  </StrictMode>,
);
