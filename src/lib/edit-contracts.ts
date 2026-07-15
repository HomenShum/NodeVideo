export const EDIT_UNDERSTANDING_SCHEMA_VERSION = 'nodevideo.edit-understanding.v1' as const;
export const EDIT_PLAN_SCHEMA_VERSION = 'nodevideo.edit-plan.v1' as const;
export const CRITIC_REPORT_SCHEMA_VERSION = 'nodevideo.critic-report.v2' as const;
export const LEGACY_CRITIC_REPORT_SCHEMA_VERSION = 'nodevideo.critic-report.v1' as const;

export interface FrameRange {
  startFrame: number;
  endFrameExclusive: number;
}

export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface BeatGrid {
  bpm: number;
  offsetMs: number;
  beatsMs: number[];
  downbeatsMs: number[];
  confidence: number;
}

export interface MusicLicense {
  status: 'owned' | 'licensed' | 'public-domain' | 'target-derived-authorized';
  proofRef: string;
  expiresAt?: string;
}

export type EditAssetRole =
  | 'source-video'
  | 'reference-target'
  | 'music'
  | 'sfx'
  | 'sting'
  | 'graphic';
export type EditAssetUsage =
  | 'render-source'
  | 'analysis-only'
  | 'evaluation-only'
  | 'analysis-and-evaluation-only'
  | 'analysis-evaluation-and-authorized-asset-derivation';

export interface EditAsset {
  id: string;
  role: EditAssetRole;
  sha256: string;
  mimeType: string;
  usage: EditAssetUsage;
}

export interface GeometricVerification {
  method: 'normalized-frame-search' | 'embedding-search' | 'manual';
  inlierRatio: number;
  reprojectionErrorPx: number;
}

export interface SourceCandidate {
  id: string;
  sourceAssetId: string;
  sourceRange: FrameRange;
  confidence: number;
  verification?: GeometricVerification;
}

export interface CropKeyframe {
  timelineFrame: number;
  box: NormalizedBox;
}

export interface ReframeAnalysis {
  keyframes: CropKeyframe[];
  confidence: number;
}

export interface GradeAnalysis {
  kind:
    | 'none'
    | 'hlg-bt2020-to-sdr-bt709-hable'
    | 'hlg-bt2020-to-sdr-bt709-hable-cube-lut'
    | 'ocio-look'
    | 'cube-lut'
    | 'asc-cdl';
  artifactId?: string;
  confidence: number;
}

export interface UnderstoodShot {
  id: string;
  targetRange?: FrameRange;
  candidates: SourceCandidate[];
  selectedCandidateId?: string;
  reframe?: ReframeAnalysis;
  grade?: GradeAnalysis;
}

export interface TranscriptSegment {
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

export interface MusicIdentity {
  title: string;
  artist: string;
  isrc?: string;
}

export interface AudioExcerpt {
  sourceOffsetMs: number;
  releasedMasterOffsetMs?: number;
  releasedMasterGainDb?: number;
  targetStartMs: number;
  targetEndMs: number;
}

export interface MusicCandidate {
  assetId: string;
  confidence: number;
  rationale: string;
  identity?: MusicIdentity;
  excerpt?: AudioExcerpt;
}

export interface AudioUnderstanding {
  targetAudioUsage: 'absent' | 'analysis-only' | 'authorized-render-source';
  beatGrid?: BeatGrid;
  transcript: TranscriptSegment[];
  musicCandidates: MusicCandidate[];
  selectedMusicAssetId?: string;
}

export interface UnderstoodOverlay {
  id: string;
  kind: 'text' | 'graphic';
  targetRange: FrameRange;
  text?: string;
  graphicAssetId?: string;
  box: NormalizedBox;
  confidence: number;
  styleToken?: string;
}

export interface EditUnderstanding {
  schemaVersion: typeof EDIT_UNDERSTANDING_SCHEMA_VERSION;
  id: string;
  runId: string;
  createdAt: string;
  mode: 'reference-understanding' | 'source-only-analysis';
  frameRate: number;
  canvas: CanvasSize;
  assets: EditAsset[];
  shots: UnderstoodShot[];
  audio: AudioUnderstanding;
  overlays: UnderstoodOverlay[];
  warnings: string[];
}

export interface GradeInstruction {
  kind:
    | 'none'
    | 'hlg-bt2020-to-sdr-bt709-hable'
    | 'hlg-bt2020-to-sdr-bt709-hable-cube-lut'
    | 'ocio-look'
    | 'cube-lut'
    | 'asc-cdl';
  artifactId?: string;
}

interface VideoClipBase {
  id: string;
  timelineRange: FrameRange;
}

export interface SourceVideoClip extends VideoClipBase {
  kind: 'source';
  assetId: string;
  sourceRange: FrameRange;
  playbackRate: number;
  fit: 'fit' | 'fill' | 'crop';
  cropKeyframes: CropKeyframe[];
  grade: GradeInstruction;
}

export interface FreezeVideoClip extends VideoClipBase {
  kind: 'freeze';
  assetId: string;
  sourceFrame: number;
  fit: 'fit' | 'fill' | 'crop';
  cropKeyframes: CropKeyframe[];
  grade: GradeInstruction;
}

export interface BlackVideoClip extends VideoClipBase {
  kind: 'black';
}

export type VideoClip = SourceVideoClip | FreezeVideoClip | BlackVideoClip;

export interface AudioClip {
  id: string;
  assetId: string;
  timelineRange: FrameRange;
  sourceRange: FrameRange;
  playbackRate: number;
  role: 'source' | 'music' | 'voiceover' | 'sfx' | 'sting';
  gainDb: number;
  fadeInFrames: number;
  fadeOutFrames: number;
  license?: MusicLicense;
}

export interface AudioRoute {
  id: string;
  sourceKind: 'asset-audio' | 'track';
  sourceId: string;
  bus: 'program' | 'music' | 'voiceover' | 'effects';
  muted: boolean;
  gainDb: number;
}

interface TimedAudioEvent {
  id: string;
  targetStartMs: number;
  targetEndMs: number;
}

export interface MusicAudioEvent extends TimedAudioEvent {
  kind: 'music';
  clipId: string;
  sourceOffsetMs: number;
  releasedMasterOffsetMs: number;
  releasedMasterGainDb: number;
  gainDb: number;
  identity?: MusicIdentity;
}

export interface EffectAudioEvent extends TimedAudioEvent {
  kind: 'sfx' | 'sting';
  clipId: string;
  sourceOffsetMs: number;
  gainDb: number;
  label?: string;
}

export interface SilenceAudioEvent extends TimedAudioEvent {
  kind: 'silence';
}

export type AudioEvent = MusicAudioEvent | EffectAudioEvent | SilenceAudioEvent;

export interface AudioProgram {
  routing: AudioRoute[];
  events: AudioEvent[];
}

export interface OverlayClip {
  id: string;
  timelineRange: FrameRange;
  kind: 'text' | 'graphic';
  text?: string;
  assetId?: string;
  templateId: string;
  box: NormalizedBox;
  animation: 'none' | 'fade' | 'pop' | 'slide-up';
}

export interface VideoTrack {
  id: string;
  kind: 'video';
  role: 'primary' | 'b-roll';
  clips: VideoClip[];
}

export interface AudioTrack {
  id: string;
  kind: 'audio';
  role: 'program' | 'music' | 'voiceover' | 'effects';
  clips: AudioClip[];
}

export interface OverlayTrack {
  id: string;
  kind: 'overlay';
  clips: OverlayClip[];
}

export type EditTrack = VideoTrack | AudioTrack | OverlayTrack;

export interface EditLineage {
  renderAssetIds: string[];
  evaluationOnlyAssetIds: string[];
  targetDerivedRenderAssetIds: string[];
}

export interface EditPlan {
  schemaVersion: typeof EDIT_PLAN_SCHEMA_VERSION;
  id: string;
  understandingId: string;
  version: number;
  createdAt: string;
  frameRate: number;
  canvas: CanvasSize;
  durationFrames: number;
  lineage: EditLineage;
  audio: AudioProgram;
  beatGrid?: BeatGrid;
  tracks: EditTrack[];
}

export type CriticMode = 'deterministic' | 'multimodal' | 'combined';
export type CriticVerdict = 'pass' | 'revise' | 'fail';
export type CriticCategory =
  | 'technical'
  | 'mapping'
  | 'rhythm'
  | 'framing'
  | 'text'
  | 'audio'
  | 'grade'
  | 'taste'
  | 'lineage';

export interface CriticScores {
  technical: number;
  mapping: number;
  rhythm: number;
  framing: number;
  text: number;
  audio: number;
  grade: number;
  taste: number | null;
}

export type CriticTasteStatus = 'not-evaluated' | 'evaluated-blinded';

export interface LegacyCriticScoresV1 extends Omit<CriticScores, 'taste'> {
  taste: number;
}

export interface CriticEvidence {
  artifactId: string;
  timelineRange?: FrameRange;
  observed?: string;
  expected?: string;
}

export interface CriticFinding {
  id: string;
  severity: 'error' | 'warning' | 'suggestion';
  category: CriticCategory;
  message: string;
  evidence?: CriticEvidence;
}

export interface CriticWindow {
  timelineRange: FrameRange;
  score: number;
  metric: Exclude<CriticCategory, 'lineage'>;
  findingIds: string[];
}

interface PatchBase {
  id: string;
  targetClipId: string;
  rationale: string;
  confidence: number;
}

export interface ReplaceClipPatch extends PatchBase {
  op: 'replace-clip';
  assetId: string;
  sourceRange: FrameRange;
  playbackRate: number;
  license?: MusicLicense;
}

export interface NudgeCutPatch extends PatchBase {
  op: 'nudge-cut';
  startDeltaFrames?: number;
  endDeltaFrames?: number;
}

export interface SetCropKeyframesPatch extends PatchBase {
  op: 'set-crop-keyframes';
  cropKeyframes: CropKeyframe[];
}

export interface SetOverlayPatch extends PatchBase {
  op: 'set-overlay';
  text?: string;
  assetId?: string;
  templateId?: string;
  box?: NormalizedBox;
}

export interface SetAudioMixPatch extends PatchBase {
  op: 'set-audio-mix';
  gainDb?: number;
  fadeInFrames?: number;
  fadeOutFrames?: number;
}

export interface SetGradePatch extends PatchBase {
  op: 'set-grade';
  grade: GradeInstruction;
}

export type EditPlanPatch =
  | ReplaceClipPatch
  | NudgeCutPatch
  | SetCropKeyframesPatch
  | SetOverlayPatch
  | SetAudioMixPatch
  | SetGradePatch;

export interface CriticReport {
  schemaVersion: typeof CRITIC_REPORT_SCHEMA_VERSION;
  id: string;
  planId: string;
  planVersion: number;
  renderArtifactId: string;
  createdAt: string;
  mode: CriticMode;
  verdict: CriticVerdict;
  scores: CriticScores;
  tasteStatus: CriticTasteStatus;
  tasteEvidenceRef?: string;
  findings: CriticFinding[];
  worstWindows: CriticWindow[];
  patches: EditPlanPatch[];
}

/** Read-only compatibility shape for critic artifacts emitted before taste evaluation was explicit. */
export interface LegacyCriticReportV1
  extends Omit<CriticReport, 'schemaVersion' | 'scores' | 'tasteStatus' | 'tasteEvidenceRef'> {
  schemaVersion: typeof LEGACY_CRITIC_REPORT_SCHEMA_VERSION;
  scores: LegacyCriticScoresV1;
}

type UnknownRecord = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function asRecord(value: unknown, label: string): UnknownRecord {
  assert(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    `${label} must be an object`,
  );
  return value as UnknownRecord;
}

function assertExactKeys(
  value: UnknownRecord,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    assert(allowed.has(key), `${label} has unknown key: ${key}`);
  }
  for (const key of required) {
    assert(Object.hasOwn(value, key), `${label} is missing key: ${key}`);
  }
}

