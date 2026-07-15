import {
  type CreateNodeVideoArtifactInput,
  type CreateNodeVideoRecipeInput,
  NODE_VIDEO_CHECKPOINT_VERSION,
  type NodeVideoArtifact,
  type NodeVideoAsset,
  type NodeVideoCheckpoint,
  type NodeVideoCheckpointAdapter,
  type NodeVideoEvent,
  type NodeVideoRecipePatch,
  type NodeVideoRecipeSettings,
  type NodeVideoRecipeVersion,
  type NodeVideoSpan,
  type NodeVideoStage,
  type ProposalStatus,
  type RegisterNodeVideoAssetInput,
  type RuntimeClock,
  type StartNodeVideoStageInput,
  type StorageLike,
} from './contracts';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const asFiniteNumber = (value: number, label: string, minimum = 0): void => {
  assert(Number.isFinite(value), `${label} must be a finite number`);
  assert(value >= minimum, `${label} must be at least ${minimum}`);
};

const asIsoTimestamp = (value: string, label: string): number => {
  const timestamp = Date.parse(value);
  assert(Number.isFinite(timestamp), `${label} must return an ISO-compatible timestamp`);
  return timestamp;
};

const normalizeScope = (scope: string): string =>
  scope
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'id';

export interface DeterministicClockOptions {
  startAt?: string;
  stepMs?: number;
  seed?: string;
}

export class DeterministicRuntimeClock implements RuntimeClock {
  private timestampMs: number;
  private readonly stepMs: number;
  private readonly seed: string;
  private idSequence = 0;

  constructor(options: DeterministicClockOptions = {}) {
    this.timestampMs = asIsoTimestamp(
      options.startAt ?? '2026-01-01T00:00:00.000Z',
      'Deterministic clock startAt',
    );
    this.stepMs = options.stepMs ?? 100;
    asFiniteNumber(this.stepMs, 'Deterministic clock stepMs', 1);
    this.seed = normalizeScope(options.seed ?? 'fixture');
  }

  now(): string {
    const current = new Date(this.timestampMs).toISOString();
    this.timestampMs += this.stepMs;
    return current;
  }

  nextId(scope: string): string {
    this.idSequence += 1;
    return `${normalizeScope(scope)}_${this.seed}_${String(this.idSequence).padStart(4, '0')}`;
  }
}

export const createDeterministicClock = (
  options?: DeterministicClockOptions,
): DeterministicRuntimeClock => new DeterministicRuntimeClock(options);

export class BrowserRuntimeClock implements RuntimeClock {
  private idSequence = 0;

  now(): string {
    return new Date().toISOString();
  }

  nextId(scope: string): string {
    this.idSequence += 1;
    const randomUuid = (
      globalThis as typeof globalThis & {
        crypto?: { randomUUID?: () => string };
      }
    ).crypto?.randomUUID?.();
    const suffix = randomUuid ?? `${Date.now().toString(36)}_${this.idSequence.toString(36)}`;
    return `${normalizeScope(scope)}_${suffix}`;
  }
}

export class LocalStorageCheckpointAdapter implements NodeVideoCheckpointAdapter {
  private readonly storage: StorageLike;
  private readonly namespace: string;

  constructor(storage?: StorageLike, namespace = 'nodevideo:checkpoint') {
    const browserStorage = (globalThis as typeof globalThis & { localStorage?: StorageLike })
      .localStorage;
    const selectedStorage = storage ?? browserStorage;
    assert(selectedStorage, 'localStorage is unavailable; pass a StorageLike adapter explicitly');
    this.storage = selectedStorage;
    this.namespace = namespace;
  }

  load(runtimeId: string): NodeVideoCheckpoint | null {
    const serialized = this.storage.getItem(this.key(runtimeId));
    if (serialized === null) {
      return null;
    }

    const parsed = JSON.parse(serialized) as unknown;
    validateCheckpoint(parsed);
    return clone(parsed);
  }

