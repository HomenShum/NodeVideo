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
import { Card, CardContent } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import type { BrowserFfmpegProgress } from '@/lib/browser-ffmpeg';
import { NODE_AGENT_LIMITS } from '@/lib/nodeagent-contract';
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
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Copy,
  Download,
  RefreshCw,
  Scissors,
  Trash2,
  X,
} from 'lucide-react';
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
import { EDIT_ASSET_URLS, PlanComposition, overlayFontSize } from './plan-composition';
import {
  MAX_SOURCE_CLIPS,
  deleteClipRipple,
  duplicateClipRipple,
  moveOverlay,
  splitClipOnNearestBeat,
  splitClip as splitPlanClip,
} from './plan-tools';
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
  kind:
    | 'swap-source'
    | 'nudge-boundary'
    | 'reorder-clips'
    | 'set-overlay-text'
    | 'set-overlay-box'
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
  box?: { x: number; y: number; width: number };
  summary: string;
  before: string;
  after: string;
  accepted?: boolean;
  dismissed?: boolean;
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
const MAX_VISIBLE_AGENT_TURNS = NODE_AGENT_LIMITS.maxHistoryTurns * 2;
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
  if (patch.kind === 'delete-clip') {
    if (typeof patch.clipIndex !== 'number') return plan;
    return (deleteClipRipple(plan, patch.clipIndex).plan as Plan | undefined) ?? plan;
  }
  if (patch.kind === 'duplicate-clip') {
    if (typeof patch.clipIndex !== 'number') return plan;
    return (duplicateClipRipple(plan, patch.clipIndex).plan as Plan | undefined) ?? plan;
  }
  if (patch.kind === 'split-clip') {
    if (typeof patch.clipIndex !== 'number' || typeof patch.atFrame !== 'number') return plan;
    return (splitPlanClip(plan, patch.clipIndex, patch.atFrame).plan as Plan | undefined) ?? plan;
  }
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
  if (patch.kind === 'set-overlay-box') {
    return patch.overlayId && patch.box ? withOverlayBox(plan, patch.overlayId, patch.box) : plan;
  }
  if (patch.kind === 'move-overlay') {
    if (!patch.overlayId || typeof patch.beats !== 'number') return plan;
    return (moveOverlay(plan, patch.overlayId, patch.beats).plan as Plan | undefined) ?? plan;
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
  agentLabel,
  clip,
  index,
  plan,
  onSeek,
  onSelect,
  selected,
}: {
  agentLabel?: string;
  clip: Required<SourceClip>;
  index: number;
  plan: Plan;
  onSeek: (frame: number) => void;
  onSelect: (index: number) => void;
  selected: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: clip.id,
  });
  const seconds = (frame: number) => (frame / plan.frameRate).toFixed(1);
  const lane = clip.assetId === 'asset.take-a' ? 'A' : 'B';
  const endFrame = Math.max(
    1,
    ...videoClips(plan).map((item) => item.timelineRange.endFrameExclusive),
  );
  const width =
    ((clip.timelineRange.endFrameExclusive - clip.timelineRange.startFrame) / endFrame) * 100;
  const agentDescriptionId = agentLabel ? `clip-agent-label-${clip.id}` : undefined;
  const describedBy = [attributes['aria-describedby'], agentDescriptionId]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      aria-label={`Current clip ${index} take ${lane}`}
      onClick={() => {
        onSelect(index);
        onSeek(clip.timelineRange.startFrame);
      }}
      className={`timeline-clip-button inline-flex shrink-0 items-center gap-1.5 border px-2.5 py-1.5 font-mono text-xs ${
        lane === 'A'
          ? 'border-brand/60 bg-brand/10 text-foreground'
          : 'border-border bg-card text-muted-foreground'
      } ${selected ? 'ring-2 ring-brand/70 ring-offset-2 ring-offset-background' : ''} ${isDragging ? 'opacity-60' : ''}`}
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        flexBasis: `calc(${width}% - 3px)`,
      }}
      type="button"
      {...attributes}
      {...listeners}
      aria-describedby={describedBy || undefined}
      aria-pressed={selected}
    >
      <span className="font-semibold">{lane}</span>
      <span>
        {seconds(clip.timelineRange.startFrame)}–{seconds(clip.timelineRange.endFrameExclusive)}s
      </span>
      {agentLabel && (
        <em className="accepted-agent-label" id={agentDescriptionId}>
          {agentLabel}
        </em>
      )}
    </button>
  );
}

function proposalChangeRole(
  clip: Required<SourceClip>,
  index: number,
  patch: PlanPatch | undefined,
  basePlan: Plan | undefined,
) {
  if (!patch || !basePlan || typeof patch.clipIndex !== 'number') return null;
  const baseClips = videoClips(basePlan);
  if (patch.kind === 'duplicate-clip') {
    if (clip.id === baseClips[patch.clipIndex]?.id) return 'SOURCE';
    if (!baseClips.some((baseClip) => baseClip.id === clip.id)) return '+ COPY';
  }
  if (
    patch.kind === 'delete-clip' &&
    index === patch.clipIndex &&
    clip.id === baseClips[patch.clipIndex + 1]?.id
  )
    return 'SHIFT LEFT';
  return null;
}