function assertString(value: unknown, label: string, maxLength = 256): asserts value is string {
  assert(typeof value === 'string', `${label} must be a string`);
  assert(value.trim().length > 0, `${label} must not be empty`);
  assert(value.length <= maxLength, `${label} must be at most ${maxLength} characters`);
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  assert(typeof value === 'number' && Number.isFinite(value), `${label} must be a finite number`);
}

function assertInteger(value: unknown, label: string, minimum = 0): asserts value is number {
  assertFiniteNumber(value, label);
  assert(Number.isSafeInteger(value), `${label} must be a safe integer`);
  assert(value >= minimum, `${label} must be at least ${minimum}`);
}

function assertSignedInteger(value: unknown, label: string): asserts value is number {
  assertFiniteNumber(value, label);
  assert(Number.isSafeInteger(value), `${label} must be a safe integer`);
}

function assertPositiveNumber(value: unknown, label: string): asserts value is number {
  assertFiniteNumber(value, label);
  assert(value > 0, `${label} must be positive`);
}

function assertConfidence(value: unknown, label: string): asserts value is number {
  assertFiniteNumber(value, label);
  assert(value >= 0 && value <= 1, `${label} must be between 0 and 1`);
}

function assertOneOf<T extends string>(
  value: unknown,
  choices: readonly T[],
  label: string,
): asserts value is T {
  assert(typeof value === 'string' && choices.includes(value as T), `${label} is unsupported`);
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  assert(Array.isArray(value), `${label} must be an array`);
}

function assertIsoTimestamp(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === 'string' && Number.isFinite(Date.parse(value)),
    `${label} must be an ISO timestamp`,
  );
}

function validateFrameRange(value: unknown, label: string): asserts value is FrameRange {
  const range = asRecord(value, label);
  assertExactKeys(range, label, ['startFrame', 'endFrameExclusive']);
  assertInteger(range.startFrame, `${label}.startFrame`);
  assertInteger(range.endFrameExclusive, `${label}.endFrameExclusive`, 1);
  assert(
    range.endFrameExclusive > range.startFrame,
    `${label}.endFrameExclusive must be after startFrame`,
  );
}

function validateCanvas(value: unknown, label: string): asserts value is CanvasSize {
  const canvas = asRecord(value, label);
  assertExactKeys(canvas, label, ['width', 'height']);
  assertInteger(canvas.width, `${label}.width`, 1);
  assertInteger(canvas.height, `${label}.height`, 1);
}

function validateBox(value: unknown, label: string): asserts value is NormalizedBox {
  const box = asRecord(value, label);
  assertExactKeys(box, label, ['x', 'y', 'width', 'height']);
  assertConfidence(box.x, `${label}.x`);
  assertConfidence(box.y, `${label}.y`);
  assertPositiveNumber(box.width, `${label}.width`);
  assertPositiveNumber(box.height, `${label}.height`);
  assert(box.width <= 1 && box.height <= 1, `${label} dimensions must be normalized`);
  assert(box.x + box.width <= 1, `${label} exceeds the horizontal canvas`);
  assert(box.y + box.height <= 1, `${label} exceeds the vertical canvas`);
}

function validateCropKeyframes(
  value: unknown,
  label: string,
  containingRange?: FrameRange,
): asserts value is CropKeyframe[] {
  assertArray(value, label);
  let previousFrame = -1;
  value.forEach((item, index) => {
    const keyframe = asRecord(item, `${label}[${index}]`);
    assertExactKeys(keyframe, `${label}[${index}]`, ['timelineFrame', 'box']);
    assertInteger(keyframe.timelineFrame, `${label}[${index}].timelineFrame`);
    assert(keyframe.timelineFrame > previousFrame, `${label} must be strictly ordered`);
    if (containingRange) {
      assert(
        keyframe.timelineFrame >= containingRange.startFrame &&
          keyframe.timelineFrame < containingRange.endFrameExclusive,
        `${label}[${index}] lies outside its clip range`,
      );
    }
    validateBox(keyframe.box, `${label}[${index}].box`);
    previousFrame = keyframe.timelineFrame;
  });
}