  save(checkpoint: NodeVideoCheckpoint): void {
    validateCheckpoint(checkpoint);
    this.storage.setItem(this.key(checkpoint.runtimeId), JSON.stringify(checkpoint));
  }

  remove(runtimeId: string): void {
    this.storage.removeItem(this.key(runtimeId));
  }

  private key(runtimeId: string): string {
    return `${this.namespace}:${runtimeId}`;
  }
}

const validateEventSequence = (events: NodeVideoEvent[], runtimeId?: string): void => {
  let priorTimestamp = Number.NEGATIVE_INFINITY;
  const eventIds = new Set<string>();

  events.forEach((event, index) => {
    assert(event.sequence === index + 1, `Event ${index} has a non-contiguous sequence`);
    assert(!eventIds.has(event.id), `Duplicate event id: ${event.id}`);
    eventIds.add(event.id);
    if (runtimeId) {
      assert(event.runtimeId === runtimeId, `Event ${event.id} belongs to another runtime`);
    }
    const timestamp = asIsoTimestamp(event.timestamp, `Event ${event.id} timestamp`);
    assert(timestamp >= priorTimestamp, `Event ${event.id} moves backward in time`);
    priorTimestamp = timestamp;
  });
};

export function validateCheckpoint(value: unknown): asserts value is NodeVideoCheckpoint {
  assert(typeof value === 'object' && value !== null, 'Checkpoint must be an object');
  const checkpoint = value as Partial<NodeVideoCheckpoint>;
  assert(
    checkpoint.schemaVersion === NODE_VIDEO_CHECKPOINT_VERSION,
    `Unsupported checkpoint schema version: ${String(checkpoint.schemaVersion)}`,
  );
  assert(
    typeof checkpoint.runtimeId === 'string' && checkpoint.runtimeId.length > 0,
    'Missing runtime id',
  );
  assert(
    typeof checkpoint.traceId === 'string' && checkpoint.traceId.length > 0,
    'Missing trace id',
  );
  asIsoTimestamp(checkpoint.createdAt ?? '', 'Checkpoint createdAt');
  asIsoTimestamp(checkpoint.updatedAt ?? '', 'Checkpoint updatedAt');
  assert(Array.isArray(checkpoint.assets), 'Checkpoint assets must be an array');
  assert(Array.isArray(checkpoint.recipeVersions), 'Checkpoint recipeVersions must be an array');
  assert(Array.isArray(checkpoint.stages), 'Checkpoint stages must be an array');
  assert(Array.isArray(checkpoint.artifacts), 'Checkpoint artifacts must be an array');
  assert(Array.isArray(checkpoint.spans), 'Checkpoint spans must be an array');
  assert(Array.isArray(checkpoint.events), 'Checkpoint events must be an array');
  validateEventSequence(checkpoint.events, checkpoint.runtimeId);
  assert(
    checkpoint.nextSequence === checkpoint.events.length + 1,
    'Checkpoint nextSequence does not follow its event log',
  );

  if (checkpoint.activeRecipeId !== undefined || checkpoint.activeRecipeVersion !== undefined) {
    assert(
      typeof checkpoint.activeRecipeId === 'string' &&
        typeof checkpoint.activeRecipeVersion === 'number',
      'Active recipe id and version must be set together',
    );
    assert(
      checkpoint.recipeVersions.some(
        (recipe) =>
          recipe.recipeId === checkpoint.activeRecipeId &&
          recipe.version === checkpoint.activeRecipeVersion,
      ),
      'Active recipe version does not exist',
    );
  }
}

export const assertAppendOnlyEventLog = (
  previous: readonly NodeVideoEvent[],
  next: readonly NodeVideoEvent[],
): void => {
  assert(next.length >= previous.length, 'Event log was truncated');
  previous.forEach((event, index) => {
    assert(
      JSON.stringify(event) === JSON.stringify(next[index]),
      `Event log entry ${index + 1} was changed`,
    );
  });
  validateEventSequence([...next]);
};

