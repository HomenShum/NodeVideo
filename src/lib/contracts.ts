/**
 * Serializable contracts for NodeVideo's browser-local control plane.
 *
 * These types describe evidence and state; they do not imply that a real media
 * worker ran. Every artifact therefore carries explicit provenance.
 */

export const NODE_VIDEO_CHECKPOINT_VERSION = 1 as const;

export const NODE_VIDEO_STAGE_KINDS = [
  'ingest',
  'normalize',
  'audio',
  'pose',
  'alignment',
  'diffs',
  'render',
  'summary',
  'review',
] as const;

export type NodeVideoStageKind = (typeof NODE_VIDEO_STAGE_KINDS)[number];

export type NodeVideoStageStatus =
  | 'running'
  | 'awaiting-review'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type NodeVideoSpanStatus = 'running' | 'ok' | 'error' | 'cancelled';

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface TimeRange {
  startMs: number;
  endMs: number;
}

export interface SyntheticAssetSource {
  kind: 'synthetic';
  fixtureId: string;
  /** A visible reminder that this asset has no backing user video. */
  disclosure: string;
}

export interface LocalFileAssetSource {
  kind: 'local-file';
  lastModified: number;
  /**
   * Browser object URLs are deliberately marked session-only. A checkpoint
   * preserves metadata and provenance, not the bytes behind this URL.
   */
  objectUrl?: string;
  availability: 'current-browser-session';
}

export type NodeVideoAssetSource = SyntheticAssetSource | LocalFileAssetSource;

export interface NodeVideoAsset {
  id: string;
  kind: 'video';
  role: 'reference' | 'practice';
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  sha256?: string;
  source: NodeVideoAssetSource;
  createdAt: string;
}

export type RegisterNodeVideoAssetInput = Omit<NodeVideoAsset, 'id' | 'createdAt' | 'kind'>;

export type ComparisonLayout = 'side-by-side' | 'overlay' | 'difference';

export interface NodeVideoRecipeSettings {
  alignment: {
    method: 'manual' | 'audio-onset' | 'synthetic-fixture';
    offsetMs: number;
    maxSearchMs: number;
  };
  difference: {
    scoreThreshold: number;
    minimumSegmentMs: number;
  };
  render: {
    layout: ComparisonLayout;
    fps: number;
  };
  focusWindows: TimeRange[];
}

export interface NodeVideoRecipeVersion {
  id: string;
  recipeId: string;
  version: number;
  name: string;
  referenceAssetId: string;
  practiceAssetId: string;
  settings: NodeVideoRecipeSettings;
  reason: 'initial' | 'proposal' | 'restore';
  parentVersion?: number;
  proposalArtifactId?: string;
  restoredFromVersion?: number;
  createdAt: string;
}

export interface CreateNodeVideoRecipeInput {
  name: string;
  referenceAssetId: string;
  practiceAssetId: string;
  settings: NodeVideoRecipeSettings;
}

export interface NodeVideoRecipePatch {
  alignmentOffsetMs?: number;
  differenceScoreThreshold?: number;
  minimumSegmentMs?: number;
  renderLayout?: ComparisonLayout;
  focusWindows?: TimeRange[];
}

export interface NodeVideoStage {
  id: string;
  kind: NodeVideoStageKind;
  label: string;
  mode: 'synthetic' | 'browser-local';
  status: NodeVideoStageStatus;
  recipeId: string;
  recipeVersion: number;
  spanId: string;
  progress: number;
  artifactIds: string[];
  message?: string;
  startedAt: string;
  endedAt?: string;
}

export interface StartNodeVideoStageInput {
  kind: NodeVideoStageKind;
  label: string;
  mode: NodeVideoStage['mode'];
  recipeId: string;
  recipeVersion: number;
  message?: string;
  parentSpanId?: string;
}

export interface SyntheticArtifactProvenance {
  kind: 'synthetic';
  generator: 'nodevideo-demo';
  disclosure: string;
}

export interface BrowserLocalArtifactProvenance {
  kind: 'browser-local';
  processor: string;
  processorVersion: string;
  inputIds: string[];
}

export type NodeVideoArtifactProvenance =
  | SyntheticArtifactProvenance
  | BrowserLocalArtifactProvenance;

interface NodeVideoArtifactBase {
  id: string;
  stageId: string;
  recipeId: string;
  recipeVersion: number;
  title: string;
  provenance: NodeVideoArtifactProvenance;
  createdAt: string;
}

export interface AssetManifestArtifact extends NodeVideoArtifactBase {
  kind: 'asset-manifest';
  assetIds: string[];
  facts: {
    durationDeltaMs: number;
    dimensionsMatch: boolean;
    frameRatesMatch: boolean;
  };
}

export interface FeatureReportArtifact extends NodeVideoArtifactBase {
  kind: 'feature-report';
  feature: 'audio' | 'pose';
  sampleCount: number;
  confidence: number;
  observations: string[];
}