function validateBeatGrid(value: unknown, label: string): asserts value is BeatGrid {
  const grid = asRecord(value, label);
  assertExactKeys(grid, label, ['bpm', 'offsetMs', 'beatsMs', 'downbeatsMs', 'confidence']);
  assertPositiveNumber(grid.bpm, `${label}.bpm`);
  assertFiniteNumber(grid.offsetMs, `${label}.offsetMs`);
  assert(grid.offsetMs >= 0, `${label}.offsetMs must be non-negative`);
  assertConfidence(grid.confidence, `${label}.confidence`);
  assertArray(grid.beatsMs, `${label}.beatsMs`);
  assert(grid.beatsMs.length > 0, `${label}.beatsMs must not be empty`);
  let previousBeat = -1;
  for (const [index, beat] of grid.beatsMs.entries()) {
    assertFiniteNumber(beat, `${label}.beatsMs[${index}]`);
    assert(beat >= 0 && beat > previousBeat, `${label}.beatsMs must be strictly increasing`);
    previousBeat = beat;
  }
  assertArray(grid.downbeatsMs, `${label}.downbeatsMs`);
  const beatSet = new Set(grid.beatsMs);
  let previousDownbeat = -1;
  for (const [index, beat] of grid.downbeatsMs.entries()) {
    assertFiniteNumber(beat, `${label}.downbeatsMs[${index}]`);
    assert(beat > previousDownbeat, `${label}.downbeatsMs must be strictly increasing`);
    assert(beatSet.has(beat), `${label}.downbeatsMs[${index}] is not present in beatsMs`);
    previousDownbeat = beat;
  }
}

function validateMusicLicense(value: unknown, label: string): asserts value is MusicLicense {
  const license = asRecord(value, label);
  assertExactKeys(license, label, ['status', 'proofRef'], ['expiresAt']);
  assertOneOf(
    license.status,
    ['owned', 'licensed', 'public-domain', 'target-derived-authorized'],
    `${label}.status`,
  );
  assertString(license.proofRef, `${label}.proofRef`, 2_048);
  if (license.expiresAt !== undefined) assertIsoTimestamp(license.expiresAt, `${label}.expiresAt`);
}

function validateMusicIdentity(value: unknown, label: string): asserts value is MusicIdentity {
  const identity = asRecord(value, label);
  assertExactKeys(identity, label, ['title', 'artist'], ['isrc']);
  assertString(identity.title, `${label}.title`, 1_024);
  assertString(identity.artist, `${label}.artist`, 1_024);
  if (identity.isrc !== undefined) {
    assert(
      typeof identity.isrc === 'string' && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(identity.isrc),
      `${label}.isrc must be a canonical 12-character ISRC`,
    );
  }
}

function validateAudioExcerpt(value: unknown, label: string): asserts value is AudioExcerpt {
  const excerpt = asRecord(value, label);
  assertExactKeys(
    excerpt,
    label,
    ['sourceOffsetMs', 'targetStartMs', 'targetEndMs'],
    ['releasedMasterOffsetMs', 'releasedMasterGainDb'],
  );
  assertFiniteNumber(excerpt.sourceOffsetMs, `${label}.sourceOffsetMs`);
  if (excerpt.releasedMasterOffsetMs !== undefined) {
    assertFiniteNumber(excerpt.releasedMasterOffsetMs, `${label}.releasedMasterOffsetMs`);
    assert(
      excerpt.releasedMasterOffsetMs >= 0,
      `${label}.releasedMasterOffsetMs must be non-negative`,
    );
  }
  if (excerpt.releasedMasterGainDb !== undefined) {
    assertFiniteNumber(excerpt.releasedMasterGainDb, `${label}.releasedMasterGainDb`);
  }
  assertFiniteNumber(excerpt.targetStartMs, `${label}.targetStartMs`);
  assertFiniteNumber(excerpt.targetEndMs, `${label}.targetEndMs`);
  assert(excerpt.sourceOffsetMs >= 0, `${label}.sourceOffsetMs must be non-negative`);
  assert(excerpt.targetStartMs >= 0, `${label}.targetStartMs must be non-negative`);
  assert(excerpt.targetEndMs > excerpt.targetStartMs, `${label} must have positive duration`);
}

function validateGrade(
  value: unknown,
  label: string,
  renderAssetIds?: ReadonlySet<string>,
): asserts value is GradeInstruction {
  const grade = asRecord(value, label);
  assertExactKeys(grade, label, ['kind'], ['artifactId']);
  assertOneOf(
    grade.kind,
    [
      'none',
      'hlg-bt2020-to-sdr-bt709-hable',
      'hlg-bt2020-to-sdr-bt709-hable-cube-lut',
      'ocio-look',
      'cube-lut',
      'asc-cdl',
    ],
    `${label}.kind`,
  );
  if (grade.kind === 'none' || grade.kind === 'hlg-bt2020-to-sdr-bt709-hable') {
    assert(
      grade.artifactId === undefined,
      `${label}.artifactId is not allowed for fixed grade: ${grade.kind}`,
    );
    return;
  }
  assertString(grade.artifactId, `${label}.artifactId`);
  if (renderAssetIds) {
    assert(renderAssetIds.has(grade.artifactId), `${label}.artifactId is not a render asset`);
  }
}

function assertUniqueStrings(values: unknown, label: string): asserts values is string[] {
  assertArray(values, label);
  const seen = new Set<string>();
  values.forEach((item, index) => {
    assertString(item, `${label}[${index}]`);
    assert(!seen.has(item), `${label} contains duplicate id: ${item}`);
    seen.add(item);
  });
}

function assertWithinDuration(range: FrameRange, durationFrames: number, label: string): void {
  assert(range.endFrameExclusive <= durationFrames, `${label} exceeds plan duration`);
}