export const isAppendOnlyEventLog = (
  previous: readonly NodeVideoEvent[],
  next: readonly NodeVideoEvent[],
): boolean => {
  try {
    assertAppendOnlyEventLog(previous, next);
    return true;
  } catch {
    return false;
  }
};

const validateSettings = (settings: NodeVideoRecipeSettings): void => {
  asFiniteNumber(settings.alignment.offsetMs, 'Alignment offset', Number.NEGATIVE_INFINITY);
  asFiniteNumber(settings.alignment.maxSearchMs, 'Alignment max search');
  asFiniteNumber(settings.difference.scoreThreshold, 'Difference score threshold');
  assert(settings.difference.scoreThreshold <= 1, 'Difference score threshold cannot exceed 1');
  asFiniteNumber(settings.difference.minimumSegmentMs, 'Difference minimum segment');
  asFiniteNumber(settings.render.fps, 'Render fps', 1);
  settings.focusWindows.forEach((range, index) => {
    asFiniteNumber(range.startMs, `Focus window ${index} start`);
    asFiniteNumber(range.endMs, `Focus window ${index} end`);
    assert(range.endMs > range.startMs, `Focus window ${index} must have positive duration`);
  });
};

export const applyNodeVideoRecipePatch = (
  settings: NodeVideoRecipeSettings,
  patch: NodeVideoRecipePatch,
): NodeVideoRecipeSettings => {
  const next = clone(settings);
  if (patch.alignmentOffsetMs !== undefined) {
    next.alignment.offsetMs = patch.alignmentOffsetMs;
  }
  if (patch.differenceScoreThreshold !== undefined) {
    next.difference.scoreThreshold = patch.differenceScoreThreshold;
  }
  if (patch.minimumSegmentMs !== undefined) {
    next.difference.minimumSegmentMs = patch.minimumSegmentMs;
  }
  if (patch.renderLayout !== undefined) {
    next.render.layout = patch.renderLayout;
  }
  if (patch.focusWindows !== undefined) {
    next.focusWindows = clone(patch.focusWindows);
  }
  validateSettings(next);
  return next;
};

export interface LocalNodeVideoRuntimeOptions {
  clock?: RuntimeClock;
  checkpoint?: NodeVideoCheckpoint;
}

type EventDraft = NodeVideoEvent extends infer Event
  ? Event extends NodeVideoEvent
    ? Pick<Event, 'type' | 'payload'>
    : never
  : never;

export class LocalNodeVideoRuntime {
  protected readonly clock: RuntimeClock;
  protected state: NodeVideoCheckpoint;

  constructor(options: LocalNodeVideoRuntimeOptions = {}) {
    this.clock = options.clock ?? new BrowserRuntimeClock();

    if (options.checkpoint) {
      validateCheckpoint(options.checkpoint);
      this.state = clone(options.checkpoint);
      return;
    }

    const createdAt = this.clock.now();
    asIsoTimestamp(createdAt, 'Runtime clock');
    const runtimeId = this.clock.nextId('runtime');
    const traceId = this.clock.nextId('trace');
    this.state = {
      schemaVersion: NODE_VIDEO_CHECKPOINT_VERSION,
      runtimeId,
      traceId,
      createdAt,
      updatedAt: createdAt,
      assets: [],
      recipeVersions: [],
      stages: [],
      artifacts: [],
      spans: [],
      events: [],
      nextSequence: 1,
    };
    this.appendEvent({ type: 'runtime.created', payload: { traceId } });
  }

  snapshot(): NodeVideoCheckpoint {
    return clone(this.state);
  }

