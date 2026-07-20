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
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import type { BrowserFfmpegProgress } from '@/lib/browser-ffmpeg';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Player, type PlayerRef } from '@remotion/player';
import { Download, X } from 'lucide-react';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Moveable from 'react-moveable';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import {
  cancelBrowserEditExport,
  disposeBrowserEditExporter,
  exportBrowserEditPlan,
} from './browser-export';
import {
  DEFAULT_MODEL,
  maskKey,
  readByokKey,
  readByokModel,
  writeByokKey,
  writeByokModel,
} from './byok';
import { EDIT_ASSET_URLS, PlanComposition } from './plan-composition';
import type { FrameRange, Plan } from './plan-tools';

// ---------- plan model (the committed, hash-verified Sign case) ----------

type SourceClip = {
  id: string;
  kind: string;
  assetId?: string;
  timelineRange: FrameRange;
  sourceRange?: FrameRange;
};
type PlanPatch = {
  kind: 'swap-source' | 'nudge-boundary' | 'reorder-clips' | 'set-overlay-text';
  clipIndex?: number;
  beats?: number;
  fromIndex?: number;
  toIndex?: number;
  overlayId?: string;
  text?: string;
  summary: string;
  before: string;
  after: string;
  accepted?: boolean;
};
type AgentTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  reasoning?: string;
  steps: Array<{ name: string; input: unknown; output: unknown }>;
  patch?: PlanPatch;
};
type BrowserExportState = {
  status: 'idle' | 'running' | 'ready' | 'cancelled' | 'error';
  ratio: number;
  phase?: BrowserFfmpegProgress['phase'];
  coreKind?: BrowserFfmpegProgress['coreKind'];
  url?: string;
  bytes?: number;
  fileName?: string;
  message?: string;
};

const PLAN_URL = '/media/integrated-source-only-v1/edit-plan.json';
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
  if (patch.kind === 'reorder-clips') {
    return typeof patch.fromIndex === 'number' && typeof patch.toIndex === 'number'
      ? withClipOrder(plan, patch.fromIndex, patch.toIndex)
      : plan;
  }
  if (patch.kind === 'set-overlay-text') {
    return patch.overlayId && patch.text
      ? withOverlayText(plan, patch.overlayId, patch.text)
      : plan;
  }
  const next: Plan = JSON.parse(JSON.stringify(plan));
  const clips = videoClips(next);
  const clip = clips[patch.clipIndex ?? -1];
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

// Direct-manipulation mutators: every gesture routes through pushPlan, so a
// drag is an applied, undoable patch — the same contract the agent uses.
function withOverlayBox(
  plan: Plan,
  overlayId: string,
  box: { x: number; y: number; width: number },
): Plan {
  const next: Plan = JSON.parse(JSON.stringify(plan));
  const clip = overlayClips(next).find((c) => c.id === overlayId);
  if (!clip?.box) return plan;
  const width = Math.min(Math.max(box.width, 0.1), 1);
  clip.box.width = width;
  clip.box.x = Math.min(Math.max(box.x, 0), 1 - width);
  clip.box.y = Math.min(Math.max(box.y, 0), 1 - clip.box.height);
  return next;
}

function withOverlayText(plan: Plan, overlayId: string, text: string): Plan {
  const next: Plan = JSON.parse(JSON.stringify(plan));
  const clip = overlayClips(next).find((c) => c.id === overlayId);
  if (!clip || !text.trim()) return plan;
  clip.text = text.slice(0, 80);
  return next;
}

function withClipOrder(plan: Plan, fromIndex: number, toIndex: number): Plan {
  const next: Plan = JSON.parse(JSON.stringify(plan));
  const track = next.tracks.find((t) => t.kind === 'video');
  if (!track) return plan;
  const reordered = arrayMove(track.clips, fromIndex, toIndex);
  // Re-lay the timeline contiguously; each clip keeps its duration and its
  // own source frames, so reordering never invents footage.
  let cursor = 0;
  for (const clip of reordered) {
    const duration = clip.timelineRange.endFrameExclusive - clip.timelineRange.startFrame;
    clip.timelineRange = { startFrame: cursor, endFrameExclusive: cursor + duration };
    cursor += duration;
  }
  track.clips = reordered;
  return next;
}

function overlaysAtFrame(plan: Plan, frame: number) {
  return overlayClips(plan).filter(
    (c) => c.timelineRange.startFrame <= frame && frame < c.timelineRange.endFrameExclusive,
  );
}