export function validateEditUnderstanding(value: unknown): asserts value is EditUnderstanding {
  const understanding = asRecord(value, 'EditUnderstanding');
  assertExactKeys(understanding, 'EditUnderstanding', [
    'schemaVersion',
    'id',
    'runId',
    'createdAt',
    'mode',
    'frameRate',
    'canvas',
    'assets',
    'shots',
    'audio',
    'overlays',
    'warnings',
  ]);
  assert(
    understanding.schemaVersion === EDIT_UNDERSTANDING_SCHEMA_VERSION,
    `Unsupported EditUnderstanding schema version: ${String(understanding.schemaVersion)}`,
  );
  assertString(understanding.id, 'EditUnderstanding.id');
  assertString(understanding.runId, 'EditUnderstanding.runId');
  assertIsoTimestamp(understanding.createdAt, 'EditUnderstanding.createdAt');
  assertOneOf(
    understanding.mode,
    ['reference-understanding', 'source-only-analysis'],
    'EditUnderstanding.mode',
  );
  assertPositiveNumber(understanding.frameRate, 'EditUnderstanding.frameRate');
  validateCanvas(understanding.canvas, 'EditUnderstanding.canvas');

  assertArray(understanding.assets, 'EditUnderstanding.assets');
  const assetRoles = new Map<string, EditAssetRole>();
  for (const [index, item] of understanding.assets.entries()) {
    const label = `EditUnderstanding.assets[${index}]`;
    const asset = asRecord(item, label);
    assertExactKeys(asset, label, ['id', 'role', 'sha256', 'mimeType', 'usage']);
    assertString(asset.id, `${label}.id`);
    assert(
      !assetRoles.has(asset.id),
      `EditUnderstanding.assets contains duplicate id: ${asset.id}`,
    );
    assertOneOf(
      asset.role,
      ['source-video', 'reference-target', 'music', 'sfx', 'sting', 'graphic'],
      `${label}.role`,
    );
    assert(
      typeof asset.sha256 === 'string' && /^sha256:[a-f0-9]{64}$/.test(asset.sha256),
      `${label}.sha256 must be a canonical sha256 digest`,
    );
    assertString(asset.mimeType, `${label}.mimeType`);
    assertOneOf(
      asset.usage,
      [
        'render-source',
        'analysis-only',
        'evaluation-only',
        'analysis-and-evaluation-only',
        'analysis-evaluation-and-authorized-asset-derivation',
      ],
      `${label}.usage`,
    );
    if (asset.usage === 'analysis-evaluation-and-authorized-asset-derivation') {
      assert(
        asset.role === 'reference-target',
        `${label}.usage may only be assigned to a reference-target container`,
      );
    }
    if (asset.role === 'source-video' || asset.role === 'reference-target') {
      assert(asset.mimeType.startsWith('video/'), `${label}.mimeType must be video/*`);
    } else if (asset.role === 'music' || asset.role === 'sfx' || asset.role === 'sting') {
      assert(asset.mimeType.startsWith('audio/'), `${label}.mimeType must be audio/*`);
    } else {
      assert(asset.mimeType.startsWith('image/'), `${label}.mimeType must be image/*`);
    }
    assetRoles.set(asset.id, asset.role);
  }
  assert(
    [...assetRoles.values()].includes('source-video'),
    'EditUnderstanding requires at least one source-video asset',
  );
  if (understanding.mode === 'reference-understanding') {
    assert(
      [...assetRoles.values()].includes('reference-target'),
      'Reference understanding requires a reference-target asset',
    );
  }

  assertArray(understanding.shots, 'EditUnderstanding.shots');
  const shotIds = new Set<string>();
  for (const [shotIndex, item] of understanding.shots.entries()) {
    const label = `EditUnderstanding.shots[${shotIndex}]`;
    const shot = asRecord(item, label);
    assertExactKeys(
      shot,
      label,
      ['id', 'candidates'],
      ['targetRange', 'selectedCandidateId', 'reframe', 'grade'],
    );
    assertString(shot.id, `${label}.id`);
    assert(!shotIds.has(shot.id), `EditUnderstanding.shots contains duplicate id: ${shot.id}`);
    shotIds.add(shot.id);
    if (understanding.mode === 'reference-understanding') {
      assert(shot.targetRange !== undefined, `${label}.targetRange is required in reference mode`);
    }
    if (shot.targetRange !== undefined)
      validateFrameRange(shot.targetRange, `${label}.targetRange`);

    assertArray(shot.candidates, `${label}.candidates`);
    const candidateIds = new Set<string>();
    for (const [candidateIndex, candidateItem] of shot.candidates.entries()) {
      const candidateLabel = `${label}.candidates[${candidateIndex}]`;
      const candidate = asRecord(candidateItem, candidateLabel);
      assertExactKeys(
        candidate,
        candidateLabel,
        ['id', 'sourceAssetId', 'sourceRange', 'confidence'],
        ['verification'],
      );
      assertString(candidate.id, `${candidateLabel}.id`);
      assert(
        !candidateIds.has(candidate.id),
        `${label}.candidates has duplicate id: ${candidate.id}`,
      );
      candidateIds.add(candidate.id);
      assertString(candidate.sourceAssetId, `${candidateLabel}.sourceAssetId`);
      assert(
        assetRoles.get(candidate.sourceAssetId) === 'source-video',
        `${candidateLabel}.sourceAssetId must reference a source-video asset`,
      );
      validateFrameRange(candidate.sourceRange, `${candidateLabel}.sourceRange`);
      assertConfidence(candidate.confidence, `${candidateLabel}.confidence`);
      if (candidate.verification !== undefined) {
        const verification = asRecord(candidate.verification, `${candidateLabel}.verification`);
        assertExactKeys(verification, `${candidateLabel}.verification`, [
          'method',
          'inlierRatio',
          'reprojectionErrorPx',
        ]);
        assertOneOf(
          verification.method,
          ['normalized-frame-search', 'embedding-search', 'manual'],
          `${candidateLabel}.verification.method`,
        );
        assertConfidence(verification.inlierRatio, `${candidateLabel}.verification.inlierRatio`);
        assertFiniteNumber(
          verification.reprojectionErrorPx,
          `${candidateLabel}.verification.reprojectionErrorPx`,
        );
        assert(
          verification.reprojectionErrorPx >= 0,
          `${candidateLabel}.verification.reprojectionErrorPx must be non-negative`,
        );
      }
    }
    if (shot.selectedCandidateId !== undefined) {
      assertString(shot.selectedCandidateId, `${label}.selectedCandidateId`);
      assert(
        candidateIds.has(shot.selectedCandidateId),
        `${label}.selectedCandidateId does not reference a candidate`,
      );
    }
    if (shot.reframe !== undefined) {
      const reframe = asRecord(shot.reframe, `${label}.reframe`);
      assertExactKeys(reframe, `${label}.reframe`, ['keyframes', 'confidence']);
      validateCropKeyframes(
        reframe.keyframes,
        `${label}.reframe.keyframes`,
        shot.targetRange as FrameRange | undefined,
      );
      assertConfidence(reframe.confidence, `${label}.reframe.confidence`);
    }
    if (shot.grade !== undefined) {
      const grade = asRecord(shot.grade, `${label}.grade`);
      assertExactKeys(grade, `${label}.grade`, ['kind', 'confidence'], ['artifactId']);
      assertConfidence(grade.confidence, `${label}.grade.confidence`);
      validateGrade(
        {
          kind: grade.kind,
          ...(grade.artifactId === undefined ? {} : { artifactId: grade.artifactId }),
        },
        `${label}.grade`,
      );
    }
  }

  const audio = asRecord(understanding.audio, 'EditUnderstanding.audio');
  assertExactKeys(
    audio,
    'EditUnderstanding.audio',
    ['targetAudioUsage', 'transcript', 'musicCandidates'],
    ['beatGrid', 'selectedMusicAssetId'],
  );
  assertOneOf(
    audio.targetAudioUsage,
    ['absent', 'analysis-only', 'authorized-render-source'],
    'EditUnderstanding.audio.targetAudioUsage',
  );
  if (audio.beatGrid !== undefined)
    validateBeatGrid(audio.beatGrid, 'EditUnderstanding.audio.beatGrid');
  assertArray(audio.transcript, 'EditUnderstanding.audio.transcript');
  for (const [index, item] of audio.transcript.entries()) {
    const label = `EditUnderstanding.audio.transcript[${index}]`;
    const segment = asRecord(item, label);
    assertExactKeys(segment, label, ['text', 'startMs', 'endMs', 'confidence']);
    assertString(segment.text, `${label}.text`, 10_000);
    assertFiniteNumber(segment.startMs, `${label}.startMs`);
    assertFiniteNumber(segment.endMs, `${label}.endMs`);
    assert(segment.startMs >= 0 && segment.endMs > segment.startMs, `${label} has invalid timing`);
    assertConfidence(segment.confidence, `${label}.confidence`);
  }
  assertArray(audio.musicCandidates, 'EditUnderstanding.audio.musicCandidates');
  const musicCandidatesByAssetId = new Map<string, UnknownRecord>();
  for (const [index, item] of audio.musicCandidates.entries()) {
    const label = `EditUnderstanding.audio.musicCandidates[${index}]`;
    const candidate = asRecord(item, label);
    assertExactKeys(
      candidate,
      label,
      ['assetId', 'confidence', 'rationale'],
      ['identity', 'excerpt'],
    );
    assertString(candidate.assetId, `${label}.assetId`);
    assert(
      assetRoles.get(candidate.assetId) === 'music',
      `${label}.assetId must reference a music asset`,
    );
    assert(!musicCandidatesByAssetId.has(candidate.assetId), `${label}.assetId is duplicated`);
    musicCandidatesByAssetId.set(candidate.assetId, candidate);
    assertConfidence(candidate.confidence, `${label}.confidence`);
    assertString(candidate.rationale, `${label}.rationale`, 2_048);
    if (candidate.identity !== undefined) {
      validateMusicIdentity(candidate.identity, `${label}.identity`);
    }
    if (candidate.excerpt !== undefined) {
      validateAudioExcerpt(candidate.excerpt, `${label}.excerpt`);
    }
  }
  if (audio.selectedMusicAssetId !== undefined) {
    assertString(audio.selectedMusicAssetId, 'EditUnderstanding.audio.selectedMusicAssetId');
    const selectedMusic = musicCandidatesByAssetId.get(audio.selectedMusicAssetId);
    assert(selectedMusic, 'EditUnderstanding.audio.selectedMusicAssetId is not a music candidate');
    assert(
      selectedMusic.excerpt !== undefined,
      'EditUnderstanding selected music requires an excerpt mapping',
    );
  }

  assertArray(understanding.overlays, 'EditUnderstanding.overlays');
  const overlayIds = new Set<string>();
  for (const [index, item] of understanding.overlays.entries()) {
    const label = `EditUnderstanding.overlays[${index}]`;
    const overlay = asRecord(item, label);
    assertExactKeys(
      overlay,
      label,
      ['id', 'kind', 'targetRange', 'box', 'confidence'],
      ['text', 'graphicAssetId', 'styleToken'],
    );
    assertString(overlay.id, `${label}.id`);
    assert(
      !overlayIds.has(overlay.id),
      `EditUnderstanding.overlays has duplicate id: ${overlay.id}`,
    );
    overlayIds.add(overlay.id);
    assertOneOf(overlay.kind, ['text', 'graphic'], `${label}.kind`);
    validateFrameRange(overlay.targetRange, `${label}.targetRange`);
    validateBox(overlay.box, `${label}.box`);
    assertConfidence(overlay.confidence, `${label}.confidence`);
    if (overlay.styleToken !== undefined) assertString(overlay.styleToken, `${label}.styleToken`);
    if (overlay.kind === 'text') {
      assertString(overlay.text, `${label}.text`, 10_000);
      assert(
        overlay.graphicAssetId === undefined,
        `${label}.graphicAssetId is not allowed for text`,
      );
    } else {
      assertString(overlay.graphicAssetId, `${label}.graphicAssetId`);
      assert(
        assetRoles.get(overlay.graphicAssetId) === 'graphic',
        `${label}.graphicAssetId must reference a graphic asset`,
      );
      assert(overlay.text === undefined, `${label}.text is not allowed for graphics`);
    }
  }

  assertArray(understanding.warnings, 'EditUnderstanding.warnings');
  understanding.warnings.forEach((warning, index) =>
    assertString(warning, `EditUnderstanding.warnings[${index}]`, 2_048),
  );
}