  get activeRecipe(): NodeVideoRecipeVersion | undefined {
    const { activeRecipeId, activeRecipeVersion } = this.state;
    const recipe = this.state.recipeVersions.find(
      (candidate) =>
        candidate.recipeId === activeRecipeId && candidate.version === activeRecipeVersion,
    );
    return recipe ? clone(recipe) : undefined;
  }

  registerAsset(input: RegisterNodeVideoAssetInput): NodeVideoAsset {
    assert(input.role === 'reference' || input.role === 'practice', 'Unknown asset role');
    assert(input.filename.trim().length > 0, 'Asset filename is required');
    assert(input.mimeType.startsWith('video/'), 'Asset mimeType must be a video type');
    asFiniteNumber(input.sizeBytes, 'Asset size');
    asFiniteNumber(input.durationMs, 'Asset duration', 1);
    asFiniteNumber(input.width, 'Asset width', 1);
    asFiniteNumber(input.height, 'Asset height', 1);
    asFiniteNumber(input.fps, 'Asset fps', 1);

    const asset: NodeVideoAsset = {
      ...clone(input),
      id: this.nextUniqueId('asset'),
      kind: 'video',
      createdAt: this.nextTimestamp(),
    };
    this.state.assets.push(asset);
    this.appendEvent({
      type: 'asset.registered',
      payload: { assetId: asset.id, role: asset.role },
    });
    return clone(asset);
  }

  createRecipe(input: CreateNodeVideoRecipeInput): NodeVideoRecipeVersion {
    const reference = this.requireAsset(input.referenceAssetId);
    const practice = this.requireAsset(input.practiceAssetId);
    assert(reference.role === 'reference', 'Recipe reference asset has the wrong role');
    assert(practice.role === 'practice', 'Recipe practice asset has the wrong role');
    assert(input.name.trim().length > 0, 'Recipe name is required');
    validateSettings(input.settings);

    const recipeId = this.nextUniqueId('recipe');
    const recipe: NodeVideoRecipeVersion = {
      id: this.nextUniqueId('recipe_version'),
      recipeId,
      version: 1,
      name: input.name,
      referenceAssetId: reference.id,
      practiceAssetId: practice.id,
      settings: clone(input.settings),
      reason: 'initial',
      createdAt: this.nextTimestamp(),
    };
    this.state.recipeVersions.push(recipe);
    this.state.activeRecipeId = recipeId;
    this.state.activeRecipeVersion = 1;
    this.appendRecipeVersionEvent(recipe);
    return clone(recipe);
  }

  startStage(input: StartNodeVideoStageInput): NodeVideoStage {
    this.requireRecipeVersion(input.recipeId, input.recipeVersion);
    assert(
      !this.state.stages.some(
        (stage) =>
          stage.kind === input.kind &&
          stage.recipeId === input.recipeId &&
          stage.recipeVersion === input.recipeVersion &&
          stage.status === 'running',
      ),
      `${input.kind} already has a running stage`,
    );
    if (input.parentSpanId) {
      assert(
        this.state.spans.some((span) => span.id === input.parentSpanId),
        'Parent span not found',
      );
    }

    const startedAt = this.nextTimestamp();
    const span: NodeVideoSpan = {
      id: this.nextUniqueId('span'),
      traceId: this.state.traceId,
      parentSpanId: input.parentSpanId,
      name: input.label,
      stageKind: input.kind,
      status: 'running',
      startedAt,
      attributes: {
        mode: input.mode,
        recipeId: input.recipeId,
        recipeVersion: input.recipeVersion,
      },
      artifactIds: [],
    };
    const stage: NodeVideoStage = {
      id: this.nextUniqueId('stage'),
      kind: input.kind,
      label: input.label,
      mode: input.mode,
      status: 'running',
      recipeId: input.recipeId,
      recipeVersion: input.recipeVersion,
      spanId: span.id,
      progress: 0,
      artifactIds: [],
      message: input.message,
      startedAt,
    };
    this.state.spans.push(span);
    this.state.stages.push(stage);
    this.appendEvent({
      type: 'stage.started',
      payload: { stageId: stage.id, stageKind: stage.kind, spanId: span.id },
    });
    return clone(stage);
  }