function ClipChip({
  clip,
  index,
  plan,
  onSeek,
}: { clip: Required<SourceClip>; index: number; plan: Plan; onSeek: (frame: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: clip.id,
  });
  const seconds = (frame: number) => (frame / plan.frameRate).toFixed(1);
  const lane = clip.assetId === 'asset.take-a' ? 'A' : 'B';
  return (
    <button
      aria-label={`Clip ${index} take ${lane}`}
      onClick={() => onSeek(clip.timelineRange.startFrame)}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-xs ${
        lane === 'A'
          ? 'border-brand/60 bg-brand/10 text-foreground'
          : 'border-border bg-card text-muted-foreground'
      } ${isDragging ? 'opacity-60' : ''}`}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      type="button"
      {...attributes}
      {...listeners}
    >
      <span className="font-semibold">{lane}</span>
      <span>
        {seconds(clip.timelineRange.startFrame)}–{seconds(clip.timelineRange.endFrameExclusive)}s
      </span>
    </button>
  );
}

function exportPhaseLabel(phase?: BrowserFfmpegProgress['phase']) {
  if (phase === 'loading-core') return 'Loading media and the local video engine';
  if (phase === 'writing-inputs') return 'Preparing the two takes';
  if (phase === 'rendering') return 'Encoding the accepted cut';
  if (phase === 'reading-output') return 'Finalizing the MP4';
  if (phase === 'complete') return 'MP4 ready';
  return 'Starting local export';
}

function formatFileSize(bytes = 0) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------- the studio ----------

function StitchStudio() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [history, setHistory] = useState<Plan[]>([]);
  const [thread, setThread] = useState<AgentTurn[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [browserExport, setBrowserExport] = useState<BrowserExportState>({
    status: 'idle',
    ratio: 0,
  });
  const [workerEndpoint, setWorkerEndpoint] = useState(
    () => localStorage.getItem('nv-edit-worker-endpoint') ?? 'http://127.0.0.1:4319',
  );
  const [workerToken, setWorkerToken] = useState(
    () => localStorage.getItem('nv-edit-worker-token') ?? '',
  );
  // Session-only BYOK key: sessionStorage (cleared on tab close), sent only to
  // OpenRouter from this browser, never to a NodeVideo server.
  const [byokKey, setByokKey] = useState(readByokKey);
  const [byokModel, setByokModel] = useState(readByokModel);
  const modelMode: 'browser' | 'worker' | 'local' = byokKey.trim()
    ? 'browser'
    : workerToken.trim()
      ? 'worker'
      : 'local';
  const modelConnected = modelMode !== 'local';
  useEffect(() => {
    localStorage.setItem('nv-edit-worker-endpoint', workerEndpoint);
    localStorage.setItem('nv-edit-worker-token', workerToken);
  }, [workerEndpoint, workerToken]);
  useEffect(() => writeByokKey(byokKey), [byokKey]);
  useEffect(() => writeByokModel(byokModel), [byokModel]);
  const [overlayEdit, setOverlayEdit] = useState(false);
  const [editFrame, setEditFrame] = useState(0);
  const [selectedOverlay, setSelectedOverlay] = useState<string | null>(null);
  const playerRef = useRef<PlayerRef>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const exportUrlRef = useRef('');
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const overlayNodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // A small drag threshold keeps taps as taps: a plain click on a chip seeks
  // the player to that clip; moving past 6px starts the reorder drag instead.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const seekToFrame = (frame: number) => {
    playerRef.current?.pause();
    playerRef.current?.seekTo(frame);
  };
  const planPreviewRef = useRef<HTMLDivElement>(null);
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
  useEffect(
    () => () => {
      exportAbortRef.current?.abort();
      disposeBrowserEditExporter();
      if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current);
    },
    [],
  );

  // Waveform of take A's own audio (the Sign master is not distributed);
  // the beat grid comes from the frozen plan and drives all snapping. The
  // surfer is created once when the plan first loads (patches update regions
  // via syncRegions, never by rebuilding the waveform).
  const planLoaded = plan !== null;
  // Mirror the player's frame onto the preview wrapper so seeks are
  // observable state (tests and agents read it), not invisible side effects.
  useEffect(() => {
    const player = playerRef.current;
    if (!planLoaded || !player) return;
    const onFrame = (event: { detail: { frame: number } }) =>
      planPreviewRef.current?.setAttribute('data-frame', String(event.detail.frame));
    player.addEventListener('frameupdate', onFrame);
    return () => player.removeEventListener('frameupdate', onFrame);
  }, [planLoaded]);
  useEffect(() => {
    if (!waveRef.current || !planLoaded || surferRef.current) return;
    const surfer = WaveSurfer.create({
      container: waveRef.current,
      url: EDIT_ASSET_URLS['asset.take-a'],
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

  async function startBrowserExport() {
    const current = planRef.current;
    if (!current || browserExport.status === 'running') return;
    playerRef.current?.pause();
    exportAbortRef.current?.abort();
    const controller = new AbortController();
    exportAbortRef.current = controller;
    if (exportUrlRef.current) {
      URL.revokeObjectURL(exportUrlRef.current);
      exportUrlRef.current = '';
    }
    setBrowserExport({ status: 'running', ratio: 0.01, phase: 'loading-core' });
    try {
      const snapshot = structuredClone(current);
      const fileName = 'nodevideo-sign-edit.mp4';
      const result = await exportBrowserEditPlan(snapshot, {
        fileName,
        signal: controller.signal,
        onProgress: (progress) =>
          setBrowserExport((state) =>
            state.status === 'running'
              ? {
                  status: 'running',
                  ratio: progress.ratio,
                  phase: progress.phase,
                  coreKind: progress.coreKind,
                }
              : state,
          ),
      });
      const url = URL.createObjectURL(result.blob);
      exportUrlRef.current = url;
      setBrowserExport({
        status: 'ready',
        ratio: 1,
        phase: 'complete',
        coreKind: result.coreKind,
        url,
        bytes: result.bytes.byteLength,
        fileName: result.fileName,
        message: 'Silent MP4 ready. The download has started.',
      });
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } catch (cause) {
      const cancelled =
        controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError');
      setBrowserExport({
        status: cancelled ? 'cancelled' : 'error',
        ratio: 0,
        message: cancelled
          ? 'Export cancelled. No partial file was downloaded.'
          : cause instanceof Error
            ? cause.message
            : 'The browser could not export this cut.',
      });
    } finally {
      if (exportAbortRef.current === controller) exportAbortRef.current = null;
    }
  }

  function cancelBrowserExport() {
    exportAbortRef.current?.abort();
    cancelBrowserEditExport();
  }

  function describeModelPatch(patch: PlanPatch, current: Plan): PlanPatch {
    const clips = videoClips(current);
    const lane = (c?: Required<SourceClip>) => (c?.assetId === 'asset.take-a' ? 'A' : 'B');
    if (patch.kind === 'swap-source')
      return {
        ...patch,
        summary: `Swap clip #${patch.clipIndex} to take ${lane(clips[patch.clipIndex ?? -1]) === 'A' ? 'B' : 'A'}`,
        before: `clip #${patch.clipIndex} plays take ${lane(clips[patch.clipIndex ?? -1])}`,
        after: 'same timeline range, source re-aligned to the other take',
      };
    if (patch.kind === 'nudge-boundary')
      return {
        ...patch,
        summary: `Move the cut after clip #${patch.clipIndex} by ${patch.beats} beat${Math.abs(patch.beats ?? 0) === 1 ? '' : 's'}`,
        before: `boundary at ${((clips[patch.clipIndex ?? -1]?.timelineRange.endFrameExclusive ?? 0) / current.frameRate).toFixed(1)}s`,
        after: 'neighbor absorbs the change; timeline stays contiguous',
      };
    if (patch.kind === 'reorder-clips')
      return {
        ...patch,
        summary: `Move clip #${patch.fromIndex} to position ${patch.toIndex}`,
        before: 'current clip order',
        after: 'timeline re-laid contiguously; sources unchanged',
      };
    return {
      ...patch,
      summary: `Rewrite overlay text to "${patch.text}"`,
      before: 'current lyric text',
      after: `"${patch.text}"`,
    };
  }

  // Model-backed agent path: streams from the local worker's /v1/edit/agent
  // (a real Claude model with the same tools). Falls back to the local rules
  // with an honest note when the worker or model is unavailable.
  async function askModel(text: string) {
    if (!plan || agentBusy) return;
    setAgentBusy(true);
    const id = String(Date.now());
    const turn: AgentTurn = { id: `${id}-a`, role: 'assistant', text: '', steps: [] };
    setThread((current) => [...current, { id: `${id}-u`, role: 'user', text, steps: [] }, turn]);
    const patchTurn = (change: (t: AgentTurn) => AgentTurn) =>
      setThread((current) => current.map((t) => (t.id === turn.id ? change(t) : t)));
    const controller = new AbortController();
    const idle = () => window.setTimeout(() => controller.abort('idle'), 30_000);
    let idleTimer = idle();
    const totalTimer = window.setTimeout(() => controller.abort('timeout'), 180_000);
    let sawDone = false;
    try {
      const response = await fetch(`${workerEndpoint.replace(/\/$/, '')}/v1/edit/agent`, {
        method: 'POST',
        headers: { authorization: `Bearer ${workerToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          plan,
          message: text,
          history: thread
            .filter((t) => t.text)
            .slice(-8)
            .map((t) => ({ role: t.role, text: t.text })),
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? 'worker_unreachable');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        window.clearTimeout(idleTimer);
        idleTimer = idle();
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split('\n\n');
        buffered = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let event: {
            type?: string;
            delta?: unknown;
            name?: string;
            input?: unknown;
            output?: unknown;
            proposal?: Partial<PlanPatch>;
            error?: string;
          };
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (event.type === 'text' && typeof event.delta === 'string')
            patchTurn((t) => ({ ...t, text: t.text + event.delta }));
          if (event.type === 'reasoning' && typeof event.delta === 'string')
            patchTurn((t) => ({ ...t, reasoning: (t.reasoning ?? '') + event.delta }));
          if (event.type === 'tool')
            patchTurn((t) => ({
              ...t,
              steps: [
                ...t.steps,
                { name: event.name ?? 'tool', input: event.input, output: event.output },
              ],
            }));
          if (event.type === 'proposal' && event.proposal && plan)
            patchTurn((t) => ({
              ...t,
              patch: describeModelPatch(
                { summary: '', before: '', after: '', ...event.proposal } as PlanPatch,
                planRef.current ?? plan,
              ),
            }));
          if (event.type === 'error')
            patchTurn((t) => ({
              ...t,
              text: t.text || `The model could not complete this: ${event.error}.`,
            }));
          if (event.type === 'done') sawDone = true;
        }
      }
      if (!sawDone)
        patchTurn((t) => ({
          ...t,
          text: `${t.text}\n\n(Reply interrupted — stream ended early.)`,
        }));
    } catch (cause) {
      const message =
        cause instanceof Error && cause.message === 'model_not_configured'
          ? 'The worker has no model credentials configured — using the local rule agent instead.'
          : 'The model worker is not reachable — using the local rule agent instead.';
      patchTurn((t) => ({ ...t, text: message }));
      askAgent(text);
    } finally {
      window.clearTimeout(idleTimer);
      window.clearTimeout(totalTimer);
      setAgentBusy(false);
    }
  }

  // In-browser model agent: runs the OpenAI-compatible tool loop entirely in
  // this tab against OpenRouter with the user's session key — no server. Same
  // event shapes as the worker path, so the thread rendering is shared.
  async function askBrowserModel(text: string) {
    if (!plan || agentBusy || !text.trim()) return;
    setAgentBusy(true);
    const id = String(Date.now());
    const turn: AgentTurn = { id: `${id}-a`, role: 'assistant', text: '', steps: [] };
    setThread((current) => [...current, { id: `${id}-u`, role: 'user', text, steps: [] }, turn]);
    const patchTurn = (change: (t: AgentTurn) => AgentTurn) =>
      setThread((current) => current.map((t) => (t.id === turn.id ? change(t) : t)));
    const controller = new AbortController();
    const budget = window.setTimeout(() => controller.abort('timeout'), 180_000);
    try {
      const { runBrowserAgent } = await import('./browser-agent');
      await runBrowserAgent({
        plan,
        message: text,
        history: thread
          .filter((t) => t.text)
          .slice(-8)
          .map((t) => ({ role: t.role, text: t.text })),
        apiKey: byokKey,
        model: byokModel,
        signal: controller.signal,
        emit: (event) => {
          if (event.type === 'text') patchTurn((t) => ({ ...t, text: t.text + event.delta }));
          if (event.type === 'reasoning')
            patchTurn((t) => ({ ...t, reasoning: (t.reasoning ?? '') + event.delta }));
          if (event.type === 'tool')
            patchTurn((t) => ({
              ...t,
              steps: [...t.steps, { name: event.name, input: event.input, output: event.output }],
            }));
          if (event.type === 'proposal')
            patchTurn((t) => ({
              ...t,
              patch: describeModelPatch(
                { summary: '', before: '', after: '', ...event.proposal } as PlanPatch,
                planRef.current ?? plan,
              ),
            }));
          if (event.type === 'error')
            patchTurn((t) => ({
              ...t,
              text:
                t.text ||
                (event.error === 'model_auth_failed'
                  ? 'OpenRouter rejected the key — check it under Connect a model.'
                  : `The model could not complete this: ${event.error}.`),
            }));
        },
      });
    } catch (cause) {
      patchTurn((t) => ({
        ...t,
        text:
          t.text ||
          (cause instanceof Error && cause.name === 'AbortError'
            ? 'The model timed out.'
            : 'Could not reach OpenRouter from the browser.'),
      }));
    } finally {
      window.clearTimeout(budget);
      setAgentBusy(false);
    }
  }

  const dispatchAgent = (text: string) => {
    if (byokKey.trim()) return void askBrowserModel(text);
    if (workerToken.trim()) return void askModel(text);
    return askAgent(text);
  };

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

  function toggleOverlayEdit() {
    if (!plan) return;
    if (overlayEdit) {
      setOverlayEdit(false);
      setSelectedOverlay(null);
      return;
    }
    let frame = playerRef.current?.getCurrentFrame() ?? 0;
    if (overlaysAtFrame(plan, frame).length === 0) {
      frame = overlayClips(plan)[0]?.timelineRange.startFrame ?? 0;
      playerRef.current?.seekTo(frame);
    }
    playerRef.current?.pause();
    setEditFrame(frame);
    setOverlayEdit(true);
  }

  function commitOverlayGeometry(overlayId: string) {
    const node = overlayNodeRefs.current[overlayId];
    const wrap = previewWrapRef.current;
    const current = planRef.current;
    if (!node || !wrap || !current) return;
    const wrapRect = wrap.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    node.style.transform = '';
    pushPlan(
      withOverlayBox(current, overlayId, {
        x: (rect.left - wrapRect.left) / wrapRect.width,
        y: (rect.top - wrapRect.top) / wrapRect.height,
        width: rect.width / wrapRect.width,
      }),
    );
  }

  function reorderClips(event: DragEndEvent) {
    const current = planRef.current;
    if (!current || !event.over || event.active.id === event.over.id) return;
    const ids = videoClips(current).map((c) => c.id);
    const from = ids.indexOf(String(event.active.id));
    const to = ids.indexOf(String(event.over.id));
    if (from < 0 || to < 0) return;
    pushPlan(withClipOrder(current, from, to));
  }

  const activeOverlays = plan && overlayEdit ? overlaysAtFrame(plan, editFrame) : [];
  const selectedNode = selectedOverlay ? overlayNodeRefs.current[selectedOverlay] : null;
  const selectedClip = plan ? overlayClips(plan).find((c) => c.id === selectedOverlay) : undefined;
  const composition = useMemo(() => plan && <PlanComposition plan={plan} />, [plan]);
  return (
    <main
      className="stitch-studio-shell mx-auto min-h-svh max-w-7xl space-y-4 p-4 pb-32 sm:p-6 lg:pb-6"
      data-testid="stitch-studio"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            NodeVideo · Stitch studio
          </p>
          <h1 className="font-heading text-2xl font-semibold sm:text-3xl">
            Edit the Sign cut, on the beat.
          </h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant="outline">
            {plan ? `${plan.beatGrid.bpm.toFixed(1)} bpm` : 'loading plan'}
          </Badge>
          <Button disabled={history.length === 0} onClick={undo} size="sm" variant="outline">
            Undo last patch
          </Button>
          <Button
            aria-describedby="browser-export-boundary"
            disabled={!plan || browserExport.status === 'running'}
            onClick={() => void startBrowserExport()}
            size="sm"
            type="button"
          >
            <Download aria-hidden="true" />
            {browserExport.status === 'running' ? 'Exporting…' : 'Export silent MP4'}
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p id="browser-export-boundary">
          Local H.264 export matches this accepted cut; the private song master is omitted.
        </p>
        <p>Nothing uploads.</p>
      </div>

      {browserExport.status !== 'idle' && (
        <section
          aria-live="polite"
          className="rounded-xl border border-border bg-card px-3 py-2"
          data-testid="browser-export-status"
        >
          {browserExport.status === 'running' ? (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span>{exportPhaseLabel(browserExport.phase)}</span>
                  <span className="font-mono">{Math.round(browserExport.ratio * 100)}%</span>
                </div>
                <Progress
                  aria-label="MP4 export progress"
                  aria-valuenow={Math.round(browserExport.ratio * 100)}
                  value={Math.round(browserExport.ratio * 100)}
                />
              </div>
              <Button
                aria-label="Cancel MP4 export"
                onClick={cancelBrowserExport}
                size="icon-sm"
                type="button"
                variant="outline"
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className={browserExport.status === 'error' ? 'text-destructive' : ''}>
                {browserExport.message}
                {browserExport.status === 'ready' && browserExport.bytes
                  ? ` ${formatFileSize(browserExport.bytes)} · ${
                      browserExport.coreKind === 'multi-thread' ? 'multi-core' : 'single-core'
                    } local encode.`
                  : ''}
              </p>
              {browserExport.status === 'ready' && browserExport.url && (
                <Button asChild size="sm" variant="outline">
                  <a download={browserExport.fileName} href={browserExport.url}>
                    <Download aria-hidden="true" /> Download again
                  </a>
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.55fr)_minmax(0,0.45fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Deterministic preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {plan && composition ? (
              <>
                <div
                  className={`relative mx-auto ${overlayEdit ? 'max-w-105' : 'max-w-70'}`}
                  data-testid="plan-preview"
                  ref={planPreviewRef}
                >
                  <Player
                    acknowledgeRemotionLicense
                    component={PlanComposition}
                    compositionHeight={plan.canvas.height}
                    compositionWidth={plan.canvas.width}
                    controls={!overlayEdit}
                    durationInFrames={plan.durationFrames}
                    fps={plan.frameRate}
                    inputProps={{ plan }}
                    ref={playerRef}
                    style={{ width: '100%', aspectRatio: '9 / 16' }}
                  />
                  {overlayEdit && (
                    <div className="absolute inset-0" ref={previewWrapRef}>
                      {activeOverlays.map((overlay) => (
                        <div
                          data-testid="overlay-box"
                          key={overlay.id}
                          onPointerDown={() => setSelectedOverlay(overlay.id)}
                          ref={(node) => {
                            overlayNodeRefs.current[overlay.id] = node;
                          }}
                          style={{
                            position: 'absolute',
                            left: `${(overlay.box?.x ?? 0.1) * 100}%`,
                            top: `${(overlay.box?.y ?? 0.8) * 100}%`,
                            width: `${(overlay.box?.width ?? 0.8) * 100}%`,
                            textAlign: 'center',
                            color: 'white',
                            fontWeight: 700,
                            fontSize: `${42 * ((previewWrapRef.current?.clientWidth ?? 420) / (plan.canvas.width || 720))}px`,
                            textShadow: '0 2px 12px rgba(0,0,0,0.8)',
                            cursor: 'move',
                            outline:
                              selectedOverlay === overlay.id
                                ? '1px dashed rgba(207,255,74,0.9)'
                                : '1px dashed rgba(238,240,232,0.35)',
                          }}
                        >
                          {overlay.text}
                        </div>
                      ))}
                      {selectedNode && (
                        <Moveable
                          draggable
                          onDrag={(e) => {
                            e.target.style.transform = e.transform;
                          }}
                          onDragEnd={() =>
                            selectedOverlay && commitOverlayGeometry(selectedOverlay)
                          }
                          onResize={(e) => {
                            e.target.style.width = `${e.width}px`;
                            e.target.style.transform = e.transform;
                          }}
                          onResizeEnd={() =>
                            selectedOverlay && commitOverlayGeometry(selectedOverlay)
                          }
                          renderDirections={['w', 'e']}
                          resizable
                          target={selectedNode}
                        />
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    aria-pressed={overlayEdit}
                    onClick={toggleOverlayEdit}
                    size="sm"
                    type="button"
                    variant={overlayEdit ? 'default' : 'outline'}
                  >
                    {overlayEdit ? 'Done editing overlays' : 'Edit overlays'}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {overlayEdit
                      ? 'Drag or resize the lyric on the paused frame; edits apply instantly and undo works.'
                      : 'Live render of the two takes — music and final grading land in the studio render.'}
                  </span>
                </div>
                {overlayEdit && selectedClip && (
                  <Field>
                    <FieldLabel htmlFor="overlay-text">Overlay text</FieldLabel>
                    <Input
                      id="overlay-text"
                      key={selectedClip.id}
                      defaultValue={selectedClip.text}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && plan && selectedOverlay) {
                          pushPlan(
                            withOverlayText(plan, selectedOverlay, event.currentTarget.value),
                          );
                        }
                      }}
                    />
                  </Field>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Loading the frozen edit plan…</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Edit agent
              <Badge variant={modelConnected ? 'default' : 'outline'}>
                {modelMode === 'browser'
                  ? 'Model in browser'
                  : modelMode === 'worker'
                    ? 'Model via worker'
                    : 'Local rules'}
              </Badge>
            </CardTitle>
            <CardDescription>
              {modelMode === 'browser'
                ? 'A real model runs in this tab against OpenRouter with your session key. Every tool call is a patch card; nothing changes until you apply it.'
                : modelMode === 'worker'
                  ? 'Streams a real model from your local worker. Every tool call lands as a patch card; nothing changes until you apply it.'
                  : 'Rule-grounded and local — every step is a real operation on the plan in this tab; patches change the timeline only when you accept them. No cloud model.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <details className="rounded-lg border border-border p-2 text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                Connect a model — key stays in this browser ({maskKey(byokKey)})
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="byok-key">OpenRouter API key</FieldLabel>
                  <Input
                    autoComplete="off"
                    id="byok-key"
                    onChange={(event) => setByokKey(event.target.value)}
                    placeholder="sk-or-..."
                    type="password"
                    value={byokKey}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="byok-model">Model</FieldLabel>
                  <Input
                    id="byok-model"
                    onChange={(event) => setByokModel(event.target.value)}
                    placeholder={DEFAULT_MODEL}
                    value={byokModel}
                  />
                </Field>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Session-only: the key lives in this tab, is sent only to OpenRouter directly from
                your browser, and never reaches a NodeVideo server. It clears when you close the
                tab. No key → the panel uses the local rule agent.
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Or use a local worker instead
                </summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="worker-endpoint">Worker endpoint</FieldLabel>
                    <Input
                      id="worker-endpoint"
                      onChange={(event) => setWorkerEndpoint(event.target.value)}
                      value={workerEndpoint}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="worker-token">Worker token</FieldLabel>
                    <Input
                      id="worker-token"
                      onChange={(event) => setWorkerToken(event.target.value)}
                      placeholder="Printed when the worker starts"
                      value={workerToken}
                    />
                  </Field>
                </div>
              </details>
            </details>
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
                  <Suggestion key={s} onClick={() => dispatchAgent(s)} suggestion={s} />
                ))}
              </Suggestions>
            )}
            {/* On phones the ask bar pins to the bottom edge — always under
                the thumb, CapCut-style; the page bottom padding keeps content
                clear of it. */}
            <div className="thumb-agent-bar max-lg:fixed max-lg:inset-x-3 max-lg:z-40 max-lg:rounded-xl max-lg:border max-lg:border-border max-lg:bg-background/95 max-lg:shadow-lg max-lg:backdrop-blur">
              <PromptInput onSubmit={({ text }) => dispatchAgent(text ?? '')}>
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
            </div>
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
        <CardContent className="space-y-3">
          {plan && (
            <fieldset
              aria-label="Clip order"
              className="flex flex-wrap items-center gap-2 border-0 p-0"
            >
              <DndContext
                collisionDetection={closestCenter}
                onDragEnd={reorderClips}
                sensors={dndSensors}
              >
                <SortableContext
                  items={videoClips(plan).map((c) => c.id)}
                  strategy={horizontalListSortingStrategy}
                >
                  {videoClips(plan).map((clip, index) => (
                    <ClipChip
                      clip={clip}
                      index={index}
                      key={clip.id}
                      onSeek={seekToFrame}
                      plan={plan}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              <span className="text-xs text-muted-foreground">
                drag a chip (or Space + arrows) to reorder the cuts
              </span>
            </fieldset>
          )}
          <div aria-label="Beat-aligned edit timeline" ref={waveRef} role="region" />
        </CardContent>
      </Card>

      <footer className="text-xs text-muted-foreground">
        The browser MP4 is a silent convenience export from the accepted plan. The rights-cleared,
        hash-verified master remains the studio pipeline's job. Media never leaves this tab.
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