function validateVideoClip(
  value: unknown,
  label: string,
  durationFrames: number,
  renderAssetIds: ReadonlySet<string>,
): asserts value is VideoClip {
  const clip = asRecord(value, label);
  assertOneOf(clip.kind, ['source', 'freeze', 'black'], `${label}.kind`);
  if (clip.kind === 'black') {
    assertExactKeys(clip, label, ['id', 'kind', 'timelineRange']);
  } else if (clip.kind === 'source') {
    assertExactKeys(clip, label, [
      'id',
      'kind',
      'assetId',
      'timelineRange',
      'sourceRange',
      'playbackRate',
      'fit',
      'cropKeyframes',
      'grade',
    ]);
  } else {
    assertExactKeys(clip, label, [
      'id',
      'kind',
      'assetId',
      'timelineRange',
      'sourceFrame',
      'fit',
      'cropKeyframes',
      'grade',
    ]);
  }
  assertString(clip.id, `${label}.id`);
  validateFrameRange(clip.timelineRange, `${label}.timelineRange`);
  assertWithinDuration(clip.timelineRange, durationFrames, `${label}.timelineRange`);
  if (clip.kind === 'black') return;

  assertString(clip.assetId, `${label}.assetId`);
  assert(renderAssetIds.has(clip.assetId), `${label}.assetId is not a render asset`);
  if (clip.kind === 'source') {
    validateFrameRange(clip.sourceRange, `${label}.sourceRange`);
    assertPositiveNumber(clip.playbackRate, `${label}.playbackRate`);
  } else {
    assertInteger(clip.sourceFrame, `${label}.sourceFrame`);
  }
  assertOneOf(clip.fit, ['fit', 'fill', 'crop'], `${label}.fit`);
  validateCropKeyframes(clip.cropKeyframes, `${label}.cropKeyframes`, clip.timelineRange);
  assert(
    clip.fit === 'crop' || clip.cropKeyframes.length === 0,
    `${label} crop keyframes require fit=crop`,
  );
  validateGrade(clip.grade, `${label}.grade`, renderAssetIds);
}

function validateAudioClip(
  value: unknown,
  label: string,
  durationFrames: number,
  renderAssetIds: ReadonlySet<string>,
): asserts value is AudioClip {
  const clip = asRecord(value, label);
  assertExactKeys(
    clip,
    label,
    [
      'id',
      'assetId',
      'timelineRange',
      'sourceRange',
      'playbackRate',
      'role',
      'gainDb',
      'fadeInFrames',
      'fadeOutFrames',
    ],
    ['license'],
  );
  assertString(clip.id, `${label}.id`);
  assertString(clip.assetId, `${label}.assetId`);
  assert(renderAssetIds.has(clip.assetId), `${label}.assetId is not a render asset`);
  validateFrameRange(clip.timelineRange, `${label}.timelineRange`);
  assertWithinDuration(clip.timelineRange, durationFrames, `${label}.timelineRange`);
  validateFrameRange(clip.sourceRange, `${label}.sourceRange`);
  assertPositiveNumber(clip.playbackRate, `${label}.playbackRate`);
  assertOneOf(clip.role, ['source', 'music', 'voiceover', 'sfx', 'sting'], `${label}.role`);
  assertFiniteNumber(clip.gainDb, `${label}.gainDb`);
  assertInteger(clip.fadeInFrames, `${label}.fadeInFrames`);
  assertInteger(clip.fadeOutFrames, `${label}.fadeOutFrames`);
  const duration = clip.timelineRange.endFrameExclusive - clip.timelineRange.startFrame;
  assert(
    clip.fadeInFrames + clip.fadeOutFrames <= duration,
    `${label} fades exceed the clip duration`,
  );
  if (clip.role === 'music') {
    assert(clip.license !== undefined, `${label}.license is required for music`);
  }
  if (clip.license !== undefined) validateMusicLicense(clip.license, `${label}.license`);
}

function validateOverlayClip(
  value: unknown,
  label: string,
  durationFrames: number,
  renderAssetIds: ReadonlySet<string>,
): asserts value is OverlayClip {
  const clip = asRecord(value, label);
  assertExactKeys(
    clip,
    label,
    ['id', 'timelineRange', 'kind', 'templateId', 'box', 'animation'],
    ['text', 'assetId'],
  );
  assertString(clip.id, `${label}.id`);
  validateFrameRange(clip.timelineRange, `${label}.timelineRange`);
  assertWithinDuration(clip.timelineRange, durationFrames, `${label}.timelineRange`);
  assertOneOf(clip.kind, ['text', 'graphic'], `${label}.kind`);
  assertString(clip.templateId, `${label}.templateId`);
  validateBox(clip.box, `${label}.box`);
  assertOneOf(clip.animation, ['none', 'fade', 'pop', 'slide-up'], `${label}.animation`);
  if (clip.kind === 'text') {
    assertString(clip.text, `${label}.text`, 10_000);
    assert(clip.assetId === undefined, `${label}.assetId is not allowed for text`);
  } else {
    assertString(clip.assetId, `${label}.assetId`);
    assert(renderAssetIds.has(clip.assetId), `${label}.assetId is not a render asset`);
    assert(clip.text === undefined, `${label}.text is not allowed for graphics`);
  }
}

interface AudioProgramValidationContext {
  durationFrames: number;
  frameRate: number;
  renderAssetIds: ReadonlySet<string>;
  sourceVideoAssetIds: ReadonlySet<string>;
  audioTrackIds: ReadonlySet<string>;
  audioClipsById: ReadonlyMap<string, AudioClip>;
}