function AgentChangeMap({
  basePlan,
  patch,
  proposedPlan,
}: {
  basePlan: Plan;
  patch: PlanPatch;
  proposedPlan: Plan;
}) {
  if (patch.kind === 'move-overlay' && patch.overlayId) {
    const before = overlayClips(basePlan).find((clip) => clip.id === patch.overlayId);
    const after = overlayClips(proposedPlan).find((clip) => clip.id === patch.overlayId);
    if (!before || !after) return null;
    const time = (frame: number) => `${(frame / basePlan.frameRate).toFixed(1)}s`;
    return (
      <fieldset aria-label="Agent caption change map" className="agent-change-map">
        <span className="agent-change-block overlay-block">
          {before.text} · {time(before.timelineRange.startFrame)}
        </span>
        <span aria-hidden="true" className="agent-change-arrow">
          →
        </span>
        <span className="agent-change-block overlay-block is-shifted">
          {after.text} · {time(after.timelineRange.startFrame)}
        </span>
        <strong>
          {(patch.beats ?? 0) > 0 ? 'LATER' : 'EARLIER'} {Math.abs(patch.beats ?? 0)} BEAT
          {Math.abs(patch.beats ?? 0) === 1 ? '' : 'S'}
        </strong>
      </fieldset>
    );
  }
  if (
    (patch.kind !== 'duplicate-clip' && patch.kind !== 'delete-clip') ||
    typeof patch.clipIndex !== 'number'
  )
    return null;
  const source = videoClips(basePlan)[patch.clipIndex];
  if (!source) return null;
  const durationSeconds =
    (source.timelineRange.endFrameExclusive - source.timelineRange.startFrame) / basePlan.frameRate;
  const sourceLane = source.assetId === 'asset.take-a' ? 'A' : 'B';
  const shifted = videoClips(proposedPlan)[patch.clipIndex];
  const shiftedLane = shifted?.assetId === 'asset.take-a' ? 'A' : 'B';
  const duplicate = patch.kind === 'duplicate-clip';

  return (
    <fieldset aria-label="Agent change map" className="agent-change-map">
      <span className={`agent-change-block take-${sourceLane.toLowerCase()}`}>
        {sourceLane} #{patch.clipIndex} · {duplicate ? 'SOURCE' : '− REMOVE'}
      </span>
      <span aria-hidden="true" className="agent-change-arrow">
        →
      </span>
      <span
        className={`agent-change-block ${duplicate ? 'is-added' : 'is-shifted'} take-${
          duplicate ? sourceLane.toLowerCase() : shiftedLane.toLowerCase()
        }`}
      >
        {duplicate
          ? `${sourceLane} #${patch.clipIndex + 1} · + COPY`
          : shifted
            ? `${shiftedLane} #${patch.clipIndex} · SHIFT LEFT`
            : 'TAIL · CLOSE GAP'}
      </span>
      <strong>
        {duplicate ? '+' : '−'}
        {durationSeconds.toFixed(1)}s
      </strong>
    </fieldset>
  );
}

function OverlayTimelineLane({
  label,
  onSelect,
  patch,
  plan,
  proposal = false,
  selectedId,
}: {
  label: string;
  onSelect?: (overlayId: string) => void;
  patch?: PlanPatch;
  plan: Plan;
  proposal?: boolean;
  selectedId?: string | null;
}) {
  const clips = [...overlayClips(plan)].sort(
    (left, right) => left.timelineRange.startFrame - right.timelineRange.startFrame,
  );
  const rowEnds: number[] = [];
  const rows = new Map<string, number>();
  for (const clip of clips) {
    const row = rowEnds.findIndex((end) => end <= clip.timelineRange.startFrame);
    const target = row < 0 ? rowEnds.length : row;
    rows.set(clip.id, target);
    rowEnds[target] = clip.timelineRange.endFrameExclusive;
  }
  const trackHeight = Math.max(30, rowEnds.length * 27 + 3);
  return (
    <div className={`plan-lane overlay-plan-lane ${proposal ? 'is-proposal' : ''}`}>
      <div className="plan-lane-label">
        <strong>{label}</strong>
        <span>{clips.length} timed captions</span>
      </div>
      <fieldset
        aria-label={`${label} captions`}
        className="plan-lane-track overlay-lane-track"
        style={{ height: trackHeight }}
      >
        {clips.map((clip, index) => {
          const start = (clip.timelineRange.startFrame / plan.durationFrames) * 100;
          const width =
            ((clip.timelineRange.endFrameExclusive - clip.timelineRange.startFrame) /
              plan.durationFrames) *
            100;
          const changed = patch?.kind === 'move-overlay' && patch.overlayId === clip.id;
          const agentDescriptionId =
            changed && !proposal ? `overlay-agent-label-${clip.id}` : undefined;
          const className = `plan-lane-clip overlay-lane-clip ${changed ? 'is-changed' : ''} ${selectedId === clip.id ? 'is-selected' : ''}`;
          const content = [
            <b key="index">#{index + 1}</b>,
            <span key="text">{clip.text}</span>,
            changed ? (
              <em
                className={proposal ? 'proposal-change-role' : 'accepted-agent-label'}
                id={agentDescriptionId}
                key="change-role"
              >
                AI MOVED
              </em>
            ) : null,
          ];
          const style = {
            left: `${start}%`,
            top: `${3 + (rows.get(clip.id) ?? 0) * 27}px`,
            width: `${width}%`,
          };
          const ariaLabel = `${proposal ? 'Proposal' : 'Current'} caption ${index + 1}: ${clip.text}, ${(clip.timelineRange.startFrame / plan.frameRate).toFixed(1)} to ${(clip.timelineRange.endFrameExclusive / plan.frameRate).toFixed(1)} seconds${changed ? ', changed' : ''}`;
          return onSelect ? (
            <button
              aria-label={ariaLabel}
              aria-describedby={agentDescriptionId}
              aria-pressed={selectedId === clip.id}
              className={className}
              key={clip.id}
              onClick={() => onSelect(clip.id)}
              style={style}
              type="button"
            >
              {content}
            </button>
          ) : (
            <span aria-label={ariaLabel} className={className} key={clip.id} style={style}>
              {content}
            </span>
          );
        })}
        <span className="plan-lane-playhead" />
      </fieldset>
    </div>
  );
}