  createArtifact(input: CreateNodeVideoArtifactInput): NodeVideoArtifact {
    const stage = this.requireStage(input.stageId);
    assert(stage.status === 'running', 'Artifacts can only be added to a running stage');
    assert(
      stage.recipeId === input.recipeId && stage.recipeVersion === input.recipeVersion,
      'Artifact recipe does not match its stage',
    );
    this.requireRecipeVersion(input.recipeId, input.recipeVersion);

    if (input.kind === 'recipe-proposal') {
      assert(
        input.baseVersion === input.recipeVersion,
        'Proposal base version must match its stage',
      );
      applyNodeVideoRecipePatch(
        this.requireRecipeVersion(input.recipeId, input.baseVersion).settings,
        input.patch,
      );
    }

    const artifact = {
      ...clone(input),
      id: this.nextUniqueId('artifact'),
      createdAt: this.nextTimestamp(),
    } as NodeVideoArtifact;
    this.state.artifacts.push(artifact);
    stage.artifactIds.push(artifact.id);
    const span = this.requireSpan(stage.spanId);
    span.artifactIds.push(artifact.id);
    this.appendEvent({
      type: 'artifact.created',
      payload: {
        artifactId: artifact.id,
        artifactKind: artifact.kind,
        stageId: stage.id,
      },
    });
    return clone(artifact);
  }

  completeStage(stageId: string, message?: string): NodeVideoStage {
    return this.finishStage(stageId, 'completed', message);
  }

  awaitReview(stageId: string, message?: string): NodeVideoStage {
    return this.finishStage(stageId, 'awaiting-review', message);
  }

  failStage(stageId: string, message: string): NodeVideoStage {
    assert(message.trim().length > 0, 'Failure message is required');
    return this.finishStage(stageId, 'failed', message);
  }

  proposalStatus(proposalArtifactId: string): ProposalStatus {
    this.requireProposal(proposalArtifactId);
    const decision = [...this.state.events]
      .reverse()
      .find(
        (event) =>
          (event.type === 'proposal.accepted' || event.type === 'proposal.declined') &&
          event.payload.proposalArtifactId === proposalArtifactId,
      );
    if (decision?.type === 'proposal.accepted') return 'accepted';
    if (decision?.type === 'proposal.declined') return 'declined';
    return 'pending';
  }

  acceptProposal(proposalArtifactId: string, note?: string): NodeVideoRecipeVersion {
    const proposal = this.requireProposal(proposalArtifactId);
    assert(this.proposalStatus(proposalArtifactId) === 'pending', 'Proposal is already decided');
    assert(
      this.state.activeRecipeId === proposal.recipeId &&
        this.state.activeRecipeVersion === proposal.baseVersion,
      'Proposal is stale relative to the active recipe version',
    );
    const base = this.requireRecipeVersion(proposal.recipeId, proposal.baseVersion);
    const version = this.nextRecipeVersion(proposal.recipeId);
    const recipe: NodeVideoRecipeVersion = {
      ...clone(base),
      id: this.nextUniqueId('recipe_version'),
      version,
      settings: applyNodeVideoRecipePatch(base.settings, proposal.patch),
      reason: 'proposal',
      parentVersion: base.version,
      proposalArtifactId: proposal.id,
      createdAt: this.nextTimestamp(),
    };
    this.state.recipeVersions.push(recipe);
    this.state.activeRecipeId = recipe.recipeId;
    this.state.activeRecipeVersion = recipe.version;
    this.appendRecipeVersionEvent(recipe);
    this.appendEvent({
      type: 'proposal.accepted',
      payload: { proposalArtifactId, createdVersion: version, ...(note ? { note } : {}) },
    });
    return clone(recipe);
  }