function validateAudioProgram(
  value: unknown,
  label: string,
  context: AudioProgramValidationContext,
): asserts value is AudioProgram {
  const program = asRecord(value, label);
  assertExactKeys(program, label, ['routing', 'events']);
  assertArray(program.routing, `${label}.routing`);
  const routeIds = new Set<string>();
  const routedSources = new Set<string>();
  for (const [index, item] of program.routing.entries()) {
    const routeLabel = `${label}.routing[${index}]`;
    const route = asRecord(item, routeLabel);
    assertExactKeys(route, routeLabel, ['id', 'sourceKind', 'sourceId', 'bus', 'muted', 'gainDb']);
    assertString(route.id, `${routeLabel}.id`);
    assert(!routeIds.has(route.id), `${label}.routing contains duplicate id: ${route.id}`);
    routeIds.add(route.id);
    assertOneOf(route.sourceKind, ['asset-audio', 'track'], `${routeLabel}.sourceKind`);
    assertString(route.sourceId, `${routeLabel}.sourceId`);
    assertOneOf(route.bus, ['program', 'music', 'voiceover', 'effects'], `${routeLabel}.bus`);
    assert(typeof route.muted === 'boolean', `${routeLabel}.muted must be a boolean`);
    assertFiniteNumber(route.gainDb, `${routeLabel}.gainDb`);
    const sourceKey = `${route.sourceKind}:${route.sourceId}`;
    assert(!routedSources.has(sourceKey), `${label}.routing duplicates source: ${sourceKey}`);
    routedSources.add(sourceKey);
    if (route.sourceKind === 'asset-audio') {
      assert(
        context.renderAssetIds.has(route.sourceId),
        `${routeLabel}.sourceId is not a render asset`,
      );
      assert(
        context.sourceVideoAssetIds.has(route.sourceId),
        `${routeLabel}.sourceId is not used by a source video clip`,
      );
    } else {
      assert(
        context.audioTrackIds.has(route.sourceId),
        `${routeLabel}.sourceId is not an audio track`,
      );
    }
  }
  for (const assetId of context.sourceVideoAssetIds) {
    assert(
      routedSources.has(`asset-audio:${assetId}`),
      `${label}.routing must explicitly mix or mute source audio for asset: ${assetId}`,
    );
  }
  for (const trackId of context.audioTrackIds) {
    assert(
      routedSources.has(`track:${trackId}`),
      `${label}.routing must explicitly route audio track: ${trackId}`,
    );
  }

  assertArray(program.events, `${label}.events`);
  const eventIds = new Set<string>();
  const eventClipIds = new Set<string>();
  const silenceWindows: AudioExcerpt[] = [];
  const audibleWindows: AudioExcerpt[] = [];
  const durationMs = (context.durationFrames / context.frameRate) * 1_000;
  const frameDurationMs = 1_000 / context.frameRate;
  for (const [index, item] of program.events.entries()) {
    const eventLabel = `${label}.events[${index}]`;
    const event = asRecord(item, eventLabel);
    assertOneOf(event.kind, ['music', 'sfx', 'sting', 'silence'], `${eventLabel}.kind`);
    if (event.kind === 'silence') {
      assertExactKeys(event, eventLabel, ['id', 'kind', 'targetStartMs', 'targetEndMs']);
    } else if (event.kind === 'music') {
      assertExactKeys(
        event,
        eventLabel,
        [
          'id',
          'kind',
          'clipId',
          'sourceOffsetMs',
          'releasedMasterOffsetMs',
          'releasedMasterGainDb',
          'targetStartMs',
          'targetEndMs',
          'gainDb',
        ],
        ['identity'],
      );
    } else {
      assertExactKeys(
        event,
        eventLabel,
        ['id', 'kind', 'clipId', 'sourceOffsetMs', 'targetStartMs', 'targetEndMs', 'gainDb'],
        ['label'],
      );
    }
    assertString(event.id, `${eventLabel}.id`);
    assert(!eventIds.has(event.id), `${label}.events contains duplicate id: ${event.id}`);
    eventIds.add(event.id);
    assertFiniteNumber(event.targetStartMs, `${eventLabel}.targetStartMs`);
    assertFiniteNumber(event.targetEndMs, `${eventLabel}.targetEndMs`);
    assert(event.targetStartMs >= 0, `${eventLabel}.targetStartMs must be non-negative`);
    assert(
      event.targetEndMs > event.targetStartMs,
      `${eventLabel} must have positive target duration`,
    );
    assert(event.targetEndMs <= durationMs, `${eventLabel} exceeds the plan duration`);
    const window = {
      sourceOffsetMs: 0,
      targetStartMs: event.targetStartMs,
      targetEndMs: event.targetEndMs,
    };
    if (event.kind === 'silence') {
      silenceWindows.push(window);
      continue;
    }

    assertString(event.clipId, `${eventLabel}.clipId`);
    assert(!eventClipIds.has(event.clipId), `${label}.events duplicates clip: ${event.clipId}`);
    eventClipIds.add(event.clipId);
    assertFiniteNumber(event.sourceOffsetMs, `${eventLabel}.sourceOffsetMs`);
    assert(event.sourceOffsetMs >= 0, `${eventLabel}.sourceOffsetMs must be non-negative`);
    if (event.kind === 'music') {
      assertFiniteNumber(event.releasedMasterOffsetMs, `${eventLabel}.releasedMasterOffsetMs`);
      assert(
        event.releasedMasterOffsetMs >= 0,
        `${eventLabel}.releasedMasterOffsetMs must be non-negative`,
      );
      assertFiniteNumber(event.releasedMasterGainDb, `${eventLabel}.releasedMasterGainDb`);
    }
    assertFiniteNumber(event.gainDb, `${eventLabel}.gainDb`);
    if (event.kind === 'music' && event.identity !== undefined) {
      validateMusicIdentity(event.identity, `${eventLabel}.identity`);
    }
    if ((event.kind === 'sfx' || event.kind === 'sting') && event.label !== undefined) {
      assertString(event.label, `${eventLabel}.label`, 1_024);
    }
    const clip = context.audioClipsById.get(event.clipId);
    assert(clip, `${eventLabel}.clipId does not reference an audio clip`);
    assert(clip.role === event.kind, `${eventLabel}.kind does not match its audio clip role`);
    const expectedSourceOffsetMs = (clip.sourceRange.startFrame / context.frameRate) * 1_000;
    const expectedTargetStartMs = (clip.timelineRange.startFrame / context.frameRate) * 1_000;
    const expectedTargetEndMs = (clip.timelineRange.endFrameExclusive / context.frameRate) * 1_000;
    assert(
      Math.abs(event.sourceOffsetMs - expectedSourceOffsetMs) <= frameDurationMs,
      `${eventLabel}.sourceOffsetMs does not match its audio clip`,
    );
    assert(
      Math.abs(event.targetStartMs - expectedTargetStartMs) <= frameDurationMs &&
        Math.abs(event.targetEndMs - expectedTargetEndMs) <= frameDurationMs,
      `${eventLabel} target timing does not match its audio clip`,
    );
    assert(
      Math.abs(event.gainDb - clip.gainDb) < 1e-6,
      `${eventLabel}.gainDb does not match its audio clip`,
    );
    audibleWindows.push(window);
  }
  for (const clip of context.audioClipsById.values()) {
    if (clip.role === 'music' || clip.role === 'sfx' || clip.role === 'sting') {
      assert(
        eventClipIds.has(clip.id),
        `${label}.events must describe timing for ${clip.role} clip: ${clip.id}`,
      );
    }
  }
  for (const silence of silenceWindows) {
    assert(
      !audibleWindows.some(
        (audible) =>
          silence.targetStartMs < audible.targetEndMs &&
          silence.targetEndMs > audible.targetStartMs,
      ),
      `${label}.events silence overlaps an audible event`,
    );
  }
}