export interface AlignmentArtifact extends NodeVideoArtifactBase {
  kind: 'alignment-report';
  offsetMs: number;
  confidence: number;
  method: NodeVideoRecipeSettings['alignment']['method'];
  anchors: Array<{
    referenceMs: number;
    practiceMs: number;
    confidence: number;
  }>;
}

export interface DifferenceSegment {
  id: string;
  range: TimeRange;
  score: number;
  category: 'timing' | 'pose' | 'framing' | 'continuity';
  summary: string;
}

export interface DifferenceArtifact extends NodeVideoArtifactBase {
  kind: 'difference-report';
  overallScore: number;
  segments: DifferenceSegment[];
}

export interface PreviewArtifact extends NodeVideoArtifactBase {
  kind: 'comparison-preview';
  layout: ComparisonLayout;
  durationMs: number;
  /** Synthetic demos intentionally do not claim a playable URL. */
  mediaUrl?: string;
}

export interface SummaryArtifact extends NodeVideoArtifactBase {
  kind: 'summary';
  headline: string;
  findings: string[];
  evidenceArtifactIds: string[];
}

export interface RecipeProposalArtifact extends NodeVideoArtifactBase {
  kind: 'recipe-proposal';
  baseVersion: number;
  rationale: string;
  patch: NodeVideoRecipePatch;
}

export type NodeVideoArtifact =
  | AssetManifestArtifact
  | FeatureReportArtifact
  | AlignmentArtifact
  | DifferenceArtifact
  | PreviewArtifact
  | SummaryArtifact
  | RecipeProposalArtifact;

type WithoutGeneratedFields<T> = T extends NodeVideoArtifact ? Omit<T, 'id' | 'createdAt'> : never;

export type CreateNodeVideoArtifactInput = WithoutGeneratedFields<NodeVideoArtifact>;

export interface NodeVideoSpan {
  id: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  stageKind: NodeVideoStageKind;
  status: NodeVideoSpanStatus;
  startedAt: string;
  endedAt?: string;
  attributes: Record<string, JsonValue>;
  artifactIds: string[];
}

interface NodeVideoEventBase<Type extends string, Payload> {
  id: string;
  runtimeId: string;
  sequence: number;
  timestamp: string;
  type: Type;
  payload: Payload;
}

export type NodeVideoEvent =
  | NodeVideoEventBase<'runtime.created', { traceId: string }>
  | NodeVideoEventBase<'asset.registered', { assetId: string; role: NodeVideoAsset['role'] }>
  | NodeVideoEventBase<
      'recipe.version.created',
      {
        recipeId: string;
        recipeVersionId: string;
        version: number;
        reason: NodeVideoRecipeVersion['reason'];
      }
    >
  | NodeVideoEventBase<
      'stage.started',
      { stageId: string; stageKind: NodeVideoStageKind; spanId: string }
    >
  | NodeVideoEventBase<
      'stage.completed',
      { stageId: string; artifactIds: string[]; spanId: string }
    >
  | NodeVideoEventBase<
      'stage.awaiting-review',
      { stageId: string; artifactIds: string[]; spanId: string }
    >
  | NodeVideoEventBase<'stage.failed', { stageId: string; spanId: string; message: string }>
  | NodeVideoEventBase<
      'artifact.created',
      { artifactId: string; artifactKind: NodeVideoArtifact['kind']; stageId: string }
    >
  | NodeVideoEventBase<
      'proposal.accepted',
      { proposalArtifactId: string; createdVersion: number; note?: string }
    >
  | NodeVideoEventBase<'proposal.declined', { proposalArtifactId: string; note?: string }>
  | NodeVideoEventBase<
      'recipe.version.restored',
      { recipeId: string; sourceVersion: number; createdVersion: number; note?: string }
    >;

export type NodeVideoEventType = NodeVideoEvent['type'];

export type ProposalStatus = 'pending' | 'accepted' | 'declined';

export interface NodeVideoCheckpoint {
  schemaVersion: typeof NODE_VIDEO_CHECKPOINT_VERSION;
  runtimeId: string;
  traceId: string;
  createdAt: string;
  updatedAt: string;
  assets: NodeVideoAsset[];
  recipeVersions: NodeVideoRecipeVersion[];
  activeRecipeId?: string;
  activeRecipeVersion?: number;
  stages: NodeVideoStage[];
  artifacts: NodeVideoArtifact[];
  spans: NodeVideoSpan[];
  /** Events are immutable and strictly ordered by sequence. */
  events: NodeVideoEvent[];
  nextSequence: number;
}

export interface RuntimeClock {
  now(): string;
  nextId(scope: string): string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface NodeVideoCheckpointAdapter {
  load(runtimeId: string): NodeVideoCheckpoint | null;
  save(checkpoint: NodeVideoCheckpoint): void;
  remove(runtimeId: string): void;
}