  declineProposal(proposalArtifactId: string, note?: string): NodeVideoCheckpoint {
    this.requireProposal(proposalArtifactId);
    assert(this.proposalStatus(proposalArtifactId) === 'pending', 'Proposal is already decided');
    this.appendEvent({
      type: 'proposal.declined',
      payload: { proposalArtifactId, ...(note ? { note } : {}) },
    });
    return this.snapshot();
  }

  restoreVersion(recipeId: string, sourceVersion: number, note?: string): NodeVideoRecipeVersion {
    const source = this.requireRecipeVersion(recipeId, sourceVersion);
    const version = this.nextRecipeVersion(recipeId);
    const recipe: NodeVideoRecipeVersion = {
      ...clone(source),
      id: this.nextUniqueId('recipe_version'),
      version,
      reason: 'restore',
      parentVersion:
        this.state.activeRecipeId === recipeId ? this.state.activeRecipeVersion : undefined,
      restoredFromVersion: sourceVersion,
      proposalArtifactId: undefined,
      createdAt: this.nextTimestamp(),
    };
    this.state.recipeVersions.push(recipe);
    this.state.activeRecipeId = recipeId;
    this.state.activeRecipeVersion = version;
    this.appendRecipeVersionEvent(recipe);
    this.appendEvent({
      type: 'recipe.version.restored',
      payload: { recipeId, sourceVersion, createdVersion: version, ...(note ? { note } : {}) },
    });
    return clone(recipe);
  }

  saveCheckpoint(adapter: NodeVideoCheckpointAdapter): NodeVideoCheckpoint {
    const checkpoint = this.snapshot();
    adapter.save(checkpoint);
    return checkpoint;
  }

  static fromCheckpoint(
    checkpoint: NodeVideoCheckpoint,
    options: Omit<LocalNodeVideoRuntimeOptions, 'checkpoint'> = {},
  ): LocalNodeVideoRuntime {
    return new LocalNodeVideoRuntime({ ...options, checkpoint });
  }

  static load(
    adapter: NodeVideoCheckpointAdapter,
    runtimeId: string,
    options: Omit<LocalNodeVideoRuntimeOptions, 'checkpoint'> = {},
  ): LocalNodeVideoRuntime | null {
    const checkpoint = adapter.load(runtimeId);
    return checkpoint ? LocalNodeVideoRuntime.fromCheckpoint(checkpoint, options) : null;
  }

  protected findArtifact<Kind extends NodeVideoArtifact['kind']>(
    kind: Kind,
  ): Extract<NodeVideoArtifact, { kind: Kind }> | undefined {
    const artifact = this.state.artifacts.find((candidate) => candidate.kind === kind);
    return artifact as Extract<NodeVideoArtifact, { kind: Kind }> | undefined;
  }

  protected allocateId(scope: string): string {
    return this.nextUniqueId(scope);
  }

  private finishStage(
    stageId: string,
    status: 'completed' | 'awaiting-review' | 'failed',
    message?: string,
  ): NodeVideoStage {
    const stage = this.requireStage(stageId);
    assert(stage.status === 'running', 'Only a running stage can be finished');
    const endedAt = this.nextTimestamp();
    stage.status = status;
    stage.progress =
      status === 'completed' ? 1 : status === 'awaiting-review' ? 0.95 : stage.progress;
    stage.endedAt = endedAt;
    stage.message = message ?? stage.message;
    const span = this.requireSpan(stage.spanId);
    span.status = status === 'failed' ? 'error' : 'ok';
    span.endedAt = endedAt;

    if (status === 'failed') {
      this.appendEvent({
        type: 'stage.failed',
        payload: { stageId, spanId: span.id, message: message ?? 'Stage failed' },
      });
    } else if (status === 'awaiting-review') {
      this.appendEvent({
        type: 'stage.awaiting-review',
        payload: { stageId, artifactIds: [...stage.artifactIds], spanId: span.id },
      });
    } else {
      this.appendEvent({
        type: 'stage.completed',
        payload: { stageId, artifactIds: [...stage.artifactIds], spanId: span.id },
      });
    }
    return clone(stage);
  }

