import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { FounderVariant } from '@/lib/founder-variant-compiler';
import type { FramingPolicy, ReframePlan } from '@/lib/smart-reframe';
import { Player } from '@remotion/player';
import {
  Check,
  ChevronLeft,
  CircleDot,
  Film,
  FolderOpen,
  Library,
  MessageSquare,
  Play,
  Plus,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { CreatorAgentPanel } from './creator-agent-panel';
import type {
  ChatMessage,
  CreatorAgentReply,
  CreatorAgentRequest,
  ExecutorProposalView,
} from './creator-agent-panel';
import type { CreatorPreset, runCreatorPipeline } from './creator-pipeline';
import { PlanComposition } from './plan-composition';
import {
  CropPathOverlay,
  SmartReframeControls,
  type SmartReframeView,
} from './smart-reframe-controls';

type SourceView = { name: string; url: string; durationMs: number; width: number; height: number };
type CreatorResult = ReturnType<typeof runCreatorPipeline>;
type MobileSurface = 'canvas' | 'agent' | 'review' | 'sources';

const TEMPLATES: Array<{
  id: CreatorPreset;
  title: string;
  detail: string;
  request: string;
}> = [
  {
    id: 'cleanup',
    title: 'Clean interview',
    detail: 'Remove safe silence and review filler cuts',
    request:
      'Create a clean interview master. Remove only safe silence, flag filler cuts that may change meaning, preserve cadence, and keep source audio.',
  },
  {
    id: 'variants',
    title: 'Golden quote campaign',
    detail: '9:16, square, and long-form from one quote',
    request:
      'Find the strongest source-grounded quote and propose short, square, and long-form versions. Preserve meaning and show every cut before export.',
  },
  {
    id: 'founder',
    title: 'Founder launch story',
    detail: 'Hook, product evidence, and call to action',
    request:
      'Create a founder launch story with a clear hook, product evidence, and call to action. Produce landscape and vertical variants without copying brand assets.',
  },
  {
    id: 'reframe',
    title: 'Smart Reframe',
    detail: 'Follow a subject across 9:16, square, and landscape',
    request:
      'Make vertical, square, and landscape versions. Follow the selected person, keep the full body visible, hold through low-confidence ranges, and show the crop path before approval.',
  },
];

const STAGES = [
  ['intake', 'Source'],
  ['planning', 'Plan'],
  ['review', 'Edit'],
  ['execution', 'Review'],
  ['receipt', 'Export'],
] as const;

function currentAction(stage: string) {
  if (stage === 'intake') return 'Add source media, references, and destinations.';
  if (stage === 'planning') return 'Ask NodeAgent to propose a source-grounded direction.';
  if (stage === 'review') return 'Review exact timeline operations and approve the cut.';
  if (stage === 'execution') return 'Compare the accepted cut and choose execution.';
  return 'Export the accepted video and retain its proof.';
}

export function CreatorStart(props: {
  prompt: string;
  source: SourceView | null;
  preset: CreatorPreset;
  status: string;
  onPrompt: (value: string) => void;
  onPreset: (value: CreatorPreset) => void;
  onUpload: (file?: File) => void;
  onLoadDemo: () => void;
  onStart: () => void;
}) {
  return (
    <main className="creator-start min-h-screen bg-background">
      <header className="creator-topbar">
        <div className="creator-brand">
          <span>
            <Film className="size-4" />
          </span>
          <b>NodeVideo</b>
        </div>
        <Badge variant="outline">
          <ShieldCheck className="size-3" /> local by default
        </Badge>
      </header>
      <section className="creator-start-stage">
        <div className="creator-start-copy">
          <Badge variant="secondary">Create with NodeAgent</Badge>
          <h1>What are you trying to make?</h1>
          <p>
            Drop source media, describe the outcome, and review every edit before it becomes
            canonical.
          </p>
          <div className="creator-outcome-composer">
            <textarea
              aria-label="Describe the video you want"
              value={props.prompt}
              onChange={(event) => props.onPrompt(event.target.value)}
              rows={4}
            />
            <div className="creator-start-actions">
              <div className="flex flex-wrap gap-2">
                <label htmlFor="creator-start-source" className="creator-file-action">
                  <Upload className="size-4" /> Add media
                  <input
                    id="creator-start-source"
                    className="sr-only"
                    type="file"
                    accept="video/mp4,video/webm"
                    onChange={(event) => props.onUpload(event.target.files?.[0])}
                  />
                </label>
                <Button variant="secondary" onClick={props.onLoadDemo}>
                  Use rights-cleared demo
                </Button>
              </div>
              <Button
                size="lg"
                onClick={props.onStart}
                disabled={!props.source || !props.prompt.trim()}
              >
                Start creating <Play className="size-4" />
              </Button>
            </div>
          </div>
          <div className="creator-template-row" aria-label="Creation templates">
            {TEMPLATES.map((template) => (
              <button
                type="button"
                key={template.id}
                className={props.preset === template.id ? 'is-selected' : ''}
                onClick={() => {
                  props.onPreset(template.id);
                  props.onPrompt(template.request);
                }}
              >
                <b>{template.title}</b>
                <span>{template.detail}</span>
              </button>
            ))}
          </div>
          <p className="creator-start-status" aria-live="polite">
            {props.source ? `${props.source.name} · ready in this browser` : props.status}
          </p>
        </div>
      </section>
    </main>
  );
}

function Timeline({ variant, reframe }: { variant?: FounderVariant; reframe?: ReframePlan }) {
  if (!variant) {
    return (
      <div className="creator-timeline-empty">
        A reviewable timeline appears after NodeAgent plans the cut.
      </div>
    );
  }
  const { durationFrames, frameRate, tracks } = variant.rendererPlan;
  return (
    <div className="creator-timeline" data-testid="artifact-timeline">
      <div className="creator-time-ruler">
        <span>00:00</span>
        <span>{(durationFrames / frameRate).toFixed(1)}s</span>
      </div>
      {tracks.map((track) => (
        <div className="creator-track" key={track.id}>
          <div>
            <b>{track.role}</b>
            <span>{track.kind}</span>
          </div>
          <div className="creator-track-lane">
            {track.clips.map((clip) => {
              const left = (clip.timelineRange.startFrame / Math.max(1, durationFrames)) * 100;
              const width =
                ((clip.timelineRange.endFrameExclusive - clip.timelineRange.startFrame) /
                  Math.max(1, durationFrames)) *
                100;
              return (
                <button
                  type="button"
                  key={clip.id}
                  title={clip.id}
                  style={{ left: `${left}%`, width: `${Math.max(3, width)}%` }}
                >
                  {clip.kind}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {reframe && (
        <div className="creator-track smart-reframe-track">
          <div>
            <b>camera</b>
            <span>crop path</span>
          </div>
          <div className="creator-track-lane">
            {reframe.cropKeyframes.map((keyframe) => (
              <i
                key={keyframe.timelineFrame}
                className={
                  reframe.manualOverrides.some(
                    (item) => item.timelineFrame === keyframe.timelineFrame,
                  )
                    ? 'is-manual'
                    : ''
                }
                style={{ left: `${(keyframe.timelineFrame / Math.max(1, durationFrames)) * 100}%` }}
                title={`Crop keyframe ${keyframe.timelineFrame}`}
              />
            ))}
          </div>
        </div>
      )}
      <div className="creator-audio-route">
        <CircleDot className="size-3" /> source program · 0 dB · unmuted
      </div>
    </div>
  );
}

export function CreatorWorkspace(props: {
  source: SourceView | null;
  transcript: string;
  prompt: string;
  preset: CreatorPreset;
  result: CreatorResult | null;
  selected?: FounderVariant;
  approved: Set<string>;
  status: string;
  exportRatio: number;
  version: number;
  caseTitle: string;
  runStage: string;
  caseStatus: string;
  messages: ChatMessage[];
  caseflowReady: boolean;
  proposalDigest?: string;
  proposalStatus?: string;
  executorProposal?: ExecutorProposalView;
  smartReframe: SmartReframeView;
  assetUrls: Record<string, string>;
  onUpload: (file?: File) => void;
  onLoadDemo: () => void;
  onPreset: (preset: CreatorPreset) => void;
  onPrompt: (prompt: string) => void;
  onTranscript: (transcript: string) => void;
  onAgentSend: (message: string, request: CreatorAgentRequest) => Promise<CreatorAgentReply>;
  onSelectVariant: (id: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onRestore: () => void;
  onExport: () => void;
  onDownloadPlan: () => void;
  onDownloadReceipt: () => void;
  onApproveExecutor: () => void;
  onDeclineExecutor: () => void;
  onUseLocalExecutor: () => void;
  onAnalyzeSubjects: () => void;
  onSelectSubject: (id: string) => void;
  onReframePolicy: (policy: FramingPolicy) => void;
  onReframeMotion: (motion: ReframePlan['intent']['motionPreset']) => void;
  onPlanReframe: () => void;
  onManualCrop: (
    aspectRatio: string,
    box: { x: number; y: number; width: number; height: number },
    frame: number,
  ) => void;
}) {
  const [mobileSurface, setMobileSurface] = useState<MobileSurface>('canvas');
  const [editingCrop, setEditingCrop] = useState(false);
  const [editFrame, setEditFrame] = useState(0);
  const reframeVideoRef = useRef<HTMLVideoElement>(null);
  const stageIndex = Math.max(
    0,
    STAGES.findIndex(([stage]) => stage === props.runStage),
  );
  const canonical = props.approved.has(props.selected?.id ?? '');
  const selectedReframe = props.smartReframe.plans.find(
    (plan) => plan.intent.aspectRatio === props.selected?.output.aspectRatio,
  );
  const activeReframe = selectedReframe ?? props.smartReframe.plans[0];

  return (
    <main className="creator-shell bg-background">
      <header className="creator-topbar">
        <div className="creator-brand">
          <span>
            <Film className="size-4" />
          </span>
          <b>NodeVideo</b>
        </div>
        <nav className="creator-stage-progress" aria-label="Creation stages">
          {STAGES.map(([stage, label], index) => (
            <span
              key={stage}
              className={
                index === stageIndex ? 'is-current' : index < stageIndex ? 'is-complete' : ''
              }
            >
              {index < stageIndex ? <Check className="size-3" /> : index + 1} {label}
            </span>
          ))}
        </nav>
        <Badge variant="outline">Project v{props.version}</Badge>
      </header>

      <div className="creator-current-action" data-testid="current-action">
        <Sparkles className="size-4" />
        <b>Current action</b>
        <span>{currentAction(props.runStage)}</span>
      </div>

      <div className={`creator-workspace-grid mobile-${mobileSurface}`}>
        <aside className="creator-project-rail" aria-label="Project and sources">
          <div>
            <p className="creator-eyebrow">Campaign</p>
            <h1>{props.caseTitle}</h1>
            <p>{props.caseStatus}</p>
          </div>
          <div className="creator-project-steps" data-testid="caseflow-progress">
            {STAGES.map(([stage, label], index) => (
              <div
                key={stage}
                className={
                  index === stageIndex ? 'is-current' : index < stageIndex ? 'is-complete' : ''
                }
              >
                <span>{index < stageIndex ? <Check className="size-3" /> : index + 1}</span>
                <p>
                  <b>{label}</b>
                  <small>
                    {index === stageIndex
                      ? currentAction(props.runStage)
                      : index < stageIndex
                        ? 'Complete'
                        : 'Waiting'}
                  </small>
                </p>
              </div>
            ))}
          </div>
          <section className="creator-source-vault">
            <p className="creator-eyebrow">Source vault</p>
            {props.source ? (
              <div>
                <Film className="size-4" />
                <span>
                  <b>{props.source.name}</b>
                  <small>
                    {(props.source.durationMs / 1000).toFixed(1)}s · {props.source.width}×
                    {props.source.height} · local
                  </small>
                </span>
              </div>
            ) : (
              <p>No source attached.</p>
            )}
            <label htmlFor="creator-source">
              <Plus className="size-3" /> Replace source
              <input
                id="creator-source"
                className="sr-only"
                type="file"
                accept="video/mp4,video/webm"
                onChange={(event) => props.onUpload(event.target.files?.[0])}
              />
            </label>
          </section>
        </aside>

        <section
          className={`creator-artifact-stage ${props.preset === 'reframe' ? 'has-smart-reframe' : ''}`}
          aria-label="Artifact stage"
        >
          <div className="creator-artifact-header">
            <div>
              <p className="creator-eyebrow">Primary video artifact</p>
              <h2>{props.selected?.title ?? 'Planning first cut'}</h2>
              <span>
                canonical v{props.version}
                {canonical ? ' · accepted' : ' · proposal'}
              </span>
            </div>
            <div className="creator-variant-switcher" role="tablist" aria-label="Video variants">
              {props.result?.variants.map((variant) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={variant.id === props.selected?.id}
                  key={variant.id}
                  onClick={() => props.onSelectVariant(variant.id)}
                >
                  {variant.output.aspectRatio}
                  <small>{variant.title}</small>
                </button>
              )) ?? <Badge variant="outline">No variants yet</Badge>}
            </div>
          </div>
          {props.preset === 'reframe' && (
            <SmartReframeControls
              view={props.smartReframe}
              selectedAspectRatio={props.selected?.output.aspectRatio}
              editingCrop={editingCrop}
              onAnalyze={props.onAnalyzeSubjects}
              onSelectTrack={props.onSelectSubject}
              onPolicy={props.onReframePolicy}
              onMotion={props.onReframeMotion}
              onPlan={props.onPlanReframe}
              onToggleEdit={() => setEditingCrop((current) => !current)}
            />
          )}
          <div className="creator-video-canvas" data-testid="video-canvas">
            {props.source && props.selected && !editingCrop ? (
              <Player
                component={PlanComposition}
                inputProps={{ plan: props.selected.rendererPlan, assetUrls: props.assetUrls }}
                durationInFrames={props.selected.rendererPlan.durationFrames}
                compositionWidth={props.selected.rendererPlan.canvas.width}
                compositionHeight={props.selected.rendererPlan.canvas.height}
                fps={props.selected.rendererPlan.frameRate}
                controls
                acknowledgeRemotionLicense
                style={{ width: '100%', height: '100%' }}
              />
            ) : props.source && props.preset === 'reframe' ? (
              <div className="smart-reframe-source-preview">
                <video ref={reframeVideoRef} src={props.source.url} controls muted playsInline />
                <CropPathOverlay
                  plan={activeReframe}
                  frame={editFrame}
                  editable={editingCrop}
                  onCommit={(box, frame) =>
                    props.onManualCrop(activeReframe?.intent.aspectRatio ?? '9:16', box, frame)
                  }
                />
                {editingCrop && activeReframe && (
                  <label className="smart-crop-scrubber">
                    <span>Crop keyframe · frame {editFrame}</span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(
                        0,
                        (props.selected?.rendererPlan.durationFrames ??
                          Math.round((props.source?.durationMs ?? 1) * 0.03)) - 1,
                      )}
                      value={editFrame}
                      onChange={(event) => {
                        const frame = Number(event.target.value);
                        setEditFrame(frame);
                        if (reframeVideoRef.current)
                          reframeVideoRef.current.currentTime = frame / 30;
                      }}
                    />
                  </label>
                )}
              </div>
            ) : (
              <div className="creator-canvas-empty">
                <Play className="size-7" />
                <h3>Your first cut will live here</h3>
                <p>Ask NodeAgent to turn the source into a reviewable plan and timeline.</p>
              </div>
            )}
          </div>
          <Timeline variant={props.selected} reframe={selectedReframe} />
        </section>

        <div className="creator-agent-rail">
          <CreatorAgentPanel
            sourceName={props.source?.name}
            selected={props.selected}
            result={props.result}
            approved={props.approved}
            preset={props.preset}
            suggestedPrompt={props.prompt}
            transcript={props.transcript}
            exportRatio={props.exportRatio}
            messages={props.messages}
            caseflowReady={props.caseflowReady}
            runStatus={`${props.caseStatus} · ${props.runStage}`}
            proposalDigest={props.proposalDigest}
            proposalStatus={props.proposalStatus}
            executorProposal={props.executorProposal}
            onPreset={props.onPreset}
            onTranscript={props.onTranscript}
            onSend={props.onAgentSend}
            onApprove={props.onApprove}
            onReject={props.onReject}
            onRestore={props.onRestore}
            onExport={props.onExport}
            onDownloadPlan={props.onDownloadPlan}
            onDownloadReceipt={props.onDownloadReceipt}
            onApproveExecutor={props.onApproveExecutor}
            onDeclineExecutor={props.onDeclineExecutor}
            onUseLocalExecutor={props.onUseLocalExecutor}
            requestedView={mobileSurface === 'review' ? 'proposal' : 'chat'}
          />
        </div>
      </div>

      <div className="creator-run-strip" data-testid="caseflow-activity-strip">
        <span>
          <CircleDot className="size-3 text-brand" /> {props.status}
        </span>
        <span>
          canonical v{props.version} ·{' '}
          {props.proposalDigest ? `proposal ${props.proposalDigest.slice(0, 10)}…` : 'no proposal'}
        </span>
      </div>

      <nav className="creator-mobile-nav" aria-label="Creator workspace surfaces">
        {(
          [
            ['canvas', Film],
            ['agent', MessageSquare],
            ['review', ShieldCheck],
            ['sources', FolderOpen],
          ] as const
        ).map(([surface, Icon]) => (
          <button
            type="button"
            className={mobileSurface === surface ? 'is-current' : ''}
            onClick={() => setMobileSurface(surface)}
            key={surface}
          >
            <Icon className="size-4" />
            {surface[0].toUpperCase() + surface.slice(1)}
          </button>
        ))}
      </nav>
    </main>
  );
}