export function validateEditPlan(value: unknown): asserts value is EditPlan {
  const plan = asRecord(value, 'EditPlan');
  assertExactKeys(
    plan,
    'EditPlan',
    [
      'schemaVersion',
      'id',
      'understandingId',
      'version',
      'createdAt',
      'frameRate',
      'canvas',
      'durationFrames',
      'lineage',
      'audio',
      'tracks',
    ],
    ['beatGrid'],
  );
  assert(
    plan.schemaVersion === EDIT_PLAN_SCHEMA_VERSION,
    `Unsupported EditPlan schema version: ${String(plan.schemaVersion)}`,
  );
  assertString(plan.id, 'EditPlan.id');
  assertString(plan.understandingId, 'EditPlan.understandingId');
  assertInteger(plan.version, 'EditPlan.version', 1);
  assertIsoTimestamp(plan.createdAt, 'EditPlan.createdAt');
  assertPositiveNumber(plan.frameRate, 'EditPlan.frameRate');
  validateCanvas(plan.canvas, 'EditPlan.canvas');
  assertInteger(plan.durationFrames, 'EditPlan.durationFrames', 1);
  if (plan.beatGrid !== undefined) validateBeatGrid(plan.beatGrid, 'EditPlan.beatGrid');

  const lineage = asRecord(plan.lineage, 'EditPlan.lineage');
  assertExactKeys(lineage, 'EditPlan.lineage', [
    'renderAssetIds',
    'evaluationOnlyAssetIds',
    'targetDerivedRenderAssetIds',
  ]);
  assertUniqueStrings(lineage.renderAssetIds, 'EditPlan.lineage.renderAssetIds');
  assertUniqueStrings(lineage.evaluationOnlyAssetIds, 'EditPlan.lineage.evaluationOnlyAssetIds');
  assertUniqueStrings(
    lineage.targetDerivedRenderAssetIds,
    'EditPlan.lineage.targetDerivedRenderAssetIds',
  );
  const renderAssetIds = new Set(lineage.renderAssetIds);
  const evaluationOnlyAssetIds = new Set(lineage.evaluationOnlyAssetIds);
  for (const id of evaluationOnlyAssetIds) {
    assert(
      !renderAssetIds.has(id),
      `EditPlan lineage asset cannot be render and evaluation-only: ${id}`,
    );
  }
  for (const id of lineage.targetDerivedRenderAssetIds) {
    assert(renderAssetIds.has(id), `EditPlan target-derived asset is not a render asset: ${id}`);
  }

  assertArray(plan.tracks, 'EditPlan.tracks');
  const trackIds = new Set<string>();
  const clipIds = new Set<string>();
  const sourceVideoAssetIds = new Set<string>();
  const audioTrackIds = new Set<string>();
  const audioClipsById = new Map<string, AudioClip>();
  let primaryTracks = 0;
  let musicClips = 0;
  for (const [trackIndex, item] of plan.tracks.entries()) {
    const label = `EditPlan.tracks[${trackIndex}]`;
    const track = asRecord(item, label);
    assertOneOf(track.kind, ['video', 'audio', 'overlay'], `${label}.kind`);
    if (track.kind === 'overlay') {
      assertExactKeys(track, label, ['id', 'kind', 'clips']);
    } else {
      assertExactKeys(track, label, ['id', 'kind', 'role', 'clips']);
    }
    assertString(track.id, `${label}.id`);
    assert(!trackIds.has(track.id), `EditPlan.tracks contains duplicate id: ${track.id}`);
    trackIds.add(track.id);
    if (track.kind === 'video') {
      assertOneOf(track.role, ['primary', 'b-roll'], `${label}.role`);
      if (track.role === 'primary') primaryTracks += 1;
    } else if (track.kind === 'audio') {
      assertOneOf(track.role, ['program', 'music', 'voiceover', 'effects'], `${label}.role`);
      audioTrackIds.add(track.id);
    }
    assertArray(track.clips, `${label}.clips`);
    let previousVideoEnd = 0;
    for (const [clipIndex, clipItem] of track.clips.entries()) {
      const clipLabel = `${label}.clips[${clipIndex}]`;
      if (track.kind === 'video') {
        validateVideoClip(clipItem, clipLabel, plan.durationFrames, renderAssetIds);
        const clip = clipItem as VideoClip;
        if (clip.kind === 'source') sourceVideoAssetIds.add(clip.assetId);
        if (track.role === 'primary') {
          assert(
            clip.timelineRange.startFrame === previousVideoEnd,
            `${clipLabel}.timelineRange must start at frame ${previousVideoEnd} so the primary track is contiguous`,
          );
        } else {
          assert(
            clip.timelineRange.startFrame >= previousVideoEnd,
            `${label}.clips contains overlapping or unordered video clips`,
          );
        }
        previousVideoEnd = clip.timelineRange.endFrameExclusive;
      } else if (track.kind === 'audio') {
        validateAudioClip(clipItem, clipLabel, plan.durationFrames, renderAssetIds);
        const clip = clipItem as AudioClip;
        audioClipsById.set(clip.id, clip);
        if (clip.role === 'music') musicClips += 1;
      } else {
        validateOverlayClip(clipItem, clipLabel, plan.durationFrames, renderAssetIds);
      }
      const clipId = (clipItem as { id: string }).id;
      assert(!clipIds.has(clipId), `EditPlan contains duplicate clip id: ${clipId}`);
      clipIds.add(clipId);
    }
    if (track.kind === 'video' && track.role === 'primary') {
      assert(
        previousVideoEnd === plan.durationFrames,
        `${label}.clips must end at frame ${plan.durationFrames} so the primary track covers the plan duration`,
      );
    }
  }
  assert(primaryTracks === 1, 'EditPlan must contain exactly one primary video track');
  assert(
    musicClips === 0 || plan.beatGrid !== undefined,
    'EditPlan music clips require a beat grid',
  );
  validateAudioProgram(plan.audio, 'EditPlan.audio', {
    durationFrames: plan.durationFrames,
    frameRate: plan.frameRate,
    renderAssetIds,
    sourceVideoAssetIds,
    audioTrackIds,
    audioClipsById,
  });
}

const criticCategories = [
  'technical',
  'mapping',
  'rhythm',
  'framing',
  'text',
  'audio',
  'grade',
  'taste',
  'lineage',
] as const;

function validatePatch(value: unknown, label: string): asserts value is EditPlanPatch {
  const patch = asRecord(value, label);
  assertOneOf(
    patch.op,
    [
      'replace-clip',
      'nudge-cut',
      'set-crop-keyframes',
      'set-overlay',
      'set-audio-mix',
      'set-grade',
    ],
    `${label}.op`,
  );
  const baseKeys = ['id', 'op', 'targetClipId', 'rationale', 'confidence'];
  if (patch.op === 'replace-clip') {
    assertExactKeys(
      patch,
      label,
      [...baseKeys, 'assetId', 'sourceRange', 'playbackRate'],
      ['license'],
    );
    assertString(patch.assetId, `${label}.assetId`);
    validateFrameRange(patch.sourceRange, `${label}.sourceRange`);
    assertPositiveNumber(patch.playbackRate, `${label}.playbackRate`);
    if (patch.license !== undefined) validateMusicLicense(patch.license, `${label}.license`);
  } else if (patch.op === 'nudge-cut') {
    assertExactKeys(patch, label, baseKeys, ['startDeltaFrames', 'endDeltaFrames']);
    if (patch.startDeltaFrames !== undefined) {
      assertSignedInteger(patch.startDeltaFrames, `${label}.startDeltaFrames`);
    }
    if (patch.endDeltaFrames !== undefined) {
      assertSignedInteger(patch.endDeltaFrames, `${label}.endDeltaFrames`);
    }
    assert(
      patch.startDeltaFrames !== undefined || patch.endDeltaFrames !== undefined,
      `${label} requires at least one cut delta`,
    );
    assert(
      (patch.startDeltaFrames ?? 0) !== 0 || (patch.endDeltaFrames ?? 0) !== 0,
      `${label} requires a non-zero cut delta`,
    );
  } else if (patch.op === 'set-crop-keyframes') {
    assertExactKeys(patch, label, [...baseKeys, 'cropKeyframes']);
    validateCropKeyframes(patch.cropKeyframes, `${label}.cropKeyframes`);
  } else if (patch.op === 'set-overlay') {
    assertExactKeys(patch, label, baseKeys, ['text', 'assetId', 'templateId', 'box']);
    if (patch.text !== undefined) assertString(patch.text, `${label}.text`, 10_000);
    if (patch.assetId !== undefined) assertString(patch.assetId, `${label}.assetId`);
    if (patch.templateId !== undefined) assertString(patch.templateId, `${label}.templateId`);
    if (patch.box !== undefined) validateBox(patch.box, `${label}.box`);
    assert(
      patch.text !== undefined ||
        patch.assetId !== undefined ||
        patch.templateId !== undefined ||
        patch.box !== undefined,
      `${label} must change at least one overlay field`,
    );
  } else if (patch.op === 'set-audio-mix') {
    assertExactKeys(patch, label, baseKeys, ['gainDb', 'fadeInFrames', 'fadeOutFrames']);
    if (patch.gainDb !== undefined) assertFiniteNumber(patch.gainDb, `${label}.gainDb`);
    if (patch.fadeInFrames !== undefined)
      assertInteger(patch.fadeInFrames, `${label}.fadeInFrames`);
    if (patch.fadeOutFrames !== undefined)
      assertInteger(patch.fadeOutFrames, `${label}.fadeOutFrames`);
    assert(
      patch.gainDb !== undefined ||
        patch.fadeInFrames !== undefined ||
        patch.fadeOutFrames !== undefined,
      `${label} must change at least one audio field`,
    );
  } else {
    assertExactKeys(patch, label, [...baseKeys, 'grade']);
    validateGrade(patch.grade, `${label}.grade`);
  }
  assertString(patch.id, `${label}.id`);
  assertString(patch.targetClipId, `${label}.targetClipId`);
  assertString(patch.rationale, `${label}.rationale`, 2_048);
  assertConfidence(patch.confidence, `${label}.confidence`);
}