function TimelinePlanRow({
  basePlan,
  label,
  plan,
  patch,
  proposal = false,
}: {
  basePlan?: Plan;
  label: string;
  plan: Plan;
  patch?: PlanPatch;
  proposal?: boolean;
}) {
  const clips = videoClips(plan);
  const endFrame = Math.max(1, ...clips.map((clip) => clip.timelineRange.endFrameExclusive));
  const isChanged = (index: number) =>
    patch?.kind === 'delete-clip'
      ? patch.clipIndex === index
      : patch?.kind === 'duplicate-clip'
        ? patch.clipIndex === index || patch.clipIndex === index - 1
        : patch?.kind === 'split-clip'
          ? patch.clipIndex === index || patch.clipIndex === index - 1
          : patch?.kind === 'swap-source'
            ? patch.clipIndex === index
            : patch?.kind === 'nudge-boundary'
              ? patch.clipIndex === index || patch.clipIndex === index - 1
              : patch?.kind === 'reorder-clips'
                ? patch.fromIndex === index || patch.toIndex === index
                : false;

  return (
    <div className={`plan-lane ${proposal ? 'is-proposal' : ''}`}>
      <div className="plan-lane-label">
        <strong>{label}</strong>
        <span>{proposal ? 'AI · pending' : 'Human · accepted'}</span>
      </div>
      <fieldset aria-label={`${label} timeline`} className="plan-lane-track">
        {clips.map((clip, index) => {
          const lane = clip.assetId === 'asset.take-a' ? 'A' : 'B';
          const start = (clip.timelineRange.startFrame / endFrame) * 100;
          const width =
            ((clip.timelineRange.endFrameExclusive - clip.timelineRange.startFrame) / endFrame) *
            100;
          const changed = isChanged(index);
          const changeRole = proposalChangeRole(clip, index, patch, basePlan);
          return (
            <span
              aria-label={`${proposal ? 'Proposal' : 'Current'} clip ${index} take ${lane}${changed ? ' changed' : ''}${changeRole ? ` · ${changeRole}` : ''}`}
              className={`plan-lane-clip take-${lane.toLowerCase()} ${changed ? 'is-changed' : ''}`}
              key={clip.id}
              style={{ left: `${start}%`, width: `${width}%` }}
            >
              <b>{lane}</b>
              <small>#{index}</small>
              {changed && <em className="proposal-change-role">{changeRole ?? 'AI'}</em>}
            </span>
          );
        })}
        <span className="plan-lane-playhead" />
      </fieldset>
    </div>
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
  const [selectedClipIndex, setSelectedClipIndex] = useState(0);
  const selectedClipIndexRef = useRef(0);
  const [lastTimelineAction, setLastTimelineAction] = useState<{
    actor: 'Human' | 'NodeAgent';
    patch: PlanPatch;
  } | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [mobileSurface, setMobileSurface] = useState<'canvas' | 'agent' | 'timeline'>('canvas');
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
      applyManualPatch({
        kind: 'nudge-boundary',
        clipIndex: index,
        beats: rounded,
        summary: `Human moved cut #${index} by ${rounded} beat${Math.abs(rounded) === 1 ? '' : 's'}`,
        before: `cut after clip #${index}`,
        after: `snapped ${Math.abs(rounded)} beat${Math.abs(rounded) === 1 ? '' : 's'} ${rounded > 0 ? 'later' : 'earlier'}`,
      });
    });
    return () => {
      surfer.destroy();
      surferRef.current = null;
    };
  }, [planLoaded]);
  useEffect(() => {
    if (mobileSurface !== 'timeline') return;
    const frame = window.requestAnimationFrame(() => surferRef.current?.setOptions({}));
    return () => window.cancelAnimationFrame(frame);
  }, [mobileSurface]);
  useEffect(() => {
    selectedClipIndexRef.current = selectedClipIndex;
  }, [selectedClipIndex]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      const timelineAvailable =
        window.matchMedia('(min-width: 1024px)').matches || mobileSurface === 'timeline';
      if (!timelineAvailable || !planRef.current) return;
      if (selectedOverlay) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        runSelectedClipCommand('duplicate', selectedClipIndexRef.current);
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        runSelectedClipCommand('delete', selectedClipIndexRef.current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileSurface, selectedOverlay]);

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

  function applyManualPatch(patch: PlanPatch) {
    const current = planRef.current;
    if (!current) return false;
    const next = applyPatch(current, patch);
    if (next === current) {
      setCommandError(
        patch.kind === 'set-overlay-text'
          ? 'Caption text is empty or unchanged, so the accepted Plan was not changed.'
          : patch.kind === 'set-overlay-box'
            ? 'Caption geometry was unchanged, so the accepted Plan was not changed.'
            : patch.kind === 'move-overlay'
              ? 'That caption move would leave the accepted timeline.'
              : 'That edit would collapse a clip below one beat, so the timeline was not changed.',
      );
      return false;
    }
    pushPlan(next);
    setCommandError(null);
    setLastTimelineAction({ actor: 'Human', patch });
    // A human edit changes the proposal baseline. Retire pending agent work
    // instead of applying it later against a timeline it never inspected.
    setThread((turns) =>
      turns.map((turn) =>
        turn.patch && !turn.patch.accepted && !turn.patch.dismissed
          ? { ...turn, patch: { ...turn.patch, dismissed: true } }
          : turn,
      ),
    );
    return true;
  }

  function appendAgentExchange(userTurn: AgentTurn, agentTurn: AgentTurn) {
    setThread((turns) => {
      const baseline = agentTurn.patch
        ? turns.map((turn) =>
            turn.patch && !turn.patch.accepted && !turn.patch.dismissed
              ? { ...turn, patch: { ...turn.patch, dismissed: true } }
              : turn,
          )
        : turns;
      return [...baseline, userTurn, agentTurn].slice(-MAX_VISIBLE_AGENT_TURNS);
    });
  }

  function updateAgentTurn(turnId: string, change: (turn: AgentTurn) => AgentTurn) {
    setThread((turns) => {
      let introducedProposal = false;
      const updated = turns.map((turn) => {
        if (turn.id !== turnId) return turn;
        const next = change(turn);
        introducedProposal = Boolean(next.patch && !turn.patch);
        return next;
      });
      if (!introducedProposal) return updated;
      return updated.map((turn) =>
        turn.id !== turnId && turn.patch && !turn.patch.accepted && !turn.patch.dismissed
          ? { ...turn, patch: { ...turn.patch, dismissed: true } }
          : turn,
      );
    });
  }

  function undo() {
    setHistory((h) => {
      const previous = h.at(-1);
      if (previous) {
        setPlan(previous);
        if (typeof lastTimelineAction?.patch.clipIndex === 'number')
          setSelectedClipIndex(lastTimelineAction.patch.clipIndex);
        else if (typeof lastTimelineAction?.patch.fromIndex === 'number')
          setSelectedClipIndex(lastTimelineAction.patch.fromIndex);
        else if (lastTimelineAction?.patch.overlayId) {
          setSelectedOverlay(lastTimelineAction.patch.overlayId);
          const restored = overlayClips(previous).find(
            (clip) => clip.id === lastTimelineAction.patch.overlayId,
          );
          if (restored) {
            playerRef.current?.seekTo(restored.timelineRange.startFrame);
            setEditFrame(restored.timelineRange.startFrame);
          }
        }
        setLastTimelineAction(null);
        setCommandError(null);
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
    if (patch.kind === 'split-clip')
      return {
        ...patch,
        summary: `Split clip #${patch.clipIndex} on the beat`,
        before: `clip #${patch.clipIndex} is one contiguous block`,
        after: `two source-contiguous blocks at ${((patch.atFrame ?? 0) / current.frameRate).toFixed(1)}s`,
      };
    if (patch.kind === 'duplicate-clip')
      return {
        ...patch,
        summary: `Duplicate clip #${patch.clipIndex} with a full timeline ripple`,
        before: `${clips.length} source blocks · ${(current.durationFrames / current.frameRate).toFixed(1)}s`,
        after: 'video, audio, overlays, and beat markers move together',
      };
    if (patch.kind === 'delete-clip')
      return {
        ...patch,
        summary: `Delete clip #${patch.clipIndex} with a full timeline ripple`,
        before: `${clips.length} source blocks · ${(current.durationFrames / current.frameRate).toFixed(1)}s`,
        after: 'selected interval removed across every timed track',
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
    if (patch.kind === 'move-overlay') {
      const overlay = overlayClips(current).find((clip) => clip.id === patch.overlayId);
      const direction = (patch.beats ?? 0) < 0 ? 'earlier' : 'later';
      return {
        ...patch,
        summary: `Move caption “${overlay?.text ?? patch.overlayId}” ${direction} by ${Math.abs(patch.beats ?? 0)} beat${Math.abs(patch.beats ?? 0) === 1 ? '' : 's'}`,
        before: `${((overlay?.timelineRange.startFrame ?? 0) / current.frameRate).toFixed(1)}s start`,
        after: `${direction} by ${Math.abs(((patch.beats ?? 0) * 60) / current.beatGrid.bpm).toFixed(2)}s`,
      };
    }
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
    appendAgentExchange({ id: `${id}-u`, role: 'user', text, steps: [] }, turn);
    const patchTurn = (change: (t: AgentTurn) => AgentTurn) => updateAgentTurn(turn.id, change);
    const controller = new AbortController();
    const idle = () => window.setTimeout(() => controller.abort('idle'), 30_000);
    let idleTimer = idle();
    const totalTimer = window.setTimeout(
      () => controller.abort('timeout'),
      NODE_AGENT_LIMITS.maxInteractiveRunMs,
    );
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
            .slice(-NODE_AGENT_LIMITS.maxHistoryTurns)
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
    appendAgentExchange({ id: `${id}-u`, role: 'user', text, steps: [] }, turn);
    const patchTurn = (change: (t: AgentTurn) => AgentTurn) => updateAgentTurn(turn.id, change);
    const controller = new AbortController();
    const budget = window.setTimeout(
      () => controller.abort('timeout'),
      NODE_AGENT_LIMITS.maxInteractiveRunMs,
    );
    try {
      const { runBrowserAgent } = await import('./browser-agent');
      await runBrowserAgent({
        plan,
        message: text,
        history: thread
          .filter((t) => t.text)
          .slice(-NODE_AGENT_LIMITS.maxHistoryTurns)
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
    const overlays = overlayClips(plan);
    const describe = (c: Required<SourceClip>, i: number) =>
      `#${i} ${c.assetId === 'asset.take-a' ? 'A' : 'B'} ${(c.timelineRange.startFrame / plan.frameRate).toFixed(1)}–${(c.timelineRange.endFrameExclusive / plan.frameRate).toFixed(1)}s`;
    const turn: AgentTurn = { id: `${id}-a`, role: 'assistant', text: '', steps: [] };

    const duplicate = text.match(/(?:duplicate|copy)\D*(\d+)/i);
    const remove = text.match(/(?:delete|remove)\D*(\d+)/i);
    const split = text.match(/split\D*(\d+)/i);
    const swap = text.match(/swap\D*(\d+)/i);
    const nudge = text.match(/(tighten|extend|nudge)\D*(\d+)\D*?(-?\d+)?\s*beat/i);
    const overlayMove = text.match(
      /(?:move\s+)?(?:caption|overlay)\D*(\d+).*?(earlier|later|back|forward)\D*(\d+)?\s*beat/i,
    );
    if (overlayMove && overlays[Number(overlayMove[1]) - 1]) {
      const overlay = overlays[Number(overlayMove[1]) - 1];
      const magnitude = Math.max(1, Number(overlayMove[3] ?? 1));
      const earlier = /earlier|back/i.test(overlayMove[2]);
      const beats = earlier ? -magnitude : magnitude;
      const result = moveOverlay(plan, overlay.id, beats);
      if (result.error) turn.text = result.error;
      else {
        turn.steps.push({
          name: 'move_overlay',
          input: { overlayId: overlay.id, beats },
          output: {
            priorRange: overlay.timelineRange,
            proposedRange: overlayClips(result.plan as Plan).find((clip) => clip.id === overlay.id)
              ?.timelineRange,
          },
        });
        turn.patch = {
          kind: 'move-overlay',
          overlayId: overlay.id,
          beats,
          summary: `Move caption #${overlayMove[1]} ${earlier ? 'earlier' : 'later'} by ${magnitude} beat${magnitude === 1 ? '' : 's'}`,
          before: `${(overlay.timelineRange.startFrame / plan.frameRate).toFixed(1)}s start · “${overlay.text}”`,
          after: `${earlier ? 'earlier' : 'later'} by ${Math.abs((beats * 60) / plan.beatGrid.bpm).toFixed(2)}s`,
        };
        turn.text = `This proposal moves caption #${overlayMove[1]} ${earlier ? 'earlier' : 'later'} on the shared beat grid. The accepted caption lane and Canvas stay unchanged until Apply.`;
      }
    } else if (duplicate && clips[Number(duplicate[1])]) {
      const index = Number(duplicate[1]);
      const result = duplicateClipRipple(plan, index);
      if (result.error) turn.text = result.error;
      else {
        turn.steps.push({
          name: 'duplicate_clip',
          input: { clipIndex: index },
          output: { ripple: ['video', 'audio', 'overlays', 'beat grid'] },
        });
        turn.patch = {
          kind: 'duplicate-clip',
          clipIndex: index,
          summary: `Duplicate clip #${index} with a full timeline ripple`,
          before: describe(clips[index], index),
          after: 'copied interval inserted across every timed track',
        };
        turn.text = `This proposal duplicates clip #${index} and the matching music, overlays, and beat interval. The accepted timeline stays unchanged until Apply.`;
      }
    } else if (remove && clips[Number(remove[1])]) {
      const index = Number(remove[1]);
      const result = deleteClipRipple(plan, index);
      if (result.error) turn.text = result.error;
      else {
        turn.steps.push({
          name: 'delete_clip',
          input: { clipIndex: index },
          output: { ripple: ['video', 'audio', 'overlays', 'beat grid'] },
        });
        turn.patch = {
          kind: 'delete-clip',
          clipIndex: index,
          summary: `Delete clip #${index} with a full timeline ripple`,
          before: describe(clips[index], index),
          after: 'interval removed across every timed track',
        };
        turn.text = `This proposal removes clip #${index} and closes the same interval across music, overlays, and beat markers. Review it on the timeline before Apply.`;
      }
    } else if (split && clips[Number(split[1])]) {
      const index = Number(split[1]);
      const clip = clips[index];
      const splitResult = splitClipOnNearestBeat(plan, index);
      const atFrame = splitResult.patch?.atFrame;
      if (typeof atFrame !== 'number') {
        turn.text = `Clip #${index} is too short to split while preserving one beat on each side.`;
      } else {
        turn.steps.push({
          name: 'split_clip',
          input: { clipIndex: index, atFrame },
          output: {
            splitSeconds: Number((atFrame / plan.frameRate).toFixed(2)),
            guard: 'at least one beat per side',
          },
        });
        turn.patch = {
          kind: 'split-clip',
          clipIndex: index,
          atFrame,
          summary: `Split clip #${index} on the beat`,
          before: describe(clip, index),
          after: `two contiguous ${clip.assetId === 'asset.take-a' ? 'A' : 'B'} blocks at ${(atFrame / plan.frameRate).toFixed(1)}s`,
        };
        turn.text = `The nearest safe beat inside clip #${index} is ${(atFrame / plan.frameRate).toFixed(1)}s. Review the two-block proposal on the timeline.`;
      }
    } else if (swap && clips[Number(swap[1])]) {
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
      turn.text = `${clips.length} cuts across the two takes at ${plan.beatGrid.bpm.toFixed(1)} bpm. Try "duplicate 2", "delete 2", "split 2", or "swap 2" — every accepted edit lands on the shared timeline.`;
    }
    appendAgentExchange({ id: `${id}-u`, role: 'user', text, steps: [] }, turn);
  }

  function acceptPatch(turnId: string) {
    const turn = thread.find((t) => t.id === turnId);
    if (!turn?.patch || turn.patch.accepted || turn.patch.dismissed || !plan) return;
    const next = applyPatch(plan, turn.patch);
    if (next === plan) {
      setCommandError(
        'The proposal is no longer valid for the accepted timeline. Ask NodeAgent again.',
      );
      return;
    }
    pushPlan(next);
    setCommandError(null);
    setLastTimelineAction({ actor: 'NodeAgent', patch: turn.patch });
    if (
      (turn.patch.kind === 'split-clip' || turn.patch.kind === 'duplicate-clip') &&
      typeof turn.patch.clipIndex === 'number'
    )
      setSelectedClipIndex(turn.patch.clipIndex + 1);
    if (turn.patch.kind === 'delete-clip' && typeof turn.patch.clipIndex === 'number')
      setSelectedClipIndex(Math.min(turn.patch.clipIndex, videoClips(next).length - 1));
    if (turn.patch.kind === 'move-overlay' && turn.patch.overlayId) {
      setSelectedOverlay(turn.patch.overlayId);
      setOverlayEdit(true);
      const moved = overlayClips(next).find((clip) => clip.id === turn.patch?.overlayId);
      if (moved) {
        playerRef.current?.seekTo(moved.timelineRange.startFrame);
        setEditFrame(moved.timelineRange.startFrame);
      }
    }
    setThread((current) =>
      current.map((t) =>
        t.id === turnId && t.patch ? { ...t, patch: { ...t.patch, accepted: true } } : t,
      ),
    );
  }

  function dismissPatch(turnId: string) {
    setThread((current) =>
      current.map((turn) =>
        turn.id === turnId && turn.patch && !turn.patch.accepted
          ? { ...turn, patch: { ...turn.patch, dismissed: true } }
          : turn,
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
    applyManualPatch({
      kind: 'set-overlay-box',
      overlayId,
      box: {
        x: (rect.left - wrapRect.left) / wrapRect.width,
        y: (rect.top - wrapRect.top) / wrapRect.height,
        width: rect.width / wrapRect.width,
      },
      summary: 'Human adjusted caption position',
      before: 'previous normalized caption box',
      after: 'new normalized caption box',
    });
  }

  function selectOverlayFromTimeline(overlayId: string) {
    const current = planRef.current;
    const overlay = current ? overlayClips(current).find((clip) => clip.id === overlayId) : null;
    if (!current || !overlay) return;
    playerRef.current?.pause();
    playerRef.current?.seekTo(overlay.timelineRange.startFrame);
    setEditFrame(overlay.timelineRange.startFrame);
    setSelectedOverlay(overlayId);
    setOverlayEdit(true);
    setCommandError(null);
  }

  function runSelectedOverlayCommand(beats: -1 | 1) {
    const current = planRef.current;
    if (!current || !selectedOverlay) return;
    const result = moveOverlay(current, selectedOverlay, beats);
    if (result.error) {
      setCommandError(result.error);
      return;
    }
    const overlay = overlayClips(current).find((clip) => clip.id === selectedOverlay);
    if (!overlay) return;
    const direction = beats < 0 ? 'earlier' : 'later';
    if (
      applyManualPatch({
        kind: 'move-overlay',
        overlayId: selectedOverlay,
        beats,
        summary: `Human moved caption “${overlay.text}” ${direction} by 1 beat`,
        before: `${(overlay.timelineRange.startFrame / current.frameRate).toFixed(1)}s start`,
        after: `${direction} by ${(60 / current.beatGrid.bpm).toFixed(2)}s`,
      })
    )
      selectOverlayFromTimeline(selectedOverlay);
  }

  function reorderClips(event: DragEndEvent) {
    const current = planRef.current;
    if (!current || !event.over || event.active.id === event.over.id) return;
    const ids = videoClips(current).map((c) => c.id);
    const from = ids.indexOf(String(event.active.id));
    const to = ids.indexOf(String(event.over.id));
    if (from < 0 || to < 0) return;
    applyManualPatch({
      kind: 'reorder-clips',
      fromIndex: from,
      toIndex: to,
      summary: `Human moved clip #${from} to position #${to}`,
      before: 'current clip order',
      after: 'timeline re-laid contiguously; sources unchanged',
    });
  }

  function runSelectedClipCommand(
    command: 'split' | 'swap' | 'trim-in' | 'trim-out' | 'duplicate' | 'delete',
    targetIndex = selectedClipIndex,
  ) {
    const current = planRef.current;
    const clip = current ? videoClips(current)[targetIndex] : undefined;
    if (!current || !clip) return;
    const lane = clip.assetId === 'asset.take-a' ? 'A' : 'B';
    let patch: PlanPatch;
    if (command === 'duplicate') {
      if (videoClips(current).length >= MAX_SOURCE_CLIPS) {
        setCommandError(`A cut cannot exceed ${MAX_SOURCE_CLIPS} source blocks.`);
        return;
      }
      patch = {
        kind: 'duplicate-clip',
        clipIndex: targetIndex,
        summary: `Human duplicated clip #${targetIndex} with a full timeline ripple`,
        before: `${videoClips(current).length} source blocks`,
        after: 'video, audio, overlays, and beat markers duplicated together',
      };
    } else if (command === 'delete') {
      if (videoClips(current).length <= 1) {
        setCommandError(
          'The last source clip cannot be deleted. Duplicate or import another first.',
        );
        return;
      }
      patch = {
        kind: 'delete-clip',
        clipIndex: targetIndex,
        summary: `Human deleted clip #${targetIndex} with a full timeline ripple`,
        before: `${videoClips(current).length} source blocks`,
        after: 'selected interval removed across every timed track',
      };
    } else if (command === 'split') {
      const splitResult = splitClipOnNearestBeat(current, targetIndex);
      const atFrame = splitResult.patch?.atFrame;
      if (typeof atFrame !== 'number') {
        setCommandError('This clip is too short to split while preserving one beat on each side.');
        return;
      }
      patch = {
        kind: 'split-clip',
        clipIndex: targetIndex,
        atFrame,
        summary: `Human split clip #${targetIndex} on the beat`,
        before: `one take ${lane} block`,
        after: `two contiguous blocks at ${(atFrame / current.frameRate).toFixed(1)}s`,
      };
    } else if (command === 'swap') {
      patch = {
        kind: 'swap-source',
        clipIndex: targetIndex,
        summary: `Human swapped clip #${targetIndex} to take ${lane === 'A' ? 'B' : 'A'}`,
        before: `take ${lane}`,
        after: `take ${lane === 'A' ? 'B' : 'A'} · timing preserved`,
      };
    } else {
      const trimIn = command === 'trim-in';
      patch = {
        kind: 'nudge-boundary',
        clipIndex: trimIn ? targetIndex - 1 : targetIndex,
        beats: trimIn ? 1 : -1,
        summary: `Human trimmed ${trimIn ? 'in' : 'out'} clip #${targetIndex} by 1 beat`,
        before: `clip #${targetIndex} boundary`,
        after: `${trimIn ? 'start later' : 'end earlier'} · neighbor absorbs 1 beat`,
      };
    }
    if (!applyManualPatch(patch)) return;
    if (command === 'split' || command === 'duplicate') setSelectedClipIndex(targetIndex + 1);
    if (command === 'delete')
      setSelectedClipIndex(Math.min(targetIndex, videoClips(current).length - 2));
  }

  const pendingAgentTurn = [...thread]
    .reverse()
    .find((turn) => turn.patch && !turn.patch.accepted && !turn.patch.dismissed);
  const proposedPlan =
    plan && pendingAgentTurn?.patch ? applyPatch(plan, pendingAgentTurn.patch) : null;
  const activeOverlays = plan && overlayEdit ? overlaysAtFrame(plan, editFrame) : [];
  const selectedNode = selectedOverlay ? overlayNodeRefs.current[selectedOverlay] : null;
  const selectedOverlayClip = plan
    ? overlayClips(plan).find((c) => c.id === selectedOverlay)
    : undefined;
  const selectedVideoClip = plan ? videoClips(plan)[selectedClipIndex] : undefined;
  const composition = useMemo(() => plan && <PlanComposition plan={plan} />, [plan]);
  const previewPlan = useMemo(() => {
    if (!plan || !overlayEdit) return plan;
    const next = structuredClone(plan);
    for (const track of next.tracks) if (track.kind === 'overlay') track.clips = [];
    return next;
  }, [overlayEdit, plan]);
  return (
    <main className="stitch-studio-shell" data-testid="stitch-studio">
      <header className="studio-project-bar">
        <div className="studio-project-identity">
          <span className="studio-wordmark">NodeVideo</span>
          <span aria-hidden="true">/</span>
          <h1>Sign · Cut v1</h1>
          <Badge variant="outline">Accepted</Badge>
        </div>
        <div className="studio-project-actions">
          <Badge variant="outline">
            {plan ? `${plan.beatGrid.bpm.toFixed(1)} bpm` : 'loading plan'}
          </Badge>
          <Button disabled={history.length === 0} onClick={undo} size="sm" variant="outline">
            Undo
          </Button>
          <span className="studio-local-state">Local only</span>
          <Button
            aria-describedby="browser-export-boundary"
            disabled={!plan || browserExport.status === 'running'}
            onClick={() => void startBrowserExport()}
            size="sm"
            type="button"
          >
            <Download aria-hidden="true" />
            {browserExport.status === 'running' ? 'Exporting…' : 'Export'}
          </Button>
        </div>
      </header>
      <p className="sr-only" id="browser-export-boundary">
        Local H.264 export matches this accepted cut; the private song master is omitted and nothing
        uploads.
      </p>

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

      <div className={`studio-layout mobile-${mobileSurface}`}>
        <Card className="studio-panel studio-preview-card" data-testid="canvas-surface">
          <CardContent className="studio-preview-content">
            <div className="studio-panel-heading">
              <span>Canvas</span>
              <Badge variant="outline">9:16</Badge>
            </div>
            {plan && composition ? (
              <>
                <div
                  className={`studio-player-shell ${overlayEdit ? 'is-editing' : ''}`}
                  data-duration-frames={plan.durationFrames}
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
                    inputProps={{ plan: previewPlan ?? plan }}
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
                            fontSize: `calc(${overlayFontSize(overlay, plan) / (plan.canvas.width || 720)} * 100cqw)`,
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
                <div className="studio-canvas-tools">
                  <Button
                    aria-pressed={overlayEdit}
                    onClick={toggleOverlayEdit}
                    size="sm"
                    type="button"
                    variant={overlayEdit ? 'default' : 'outline'}
                  >
                    {overlayEdit ? 'Done editing overlays' : 'Edit overlays'}
                  </Button>
                  {overlayEdit && <span>Drag or resize the selected text</span>}
                </div>
                {overlayEdit && selectedOverlayClip && (
                  <Field>
                    <FieldLabel htmlFor="overlay-text">Overlay text</FieldLabel>
                    <Input
                      id="overlay-text"
                      key={selectedOverlayClip.id}
                      defaultValue={selectedOverlayClip.text}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && plan && selectedOverlay) {
                          applyManualPatch({
                            kind: 'set-overlay-text',
                            overlayId: selectedOverlay,
                            text: event.currentTarget.value,
                            summary: 'Human rewrote caption text',
                            before: selectedOverlayClip.text ?? '',
                            after: event.currentTarget.value,
                          });
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

        <Card className="studio-panel studio-agent-card" data-testid="agent-surface">
          <CardContent className="studio-agent-content">
            <div className="studio-panel-heading">
              <span>NodeAgent</span>
              <Badge variant={modelConnected ? 'default' : 'outline'}>
                {modelMode === 'browser'
                  ? 'Browser model'
                  : modelMode === 'worker'
                    ? 'Worker model'
                    : 'Local'}
              </Badge>
            </div>
            {thread.length === 0 && (
              <Suggestions className="w-full flex-wrap">
                {['Show the cuts', 'Swap 2', 'Tighten 1 by 1 beat'].map((s) => (
                  <Suggestion key={s} onClick={() => dispatchAgent(s)} suggestion={s} />
                ))}
              </Suggestions>
            )}
            <div className="studio-agent-composer">
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
            {thread.length > 0 && (
              <details className="studio-disclosure studio-agent-history">
                <summary>
                  History · {thread.length} messages{pendingAgentTurn ? ' · proposal ready' : ''}
                </summary>
                <Conversation className="max-h-80">
                  <ConversationContent className="space-y-3">
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
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <Button
                                    disabled={turn.patch.accepted || turn.patch.dismissed}
                                    onClick={() => acceptPatch(turn.id)}
                                    size="sm"
                                    type="button"
                                  >
                                    {turn.patch.accepted
                                      ? 'Patch applied'
                                      : turn.patch.dismissed
                                        ? 'Proposal dismissed'
                                        : 'Apply patch'}
                                  </Button>
                                  {!turn.patch.accepted && !turn.patch.dismissed && (
                                    <Button
                                      onClick={() => dismissPatch(turn.id)}
                                      size="sm"
                                      type="button"
                                      variant="outline"
                                    >
                                      Dismiss proposal
                                    </Button>
                                  )}
                                </div>
                              </div>
                            )}
                          </MessageContent>
                        </Message>
                      ),
                    )}
                  </ConversationContent>
                </Conversation>
              </details>
            )}
            <details className="studio-disclosure studio-agent-settings">
              <summary>Agent settings · key {maskKey(byokKey)}</summary>
              <div className="studio-settings-grid">
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
                <details>
                  <summary>Local worker</summary>
                  <div className="studio-settings-grid">
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
              </div>
            </details>
          </CardContent>
        </Card>

        <Card className="studio-panel studio-timeline-card" data-testid="timeline-surface">
          <CardContent className="studio-timeline-content">
            <div className="studio-panel-heading">
              <span>Timeline</span>
              <span className="studio-timeline-help">Select · edit · drag</span>
            </div>
            {plan && (
              <div className="plan-lanes" data-testid="shared-plan-timeline">
                {selectedOverlayClip ? (
                  <div className="clip-command-bar" data-testid="selected-caption-command-bar">
                    <div className="clip-command-identity">
                      <strong>
                        Caption #
                        {overlayClips(plan).findIndex((clip) => clip.id === selectedOverlay) + 1}
                      </strong>
                      <span title={selectedOverlayClip.text}>{selectedOverlayClip.text}</span>
                    </div>
                    <div className="clip-command-actions">
                      <Button
                        aria-label="Move selected caption earlier by one beat"
                        onClick={() => runSelectedOverlayCommand(-1)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <ArrowLeftToLine aria-hidden="true" /> Earlier 1 beat
                      </Button>
                      <Button
                        aria-label="Move selected caption later by one beat"
                        onClick={() => runSelectedOverlayCommand(1)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <ArrowRightToLine aria-hidden="true" /> Later 1 beat
                      </Button>
                    </div>
                  </div>
                ) : (
                  selectedVideoClip && (
                    <div className="clip-command-bar" data-testid="selected-clip-command-bar">
                      <div className="clip-command-identity">
                        <strong>Clip #{selectedClipIndex}</strong>
                        <span>
                          Take {selectedVideoClip.assetId === 'asset.take-a' ? 'A' : 'B'} ·{' '}
                          {(
                            (selectedVideoClip.timelineRange.endFrameExclusive -
                              selectedVideoClip.timelineRange.startFrame) /
                            plan.frameRate
                          ).toFixed(1)}
                          s
                        </span>
                      </div>
                      <div className="clip-command-actions">
                        <Button
                          aria-label={`Split clip ${selectedClipIndex} on nearest beat`}
                          onClick={() => runSelectedClipCommand('split')}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <Scissors aria-hidden="true" /> Split
                        </Button>
                        <Button
                          aria-label={`Swap clip ${selectedClipIndex} to other take`}
                          onClick={() => runSelectedClipCommand('swap')}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <RefreshCw aria-hidden="true" /> Swap take
                        </Button>
                        <Button
                          aria-label={`Trim in clip ${selectedClipIndex} by one beat`}
                          disabled={selectedClipIndex === 0}
                          onClick={() => runSelectedClipCommand('trim-in')}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <ArrowRightToLine aria-hidden="true" /> Trim in
                        </Button>
                        <Button
                          aria-label={`Trim out clip ${selectedClipIndex} by one beat`}
                          disabled={selectedClipIndex === videoClips(plan).length - 1}
                          onClick={() => runSelectedClipCommand('trim-out')}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <ArrowLeftToLine aria-hidden="true" /> Trim out
                        </Button>
                        <Button
                          aria-label={`Duplicate clip ${selectedClipIndex}`}
                          disabled={videoClips(plan).length >= MAX_SOURCE_CLIPS}
                          onClick={() => runSelectedClipCommand('duplicate')}
                          size="sm"
                          title="Duplicate · Ctrl/⌘ D"
                          type="button"
                          variant="outline"
                        >
                          <Copy aria-hidden="true" /> Duplicate
                        </Button>
                        <Button
                          aria-label={`Delete clip ${selectedClipIndex}`}
                          className="clip-delete-command"
                          disabled={videoClips(plan).length <= 1}
                          onClick={() => runSelectedClipCommand('delete')}
                          size="sm"
                          title="Delete · Backspace"
                          type="button"
                          variant="outline"
                        >
                          <Trash2 aria-hidden="true" /> Delete
                        </Button>
                      </div>
                    </div>
                  )
                )}
                {commandError && (
                  <output className="timeline-command-error" role="alert">
                    {commandError}
                  </output>
                )}
                <div className="plan-lane">
                  <div className="plan-lane-label">
                    <strong>Current cut</strong>
                    <span>
                      {selectedOverlay
                        ? 'Caption selection active'
                        : `Clip #${selectedClipIndex} selected`}
                    </span>
                  </div>
                  <fieldset aria-label="Current cut timeline" className="manual-clip-track">
                    <DndContext
                      collisionDetection={closestCenter}
                      onDragEnd={reorderClips}
                      sensors={dndSensors}
                    >
                      <SortableContext
                        items={videoClips(plan).map((clip) => clip.id)}
                        strategy={horizontalListSortingStrategy}
                      >
                        {videoClips(plan).map((clip, index) => (
                          <ClipChip
                            agentLabel={
                              lastTimelineAction?.actor === 'NodeAgent' &&
                              typeof lastTimelineAction.patch.clipIndex === 'number' &&
                              ((lastTimelineAction.patch.kind === 'duplicate-clip' &&
                                index === lastTimelineAction.patch.clipIndex + 1 &&
                                'AI ADDED') ||
                                (lastTimelineAction.patch.kind === 'delete-clip' &&
                                  index ===
                                    Math.min(
                                      lastTimelineAction.patch.clipIndex,
                                      videoClips(plan).length - 1,
                                    ) &&
                                  'AI SHIFTED') ||
                                undefined)
                            }
                            clip={clip}
                            index={index}
                            key={clip.id}
                            onSeek={seekToFrame}
                            onSelect={(index) => {
                              setSelectedClipIndex(index);
                              setSelectedOverlay(null);
                              setOverlayEdit(false);
                              setCommandError(null);
                            }}
                            plan={plan}
                            selected={!selectedOverlay && selectedClipIndex === index}
                          />
                        ))}
                      </SortableContext>
                    </DndContext>
                  </fieldset>
                </div>
                <OverlayTimelineLane
                  label="Current captions"
                  onSelect={selectOverlayFromTimeline}
                  patch={
                    lastTimelineAction?.actor === 'NodeAgent' &&
                    lastTimelineAction.patch.kind === 'move-overlay'
                      ? lastTimelineAction.patch
                      : undefined
                  }
                  plan={plan}
                  selectedId={selectedOverlay}
                />
                {lastTimelineAction && (
                  <output className="timeline-edit-receipt">
                    <strong>{lastTimelineAction.actor}</strong> ·{' '}
                    {lastTimelineAction.patch.summary.replace(/^(Human|NodeAgent)\s+/u, '')}
                  </output>
                )}
                {proposedPlan && pendingAgentTurn?.patch && (
                  <div className="proposal-lane-wrap">
                    <div className="proposal-lane-heading">
                      <span>NodeAgent proposal</span>
                      <strong>{pendingAgentTurn.patch.summary}</strong>
                      <div>
                        <Button
                          onClick={() => acceptPatch(pendingAgentTurn.id)}
                          size="sm"
                          type="button"
                        >
                          Apply to timeline
                        </Button>
                        <Button
                          onClick={() => dismissPatch(pendingAgentTurn.id)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          Dismiss
                        </Button>
                      </div>
                    </div>
                    <AgentChangeMap
                      basePlan={plan}
                      patch={pendingAgentTurn.patch}
                      proposedPlan={proposedPlan}
                    />
                    {pendingAgentTurn.patch.kind === 'move-overlay' ? (
                      <OverlayTimelineLane
                        label="Agent caption proposal"
                        patch={pendingAgentTurn.patch}
                        plan={proposedPlan}
                        proposal
                        selectedId={pendingAgentTurn.patch.overlayId}
                      />
                    ) : (
                      <TimelinePlanRow
                        basePlan={plan}
                        label="Agent proposal"
                        patch={pendingAgentTurn.patch}
                        plan={proposedPlan}
                        proposal
                      />
                    )}
                  </div>
                )}
              </div>
            )}
            <div
              aria-label="Beat-aligned edit timeline"
              className="studio-waveform"
              ref={waveRef}
              role="region"
            />
          </CardContent>
        </Card>
      </div>

      <nav aria-label="Editor surfaces" className="studio-mobile-nav">
        {(['canvas', 'agent', 'timeline'] as const).map((surface) => (
          <button
            aria-pressed={mobileSurface === surface}
            className={mobileSurface === surface ? 'is-current' : ''}
            key={surface}
            onClick={() => setMobileSurface(surface)}
            type="button"
          >
            {surface === 'canvas' ? 'Canvas' : surface === 'agent' ? 'Agent' : 'Timeline'}
          </button>
        ))}
      </nav>
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
