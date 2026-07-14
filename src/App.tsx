import {
  Activity,
  Check,
  ChevronRight,
  CircleDot,
  Download,
  Eye,
  FileJson,
  Film,
  FolderOpen,
  History,
  Info,
  Layers,
  Lock,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Video,
  WandSparkles,
  X,
} from 'lucide-react';
import { type ChangeEvent, type DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { TraceWaterfall } from './components/TraceWaterfall';
import type {
  NodeVideoArtifact,
  NodeVideoCheckpoint,
  NodeVideoRecipeVersion,
  NodeVideoStageKind,
  RecipeProposalArtifact,
} from './lib/contracts';
import {
  SYNTHETIC_DEMO_DISCLOSURE,
  type SyntheticDemoRuntime,
  createSyntheticDemoRuntime,
  restoreSyntheticDemoRuntime,
} from './lib/demo';
import { LocalStorageCheckpointAdapter } from './lib/runtime';

const SYNTHETIC_VIDEO_URL = new URL('../fixtures/media/nodevideo-proof-v1.mp4', import.meta.url)
  .href;
const SYNTHETIC_PROOF_URL = new URL(
  '../fixtures/media/nodevideo-proof-v1.proof.json',
  import.meta.url,
).href;
const LAST_RUNTIME_KEY = 'nodevideo:last-runtime-id';

type ProjectMode = 'empty' | 'synthetic' | 'local';
type MobileView = 'project' | 'canvas' | 'inspect';
type CompareView = 'reference' | 'reconstruction' | 'difference';

interface LocalMedia {
  id: string;
  file: File;
  objectUrl: string;
  durationMs?: number;
  width?: number;
  height?: number;
  error?: string;
}

interface DisplayStage {
  kind: NodeVideoStageKind;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'awaiting-review' | 'failed' | 'cancelled';
  progress: number;
}

const DEMO_STAGE_LABELS: Array<{ kind: NodeVideoStageKind; label: string }> = [
  { kind: 'ingest', label: 'Inspect fixture metadata' },
  { kind: 'normalize', label: 'Describe normalized timeline' },
  { kind: 'audio', label: 'Generate onset evidence' },
  { kind: 'pose', label: 'Generate pose evidence' },
  { kind: 'alignment', label: 'Align fixture timelines' },
  { kind: 'diffs', label: 'Score fixture differences' },
  { kind: 'render', label: 'Describe comparison preview' },
  { kind: 'summary', label: 'Summarize fixture evidence' },
  { kind: 'review', label: 'Review recipe change' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(durationMs?: number): string {
  if (!durationMs || !Number.isFinite(durationMs)) return 'duration unavailable';
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function proposalDecision(
  checkpoint: NodeVideoCheckpoint | null,
  proposalId?: string,
): 'pending' | 'accepted' | 'declined' {
  if (!checkpoint || !proposalId) return 'pending';
  const decision = [...checkpoint.events]
    .reverse()
    .find(
      (event) =>
        (event.type === 'proposal.accepted' || event.type === 'proposal.declined') &&
        event.payload.proposalArtifactId === proposalId,
    );
  if (decision?.type === 'proposal.accepted') return 'accepted';
  if (decision?.type === 'proposal.declined') return 'declined';
  return 'pending';
}

function downloadJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function inspectLocalFile(file: File, index: number): Promise<LocalMedia> {
  const objectUrl = URL.createObjectURL(file);
  const base: LocalMedia = {
    id: `local-${file.lastModified}-${file.size}-${index}`,
    file,
    objectUrl,
  };

  return new Promise((resolve) => {
    const video = document.createElement('video');
    const finish = (result: LocalMedia) => {
      video.removeAttribute('src');
      video.load();
      resolve(result);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      finish({
        ...base,
        durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
      });
    };
    video.onerror = () => {
      finish({
        ...base,
        error: 'This browser could not decode metadata. The file still stayed on this device.',
      });
    };
    video.src = objectUrl;
  });
}

function statusLabel(status: DisplayStage['status']): string {
  if (status === 'awaiting-review') return 'Review';
  if (status === 'completed') return 'Complete';
  if (status === 'running') return 'Running';
  if (status === 'failed') return 'Failed';
  if (status === 'cancelled') return 'Cancelled';
  return 'Queued';
}

function AppHeader({
  mode,
  checkpoint,
  onDownloadReceipt,
}: {
  mode: ProjectMode;
  checkpoint: NodeVideoCheckpoint | null;
  onDownloadReceipt: () => void;
}) {
  const activeVersion = checkpoint?.activeRecipeVersion;
  const projectName =
    mode === 'synthetic'
      ? 'Verified synthetic comparison'
      : mode === 'local'
        ? 'Browser-local preview'
        : 'New local project';

  return (
    <header className="topbar">
      <div className="brand" aria-label="NodeVideo home">
        <span className="brand-mark">
          <Film size={18} aria-hidden="true" />
        </span>
        <span className="brand-copy">
          <span className="brand-name">NodeVideo</span>
          <span className="brand-version">P0 proof</span>
        </span>
      </div>
      <div className="project-title">
        <strong>{projectName}</strong>
        {activeVersion ? ` · recipe v${activeVersion}` : ''}
      </div>
      <div className="topbar-actions">
        <span
          className="privacy-badge"
          data-testid="privacy-badge"
          title={
            mode === 'synthetic'
              ? 'Public synthetic demo; no personal video is bundled.'
              : 'Selected files remain in this browser session.'
          }
        >
          <Lock size={12} aria-hidden="true" />
          <span>{mode === 'synthetic' ? 'Public synthetic demo' : 'Local to this browser'}</span>
        </span>
        {checkpoint?.stages.length ? (
          <button
            type="button"
            className="icon-button"
            onClick={onDownloadReceipt}
            title="Download run receipt"
          >
            <Download size={14} aria-hidden="true" />
            <span className="sr-only">Download run receipt</span>
          </button>
        ) : null}
      </div>
    </header>
  );
}

function AssetCard({
  title,
  role,
  meta,
}: {
  title: string;
  role: string;
  meta: string;
}) {
  return (
    <article className="asset-card">
      <div className="asset-thumb">
        <Video size={15} aria-hidden="true" />
      </div>
      <div>
        <p className="asset-title" title={title}>
          {title}
        </p>
        <div className="asset-meta">{role}</div>
        <div className="asset-meta">{meta}</div>
      </div>
    </article>
  );
}

function ProjectPanel({
  mode,
  checkpoint,
  localMedia,
  displayStages,
  runComplete,
  isRunning,
  onFiles,
  onRun,
  onLoadDemo,
  onDownloadManifest,
}: {
  mode: ProjectMode;
  checkpoint: NodeVideoCheckpoint | null;
  localMedia: readonly LocalMedia[];
  displayStages: readonly DisplayStage[];
  runComplete: boolean;
  isRunning: boolean;
  onFiles: (files: FileList | File[]) => void;
  onRun: () => void;
  onLoadDemo: () => void;
  onDownloadManifest: () => void;
}) {
  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (event.dataTransfer.files.length) onFiles(event.dataTransfer.files);
  };

  return (
    <div className="project-content">
      <div className="section-label">
        <span>Sources</span>
        <span>{mode === 'synthetic' ? 'fixture' : 'on device'}</span>
      </div>
      {mode === 'synthetic'
        ? checkpoint?.assets.map((asset) => (
            <AssetCard
              key={asset.id}
              title={asset.filename}
              role={asset.role}
              meta={`${formatDuration(asset.durationMs)} · ${asset.width}×${asset.height}`}
            />
          ))
        : localMedia.map((media, index) => (
            <AssetCard
              key={media.id}
              title={media.file.name}
              role={index === 0 ? 'reference preview' : `local clip ${index + 1}`}
              meta={`${formatDuration(media.durationMs)} · ${formatBytes(media.file.size)}`}
            />
          ))}
      {mode === 'empty' && localMedia.length === 0 ? (
        <div className="empty-inspector">No source clips selected.</div>
      ) : null}

      <label
        className="upload-drop"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <Upload size={16} aria-hidden="true" />
        <span>
          <strong>Add local video</strong>
          <span className="microcopy" style={{ display: 'block' }}>
            Preview only; bytes do not leave this browser
          </span>
        </span>
        <input
          type="file"
          accept="video/*,.mov"
          multiple
          onChange={(event) => event.target.files && onFiles(event.target.files)}
        />
      </label>

      {mode !== 'empty' ? (
        <>
          <div className="section-label">
            <span>Pipeline</span>
            <span>{runComplete ? 'recorded' : mode === 'local' ? 'preview' : 'ready'}</span>
          </div>
          <div className="pipeline-card">
            {(mode === 'local'
              ? [
                  {
                    kind: 'ingest' as const,
                    label: 'Read browser metadata',
                    status: 'completed' as const,
                    progress: 1,
                  },
                  {
                    kind: 'normalize' as const,
                    label: 'Media worker not connected',
                    status: 'pending' as const,
                    progress: 0,
                  },
                ]
              : displayStages
            ).map((stage, index) => (
              <div
                className={`stage-row is-${stage.status} ${stage.status === 'running' ? 'is-active' : ''}`}
                key={`${stage.kind}-${index}`}
              >
                <span className={`stage-index is-${stage.status}`}>
                  {stage.status === 'completed' ? (
                    <Check size={11} aria-hidden="true" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="stage-name">{stage.label}</span>
                <span className="stage-progress">{statusLabel(stage.status)}</span>
                {stage.status === 'running' ? (
                  <span className="stage-progress-bar">
                    <i style={{ width: `${stage.progress * 100}%` }} />
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          <div style={{ height: 10 }} />
          {mode === 'synthetic' ? (
            <button
              type="button"
              className="primary-button is-full"
              onClick={onRun}
              disabled={isRunning || runComplete}
            >
              {isRunning ? (
                <RefreshCw size={14} aria-hidden="true" />
              ) : runComplete ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Play size={14} aria-hidden="true" />
              )}
              {isRunning ? 'Running fixture…' : runComplete ? 'Plan complete' : 'Run local proof'}
            </button>
          ) : (
            <button type="button" className="secondary-button is-full" onClick={onDownloadManifest}>
              <Download size={14} aria-hidden="true" />
              Download local manifest
            </button>
          )}
          {mode === 'local' ? (
            <button type="button" className="ghost-button is-full" onClick={onLoadDemo}>
              <Sparkles size={14} aria-hidden="true" />
              Open verified demo
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function EmptyHero({
  onLoadDemo,
  onFiles,
}: {
  onLoadDemo: () => void;
  onFiles: (files: FileList | File[]) => void;
}) {
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) onFiles(event.target.files);
  };

  return (
    <section className="empty-hero" aria-labelledby="hero-title">
      <div className="hero-orbit">
        <WandSparkles size={27} aria-hidden="true" />
      </div>
      <span className="eyebrow-pill">Inspectable video reconstruction</span>
      <h1 id="hero-title">Frame math first. Suggestions second.</h1>
      <p>
        Preview your clips locally, inspect every pipeline stage, and approve recipe changes before
        they become a new version.
      </p>
      <div className="hero-actions">
        <button
          type="button"
          className="primary-button"
          data-testid="demo-load"
          onClick={onLoadDemo}
        >
          <Sparkles size={15} aria-hidden="true" />
          Load verified synthetic demo
        </button>
        <label className="secondary-button" data-testid="local-upload">
          <FolderOpen size={15} aria-hidden="true" />
          Choose local video
          <input
            className="sr-only"
            type="file"
            accept="video/*,.mov"
            multiple
            onChange={onChange}
          />
        </label>
      </div>
      <div className="trust-row" aria-label="Privacy and proof properties">
        <span>
          <ShieldCheck size={12} aria-hidden="true" /> No cloud upload
        </span>
        <span>
          <Activity size={12} aria-hidden="true" /> Append-only trace
        </span>
        <span>
          <History size={12} aria-hidden="true" /> Restorable recipes
        </span>
      </div>
    </section>
  );
}

function Workbench({
  mode,
  localMedia,
  compareView,
  onCompareView,
  runComplete,
  isRunning,
  onRun,
}: {
  mode: Exclude<ProjectMode, 'empty'>;
  localMedia: readonly LocalMedia[];
  compareView: CompareView;
  onCompareView: (view: CompareView) => void;
  runComplete: boolean;
  isRunning: boolean;
  onRun: () => void;
}) {
  const local = localMedia[0];
  const source = mode === 'synthetic' ? SYNTHETIC_VIDEO_URL : local?.objectUrl;

  return (
    <>
      <div className="canvas-toolbar">
        <div>
          <span className="eyebrow-pill">
            {mode === 'synthetic' ? 'Public format proof · 6 seconds' : 'Session-only preview'}
          </span>
        </div>
        {mode === 'synthetic' ? (
          <div className="view-toggle" aria-label="Comparison view">
            {(['reference', 'reconstruction', 'difference'] as const).map((view) => (
              <button
                type="button"
                className={compareView === view ? 'is-active' : ''}
                key={view}
                onClick={() => onCompareView(view)}
                aria-pressed={compareView === view}
              >
                {view}
              </button>
            ))}
          </div>
        ) : null}
        {mode === 'synthetic' ? (
          <button
            type="button"
            className="primary-button"
            data-testid="run-plan"
            onClick={onRun}
            disabled={isRunning || runComplete}
          >
            {runComplete ? <Check size={14} /> : <Play size={14} />}
            {isRunning ? 'Running…' : runComplete ? 'Proof recorded' : 'Run proof'}
          </button>
        ) : null}
      </div>

      <div className="video-workbench">
        <div className="portrait-stage">
          {source ? (
            // biome-ignore lint/a11y/useMediaCaption: The public fixture has no speech; local captions cannot be invented for user-selected media.
            <video
              key={source}
              src={source}
              controls
              playsInline
              preload="metadata"
              aria-label={
                mode === 'synthetic'
                  ? 'Public synthetic video format proof'
                  : `Local preview for ${local?.file.name ?? 'selected video'}`
              }
            />
          ) : (
            <div className="stage-placeholder">Choose a local video to preview it here.</div>
          )}
          <div className="stage-overlay" aria-hidden="true">
            <div className="safe-area" />
            <span className="stage-label">
              {mode === 'synthetic' ? compareView : 'local preview'}
            </span>
            {mode === 'synthetic' && compareView === 'difference' ? (
              <div className="difference-layer" />
            ) : null}
          </div>
        </div>
      </div>

      {mode === 'synthetic' ? (
        <div className="timeline" aria-label="Synthetic format proof timeline">
          <div className="timeline-top">
            <span>00:00 · fit</span>
            <span>cut 01:15 · fill</span>
            <span>cut 03:00 · fit</span>
            <span>06:00</span>
          </div>
          <div className="timeline-track">
            <span className="timeline-segment" style={{ flex: 1.5 }} />
            <span className="timeline-segment" style={{ flex: 1.5 }} />
            <span className="timeline-segment" style={{ flex: 1.5 }} />
            <span className="timeline-segment is-end" style={{ flex: 1.5 }} />
          </div>
        </div>
      ) : null}

      <div className="run-banner">
        <Info size={15} aria-hidden="true" />
        <div>
          <strong>
            {mode === 'synthetic'
              ? 'Synthetic media and synthetic analysis are disclosed.'
              : 'No upload occurred.'}
          </strong>{' '}
          {mode === 'synthetic'
            ? 'The playable clip proves fit, fill, cuts, BT.709 export, CFR30, and a silent tail. Analysis artifacts are deterministic fixture records—not claims about a person.'
            : (local?.error ??
              'The object URL exists only in this tab. Reloading requires you to choose the file again.')}
        </div>
      </div>
    </>
  );
}

function ProposalCard({
  proposal,
  decision,
  onAccept,
  onDecline,
}: {
  proposal: RecipeProposalArtifact;
  decision: 'pending' | 'accepted' | 'declined';
  onAccept: () => void;
  onDecline: () => void;
}) {
  const patch = proposal.patch;
  return (
    <article className="proposal-card" data-testid="proposal-card">
      <div className="proposal-head">
        <span className="proposal-icon">
          <SlidersHorizontal size={15} aria-hidden="true" />
        </span>
        <div>
          <h3>{proposal.title}</h3>
          <p>{proposal.rationale}</p>
        </div>
      </div>
      <div className="proposal-diff">
        <div className="diff-value">
          <span>Current offset</span>
          <strong>0 ms</strong>
        </div>
        <ChevronRight size={14} color="var(--ink-faint)" aria-hidden="true" />
        <div className="diff-value">
          <span>Proposed offset</span>
          <strong>{patch.alignmentOffsetMs ?? 0} ms</strong>
        </div>
      </div>
      {decision === 'pending' ? (
        <div className="proposal-actions">
          <button type="button" className="secondary-button" onClick={onDecline}>
            <X size={14} aria-hidden="true" /> Decline
          </button>
          <button
            type="button"
            className="primary-button"
            data-testid="accept-proposal"
            onClick={onAccept}
          >
            <Check size={14} aria-hidden="true" /> Accept as v2
          </button>
        </div>
      ) : (
        <div className="notice" style={{ margin: '0 13px 13px', width: 'auto' }}>
          {decision === 'accepted' ? <Check size={14} /> : <X size={14} />}
          <span>
            Proposal {decision}.{' '}
            {decision === 'accepted'
              ? 'Recipe version 2 was appended.'
              : 'Version 1 remains active.'}
          </span>
        </div>
      )}
    </article>
  );
}

function ArtifactPanel({ artifacts }: { artifacts: readonly NodeVideoArtifact[] }) {
  return (
    <section data-testid="artifact-panel" aria-labelledby="artifact-heading">
      <div className="section-label">
        <span id="artifact-heading">Synthetic artifacts</span>
        <span>{artifacts.length}</span>
      </div>
      <div className="artifact-list">
        {artifacts.map((artifact) => (
          <article className="artifact-card" key={artifact.id}>
            <span className="artifact-icon">
              <FileJson size={15} aria-hidden="true" />
            </span>
            <div style={{ minWidth: 0 }}>
              <p className="artifact-title" title={artifact.title}>
                {artifact.title}
              </p>
              <span className="artifact-kind">{artifact.kind} · synthetic</span>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => downloadJson(`${artifact.kind}.json`, artifact)}
              title={`Download ${artifact.title}`}
            >
              <Download size={12} aria-hidden="true" />
              <span className="sr-only">Download {artifact.title}</span>
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function VersionHistory({
  versions,
  activeVersion,
  onRestore,
}: {
  versions: readonly NodeVideoRecipeVersion[];
  activeVersion?: number;
  onRestore: (recipeId: string, version: number) => void;
}) {
  return (
    <section data-testid="version-history" aria-labelledby="version-heading">
      <div className="section-label">
        <span id="version-heading">Version history</span>
        <span>append-only</span>
      </div>
      <div className="version-list">
        {[...versions].reverse().map((version) => (
          <article
            className={`version-row ${version.version === activeVersion ? 'is-active' : ''}`}
            key={version.id}
          >
            <span className="version-number">v{version.version}</span>
            <div>
              <div className="version-title">Version {version.version}</div>
              <div className="version-meta">
                {version.reason} · {version.settings.render.layout}
              </div>
            </div>
            {version.version !== activeVersion ? (
              <button
                type="button"
                className="icon-button"
                onClick={() => onRestore(version.recipeId, version.version)}
                title={`Restore version ${version.version} as a new version`}
              >
                <RotateCcw size={12} aria-hidden="true" />
                <span className="sr-only">Restore version {version.version}</span>
              </button>
            ) : (
              <span className="status-dot is-complete" title="Active version" />
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function InspectorPanel({
  checkpoint,
  proposal,
  decision,
  onAccept,
  onDecline,
  onRestore,
}: {
  checkpoint: NodeVideoCheckpoint;
  proposal?: RecipeProposalArtifact;
  decision: 'pending' | 'accepted' | 'declined';
  onAccept: () => void;
  onDecline: () => void;
  onRestore: (recipeId: string, version: number) => void;
}) {
  const alignment = checkpoint.artifacts.find((item) => item.kind === 'alignment-report');
  const differences = checkpoint.artifacts.find((item) => item.kind === 'difference-report');

  return (
    <div className="inspector-scroll">
      <section data-testid="stage-list" aria-label="Recorded pipeline stages">
        <div className="section-label">
          <span>Pipeline receipt</span>
          <span>{checkpoint.stages.length} stages</span>
        </div>
        <div className="notice">
          <Check size={14} aria-hidden="true" />
          <span>
            {checkpoint.stages.filter((stage) => stage.status === 'completed').length} complete ·{' '}
            {checkpoint.stages.filter((stage) => stage.status === 'awaiting-review').length} review
          </span>
        </div>
      </section>
      <div className="section-label">
        <span>Review gate</span>
        <span>{decision}</span>
      </div>
      {proposal ? (
        <ProposalCard
          proposal={proposal}
          decision={decision}
          onAccept={onAccept}
          onDecline={onDecline}
        />
      ) : null}

      <div className="section-label">
        <span>Recorded facts</span>
        <span>fixture only</span>
      </div>
      <div className="fact-grid">
        <div className="fact-card">
          <span>Alignment</span>
          <strong>
            {alignment?.kind === 'alignment-report' ? `${alignment.offsetMs} ms` : '—'}
          </strong>
        </div>
        <div className="fact-card">
          <span>Difference score</span>
          <strong>
            {differences?.kind === 'difference-report'
              ? `${Math.round(differences.overallScore * 100)}%`
              : '—'}
          </strong>
        </div>
      </div>

      <ArtifactPanel artifacts={checkpoint.artifacts} />

      <section data-testid="trace-panel" aria-labelledby="trace-heading">
        <div className="section-label">
          <span id="trace-heading">Complete trace</span>
          <span>{checkpoint.spans.length} spans · ok</span>
        </div>
        <TraceWaterfall spans={checkpoint.spans} />
      </section>

      <VersionHistory
        versions={checkpoint.recipeVersions}
        activeVersion={checkpoint.activeRecipeVersion}
        onRestore={onRestore}
      />
    </div>
  );
}

export function App() {
  const [mode, setMode] = useState<ProjectMode>('empty');
  const [runtime, setRuntime] = useState<SyntheticDemoRuntime | null>(null);
  const [checkpoint, setCheckpoint] = useState<NodeVideoCheckpoint | null>(null);
  const [localMedia, setLocalMedia] = useState<LocalMedia[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runProgress, setRunProgress] = useState(-1);
  const [compareView, setCompareView] = useState<CompareView>('reconstruction');
  const [mobileView, setMobileView] = useState<MobileView>('canvas');
  const [announcement, setAnnouncement] = useState('');
  const localMediaRef = useRef<LocalMedia[]>([]);

  useEffect(() => {
    try {
      const runtimeId = localStorage.getItem(LAST_RUNTIME_KEY);
      if (!runtimeId) return;
      const saved = new LocalStorageCheckpointAdapter().load(runtimeId);
      if (!saved) return;
      const restored = restoreSyntheticDemoRuntime(saved);
      setRuntime(restored);
      setCheckpoint(restored.snapshot());
      setMode('synthetic');
      setMobileView(saved.stages.length ? 'inspect' : 'canvas');
    } catch {
      localStorage.removeItem(LAST_RUNTIME_KEY);
    }
  }, []);

  useEffect(() => {
    localMediaRef.current = localMedia;
  }, [localMedia]);

  useEffect(
    () => () => {
      for (const media of localMediaRef.current) URL.revokeObjectURL(media.objectUrl);
    },
    [],
  );

  const runComplete = Boolean(checkpoint?.stages.length);
  const proposal = checkpoint?.artifacts.find(
    (artifact): artifact is RecipeProposalArtifact => artifact.kind === 'recipe-proposal',
  );
  const decision = proposalDecision(checkpoint, proposal?.id);

  const displayStages = useMemo<DisplayStage[]>(() => {
    if (runComplete && checkpoint) {
      return checkpoint.stages.map((stage) => ({
        kind: stage.kind,
        label: stage.label,
        status: stage.status,
        progress: stage.progress,
      }));
    }
    return DEMO_STAGE_LABELS.map((stage, index) => ({
      ...stage,
      status: isRunning
        ? index < runProgress
          ? 'completed'
          : index === runProgress
            ? 'running'
            : 'pending'
        : 'pending',
      progress: index === runProgress ? 0.72 : index < runProgress ? 1 : 0,
    }));
  }, [checkpoint, isRunning, runComplete, runProgress]);

  const persistRuntime = (selectedRuntime: SyntheticDemoRuntime) => {
    const next = selectedRuntime.saveCheckpoint(new LocalStorageCheckpointAdapter());
    localStorage.setItem(LAST_RUNTIME_KEY, next.runtimeId);
    setCheckpoint(next);
  };

  const clearLocalMedia = () => {
    for (const media of localMediaRef.current) URL.revokeObjectURL(media.objectUrl);
    localMediaRef.current = [];
    setLocalMedia([]);
  };

  const handleLoadDemo = () => {
    clearLocalMedia();
    const nextRuntime = createSyntheticDemoRuntime({ runPipeline: false });
    setRuntime(nextRuntime);
    setCheckpoint(nextRuntime.snapshot());
    setMode('synthetic');
    setRunProgress(-1);
    setCompareView('reconstruction');
    setMobileView('canvas');
    setAnnouncement('Synthetic fixture loaded. The deterministic plan is ready to run.');
  };

  const handleFiles = async (files: FileList | File[]) => {
    const videoFiles = Array.from(files).filter(
      (file) => file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mov'),
    );
    if (!videoFiles.length) {
      setAnnouncement('No video files were selected.');
      return;
    }
    clearLocalMedia();
    setMode('local');
    setRuntime(null);
    setCheckpoint(null);
    setMobileView('canvas');
    setAnnouncement('Reading browser-local metadata. No upload was started.');
    const inspected = await Promise.all(videoFiles.map(inspectLocalFile));
    localMediaRef.current = inspected;
    setLocalMedia(inspected);
    setAnnouncement(
      `${inspected.length} local video ${inspected.length === 1 ? 'is' : 'are'} ready to preview.`,
    );
  };

  const handleRun = async () => {
    if (!runtime || isRunning || runComplete) return;
    setIsRunning(true);
    setAnnouncement('Running the deterministic synthetic fixture.');
    const finalCheckpoint = runtime.runSyntheticPipeline();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (let index = 0; index < DEMO_STAGE_LABELS.length; index += 1) {
      setRunProgress(index);
      if (!reduceMotion) await new Promise((resolve) => window.setTimeout(resolve, 90));
    }
    setRunProgress(DEMO_STAGE_LABELS.length);
    setCheckpoint(finalCheckpoint);
    persistRuntime(runtime);
    setIsRunning(false);
    setMobileView(window.innerWidth <= 700 ? 'inspect' : 'canvas');
    setAnnouncement('Synthetic proof complete. A recipe proposal is waiting for review.');
  };

  const handleAccept = () => {
    if (!runtime || !proposal || runtime.proposalStatus(proposal.id) !== 'pending') return;
    runtime.acceptProposal(proposal.id, 'Accepted in the NodeVideo review panel.');
    persistRuntime(runtime);
    setAnnouncement('Proposal accepted. Recipe version 2 was appended.');
  };

  const handleDecline = () => {
    if (!runtime || !proposal || runtime.proposalStatus(proposal.id) !== 'pending') return;
    runtime.declineProposal(proposal.id, 'Declined in the NodeVideo review panel.');
    persistRuntime(runtime);
    setAnnouncement('Proposal declined. Recipe version 1 remains active.');
  };

  const handleRestore = (recipeId: string, version: number) => {
    if (!runtime) return;
    runtime.restoreVersion(
      recipeId,
      version,
      `Restored version ${version} from the history panel.`,
    );
    persistRuntime(runtime);
    setAnnouncement(`Version ${version} was restored as a new append-only recipe version.`);
  };

  const handleDownloadManifest = () => {
    downloadJson('nodevideo-local-manifest.json', {
      schema: 'nodevideo.local-manifest.v1',
      disclosure: 'Browser metadata only. No media bytes are included.',
      generatedAt: new Date().toISOString(),
      assets: localMedia.map((media) => ({
        name: media.file.name,
        type: media.file.type || 'unknown',
        sizeBytes: media.file.size,
        lastModified: media.file.lastModified,
        durationMs: media.durationMs ?? null,
        width: media.width ?? null,
        height: media.height ?? null,
        metadataError: media.error ?? null,
      })),
      unavailableInBrowser: ['frame rate', 'rotation tag', 'HDR transfer metadata', 'content hash'],
    });
  };

  const handleDownloadReceipt = () => {
    if (!checkpoint) return;
    downloadJson('nodevideo-run-receipt.json', {
      schema: 'nodevideo.run-receipt.v1',
      disclosure: SYNTHETIC_DEMO_DISCLOSURE,
      checkpoint,
      publicMediaProof: SYNTHETIC_PROOF_URL,
    });
  };

  return (
    <div className="app-shell" data-testid="app-shell">
      <AppHeader mode={mode} checkpoint={checkpoint} onDownloadReceipt={handleDownloadReceipt} />
      <main className="workspace">
        <aside
          className={`workspace-pane project-pane ${mobileView === 'project' ? 'is-mobile-active' : ''}`}
          aria-label="Project sources and pipeline"
        >
          <div className="pane-header">
            <h2 className="pane-heading">Project</h2>
            <span className="status-pill">
              <span
                className={`status-dot ${isRunning ? 'is-running' : runComplete ? 'is-complete' : mode !== 'empty' ? 'is-ready' : ''}`}
              />
              {isRunning
                ? 'running'
                : runComplete
                  ? 'recorded'
                  : mode !== 'empty'
                    ? 'ready'
                    : 'empty'}
            </span>
          </div>
          <ProjectPanel
            mode={mode}
            checkpoint={checkpoint}
            localMedia={localMedia}
            displayStages={displayStages}
            runComplete={runComplete}
            isRunning={isRunning}
            onFiles={handleFiles}
            onRun={handleRun}
            onLoadDemo={handleLoadDemo}
            onDownloadManifest={handleDownloadManifest}
          />
        </aside>

        <section
          className={`workspace-pane stage-pane ${mobileView === 'canvas' ? 'is-mobile-active' : ''}`}
          aria-label="Video workbench"
        >
          <div className="stage-canvas-wrap">
            {mode === 'empty' ? (
              <EmptyHero onLoadDemo={handleLoadDemo} onFiles={handleFiles} />
            ) : (
              <Workbench
                mode={mode}
                localMedia={localMedia}
                compareView={compareView}
                onCompareView={setCompareView}
                runComplete={runComplete}
                isRunning={isRunning}
                onRun={handleRun}
              />
            )}
          </div>
        </section>

        <aside
          className={`workspace-pane inspector-pane ${mobileView === 'inspect' ? 'is-mobile-active' : ''}`}
          aria-label="Evidence inspector"
        >
          <div className="pane-header">
            <h2 className="pane-heading">Evidence</h2>
            <span className="status-pill">
              <Eye size={11} aria-hidden="true" /> inspectable
            </span>
          </div>
          {checkpoint?.stages.length ? (
            <InspectorPanel
              checkpoint={checkpoint}
              proposal={proposal}
              decision={decision}
              onAccept={handleAccept}
              onDecline={handleDecline}
              onRestore={handleRestore}
            />
          ) : (
            <div className="empty-inspector">
              <CircleDot size={15} aria-hidden="true" />
              <span>
                {mode === 'local'
                  ? 'Local previews do not claim analysis evidence.'
                  : 'Run the proof to record artifacts and traces.'}
              </span>
            </div>
          )}
        </aside>
      </main>

      <nav className="mobile-nav" aria-label="Workspace views">
        <button
          type="button"
          className={mobileView === 'project' ? 'is-active' : ''}
          onClick={() => setMobileView('project')}
          aria-current={mobileView === 'project' ? 'page' : undefined}
        >
          <Layers size={17} aria-hidden="true" /> Project
        </button>
        <button
          type="button"
          className={mobileView === 'canvas' ? 'is-active' : ''}
          onClick={() => setMobileView('canvas')}
          aria-current={mobileView === 'canvas' ? 'page' : undefined}
        >
          <Film size={17} aria-hidden="true" /> Canvas
        </button>
        <button
          type="button"
          className={mobileView === 'inspect' ? 'is-active' : ''}
          onClick={() => setMobileView('inspect')}
          aria-current={mobileView === 'inspect' ? 'page' : undefined}
        >
          <Activity size={17} aria-hidden="true" /> Inspect
        </button>
      </nav>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </div>
  );
}