function validatePatchAgainstPlan(patch: EditPlanPatch, plan: EditPlan, label: string): void {
  const renderAssetIds = new Set(plan.lineage.renderAssetIds);
  let target: VideoClip | AudioClip | OverlayClip | undefined;
  let targetKind: EditTrack['kind'] | undefined;
  for (const track of plan.tracks) {
    const found = track.clips.find((clip) => clip.id === patch.targetClipId);
    if (found) {
      target = found;
      targetKind = track.kind;
      break;
    }
  }
  assert(target && targetKind, `${label}.targetClipId does not exist in the plan`);
  if (patch.op === 'replace-clip') {
    assert(
      targetKind === 'video' || targetKind === 'audio',
      `${label} cannot replace an overlay clip`,
    );
    assert(renderAssetIds.has(patch.assetId), `${label}.assetId is not a render asset`);
    if (targetKind === 'audio' && (target as AudioClip).role === 'music') {
      assert(patch.license !== undefined, `${label}.license is required when replacing music`);
    }
  } else if (patch.op === 'nudge-cut') {
    assert(targetKind === 'video', `${label} can only target a video clip`);
  } else if (patch.op === 'set-crop-keyframes') {
    assert(targetKind === 'video', `${label} can only target a video clip`);
    assert((target as VideoClip).kind !== 'black', `${label} cannot crop a black clip`);
    validateCropKeyframes(patch.cropKeyframes, `${label}.cropKeyframes`, target.timelineRange);
  } else if (patch.op === 'set-overlay') {
    assert(targetKind === 'overlay', `${label} can only target an overlay clip`);
    if (patch.assetId !== undefined) {
      assert(renderAssetIds.has(patch.assetId), `${label}.assetId is not a render asset`);
    }
  } else if (patch.op === 'set-audio-mix') {
    assert(targetKind === 'audio', `${label} can only target an audio clip`);
  } else {
    assert(targetKind === 'video', `${label} can only target a video clip`);
    assert((target as VideoClip).kind !== 'black', `${label} cannot grade a black clip`);
    validateGrade(patch.grade, `${label}.grade`, renderAssetIds);
  }
}

export function validateCriticReport(
  value: unknown,
  plan?: EditPlan,
): asserts value is CriticReport | LegacyCriticReportV1 {
  if (plan !== undefined) validateEditPlan(plan);
  const report = asRecord(value, 'CriticReport');
  const isCurrentSchema = report.schemaVersion === CRITIC_REPORT_SCHEMA_VERSION;
  const isLegacySchema = report.schemaVersion === LEGACY_CRITIC_REPORT_SCHEMA_VERSION;
  assert(
    isCurrentSchema || isLegacySchema,
    `Unsupported CriticReport schema version: ${String(report.schemaVersion)}`,
  );
  const reportKeys = [
    'schemaVersion',
    'id',
    'planId',
    'planVersion',
    'renderArtifactId',
    'createdAt',
    'mode',
    'verdict',
    'scores',
    'findings',
    'worstWindows',
    'patches',
  ];
  if (isCurrentSchema) reportKeys.push('tasteStatus');
  assertExactKeys(report, 'CriticReport', reportKeys, isCurrentSchema ? ['tasteEvidenceRef'] : []);
  assertString(report.id, 'CriticReport.id');
  assertString(report.planId, 'CriticReport.planId');
  assertInteger(report.planVersion, 'CriticReport.planVersion', 1);
  assertString(report.renderArtifactId, 'CriticReport.renderArtifactId');
  assertIsoTimestamp(report.createdAt, 'CriticReport.createdAt');
  assertOneOf(report.mode, ['deterministic', 'multimodal', 'combined'], 'CriticReport.mode');
  assertOneOf(report.verdict, ['pass', 'revise', 'fail'], 'CriticReport.verdict');

  const scores = asRecord(report.scores, 'CriticReport.scores');
  assertExactKeys(scores, 'CriticReport.scores', [
    'technical',
    'mapping',
    'rhythm',
    'framing',
    'text',
    'audio',
    'grade',
    'taste',
  ]);
  for (const key of Object.keys(scores).filter((key) => key !== 'taste')) {
    assertConfidence(scores[key], `CriticReport.scores.${key}`);
  }
  if (isLegacySchema) {
    assertConfidence(scores.taste, 'CriticReport.scores.taste');
  } else {
    assertOneOf(
      report.tasteStatus,
      ['not-evaluated', 'evaluated-blinded'],
      'CriticReport.tasteStatus',
    );
    if (report.tasteStatus === 'not-evaluated') {
      assert(
        scores.taste === null,
        'CriticReport.scores.taste must be null when tasteStatus is not-evaluated',
      );
      assert(
        report.tasteEvidenceRef === undefined,
        'CriticReport.tasteEvidenceRef is not allowed when tasteStatus is not-evaluated',
      );
    } else {
      assertConfidence(scores.taste, 'CriticReport.scores.taste');
      assertString(report.tasteEvidenceRef, 'CriticReport.tasteEvidenceRef');
    }
  }

  assertArray(report.findings, 'CriticReport.findings');
  const findingIds = new Set<string>();
  let errorCount = 0;
  for (const [index, item] of report.findings.entries()) {
    const label = `CriticReport.findings[${index}]`;
    const finding = asRecord(item, label);
    assertExactKeys(finding, label, ['id', 'severity', 'category', 'message'], ['evidence']);
    assertString(finding.id, `${label}.id`);
    assert(
      !findingIds.has(finding.id),
      `CriticReport.findings contains duplicate id: ${finding.id}`,
    );
    findingIds.add(finding.id);
    assertOneOf(finding.severity, ['error', 'warning', 'suggestion'], `${label}.severity`);
    if (finding.severity === 'error') errorCount += 1;
    assertOneOf(finding.category, criticCategories, `${label}.category`);
    assertString(finding.message, `${label}.message`, 10_000);
    if (finding.evidence !== undefined) {
      const evidence = asRecord(finding.evidence, `${label}.evidence`);
      assertExactKeys(
        evidence,
        `${label}.evidence`,
        ['artifactId'],
        ['timelineRange', 'observed', 'expected'],
      );
      assertString(evidence.artifactId, `${label}.evidence.artifactId`);
      if (evidence.timelineRange !== undefined) {
        validateFrameRange(evidence.timelineRange, `${label}.evidence.timelineRange`);
        if (plan) {
          assertWithinDuration(
            evidence.timelineRange,
            plan.durationFrames,
            `${label}.evidence.timelineRange`,
          );
        }
      }
      if (evidence.observed !== undefined) {
        assertString(evidence.observed, `${label}.evidence.observed`, 10_000);
      }
      if (evidence.expected !== undefined) {
        assertString(evidence.expected, `${label}.evidence.expected`, 10_000);
      }
    }
  }

  assertArray(report.worstWindows, 'CriticReport.worstWindows');
  for (const [index, item] of report.worstWindows.entries()) {
    const label = `CriticReport.worstWindows[${index}]`;
    const window = asRecord(item, label);
    assertExactKeys(window, label, ['timelineRange', 'score', 'metric', 'findingIds']);
    validateFrameRange(window.timelineRange, `${label}.timelineRange`);
    if (plan)
      assertWithinDuration(window.timelineRange, plan.durationFrames, `${label}.timelineRange`);
    assertConfidence(window.score, `${label}.score`);
    assertOneOf(window.metric, criticCategories.slice(0, -1), `${label}.metric`);
    assertUniqueStrings(window.findingIds, `${label}.findingIds`);
    for (const findingId of window.findingIds) {
      assert(findingIds.has(findingId), `${label}.findingIds references an unknown finding`);
    }
  }

  assertArray(report.patches, 'CriticReport.patches');
  const patchIds = new Set<string>();
  for (const [index, item] of report.patches.entries()) {
    const label = `CriticReport.patches[${index}]`;
    validatePatch(item, label);
    const patch = item as EditPlanPatch;
    assert(!patchIds.has(patch.id), `CriticReport.patches contains duplicate id: ${patch.id}`);
    patchIds.add(patch.id);
    if (plan) validatePatchAgainstPlan(patch, plan, label);
  }

  if (report.verdict === 'pass') {
    assert(errorCount === 0, 'A passing CriticReport cannot contain error findings');
    assert(report.patches.length === 0, 'A passing CriticReport cannot contain patches');
  }
  if (report.verdict === 'revise') {
    assert(report.patches.length > 0, 'A revise CriticReport requires at least one patch');
  }
  if (plan) {
    assert(report.planId === plan.id, 'CriticReport.planId does not match the plan');
    assert(report.planVersion === plan.version, 'CriticReport.planVersion does not match the plan');
  }
}