  private appendRecipeVersionEvent(recipe: NodeVideoRecipeVersion): void {
    this.appendEvent({
      type: 'recipe.version.created',
      payload: {
        recipeId: recipe.recipeId,
        recipeVersionId: recipe.id,
        version: recipe.version,
        reason: recipe.reason,
      },
    });
  }

  private appendEvent(draft: EventDraft): void {
    const event = {
      ...clone(draft),
      id: this.nextUniqueId('event'),
      runtimeId: this.state.runtimeId,
      sequence: this.state.nextSequence,
      timestamp: this.nextTimestamp(),
    } as NodeVideoEvent;
    this.state.events.push(event);
    this.state.nextSequence += 1;
    this.state.updatedAt = event.timestamp;
  }

  private nextTimestamp(): string {
    const candidate = this.clock.now();
    const candidateMs = asIsoTimestamp(candidate, 'Runtime clock');
    const floorMs = asIsoTimestamp(this.state.updatedAt, 'Runtime updatedAt');
    return new Date(candidateMs > floorMs ? candidateMs : floorMs + 1).toISOString();
  }

  private nextUniqueId(scope: string): string {
    const existingIds = new Set<string>([
      this.state?.runtimeId,
      this.state?.traceId,
      ...(this.state?.assets.map(({ id }) => id) ?? []),
      ...(this.state?.recipeVersions.map(({ id }) => id) ?? []),
      ...(this.state?.stages.map(({ id }) => id) ?? []),
      ...(this.state?.artifacts.map(({ id }) => id) ?? []),
      ...(this.state?.spans.map(({ id }) => id) ?? []),
      ...(this.state?.events.map(({ id }) => id) ?? []),
    ]);
    for (let attempts = 0; attempts < 10_000; attempts += 1) {
      const candidate = this.clock.nextId(scope);
      if (!existingIds.has(candidate)) return candidate;
    }
    throw new Error(`Clock could not produce a unique ${scope} id`);
  }

  private requireAsset(assetId: string): NodeVideoAsset {
    const asset = this.state.assets.find((candidate) => candidate.id === assetId);
    assert(asset, `Asset not found: ${assetId}`);
    return asset;
  }

  private requireRecipeVersion(recipeId: string, version: number): NodeVideoRecipeVersion {
    const recipe = this.state.recipeVersions.find(
      (candidate) => candidate.recipeId === recipeId && candidate.version === version,
    );
    assert(recipe, `Recipe ${recipeId} version ${version} not found`);
    return recipe;
  }

  private requireStage(stageId: string): NodeVideoStage {
    const stage = this.state.stages.find((candidate) => candidate.id === stageId);
    assert(stage, `Stage not found: ${stageId}`);
    return stage;
  }

  private requireSpan(spanId: string): NodeVideoSpan {
    const span = this.state.spans.find((candidate) => candidate.id === spanId);
    assert(span, `Span not found: ${spanId}`);
    return span;
  }

  private requireProposal(
    artifactId: string,
  ): Extract<NodeVideoArtifact, { kind: 'recipe-proposal' }> {
    const artifact = this.state.artifacts.find((candidate) => candidate.id === artifactId);
    assert(artifact?.kind === 'recipe-proposal', `Proposal not found: ${artifactId}`);
    return artifact;
  }

  private nextRecipeVersion(recipeId: string): number {
    const versions = this.state.recipeVersions
      .filter((recipe) => recipe.recipeId === recipeId)
      .map((recipe) => recipe.version);
    assert(versions.length > 0, `Recipe not found: ${recipeId}`);
    return Math.max(...versions) + 1;
  }
}
