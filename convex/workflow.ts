import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { type MutationCtx, internalMutation, internalQuery } from './_generated/server';
import {
  assertBoundedString,
  assertIdempotentInput,
  assertLeaseDuration,
  assertSha256Digest,
  boundedCanonicalJson,
  sha256Digest,
} from './lib/durability';
import { appendJobEvent, requireJob } from './lib/persistence';
import { stageName } from './validators';

export const STAGES = [
  'validate_inputs',
  'ingest_reference',
  'learn_creator_profile',
  'normalize_media',
  'align_reference_song',
  'extract_reference_motion',
  'analyze_takes',
  'ground_subjects',
  'interpret_production',
  'match_phrases',
  'plan_sequence',
  'place_lyrics',
  'compose_editorial_overlays',
  'compile_plan',
  'render_preview',
  'validate_preview',
  'await_review',
  'freeze',
  'evaluate_hidden_target',
] as const;

const CASE_INPUT_MAX_BYTES = 96 * 1024;
const CHECKPOINT_MAX_BYTES = 32 * 1024;

export async function createSourceOnlyCaseRecord(
  ctx: MutationCtx,
  args: { projectId: string; idempotencyKey: string; inputDigest: string; input: unknown },
) {
  const projectId = assertBoundedString(args.projectId, 128, 'project_id');
  const idempotencyKey = assertBoundedString(args.idempotencyKey, 256, 'idempotency_key');
  const inputDigest = assertSha256Digest(args.inputDigest);
  const inputJson = boundedCanonicalJson(args.input, CASE_INPUT_MAX_BYTES, 'case_input');
  if ((await sha256Digest(inputJson)) !== inputDigest)
    throw new Error('case_input_digest_mismatch');
  const existing = await ctx.db
    .query('sourceOnlyCases')
    .withIndex('by_project_idempotency', (query) =>
      query.eq('projectId', projectId).eq('idempotencyKey', idempotencyKey),
    )
    .unique();
  if (existing !== null) {
    assertIdempotentInput(existing.inputDigest, inputDigest);
    return { caseId: existing._id, reused: true as const };
  }
  const now = Date.now();
  const caseId = await ctx.db.insert('sourceOnlyCases', {
    projectId,
    idempotencyKey,
    inputDigest,
    inputJson,
    createdAt: now,
    updatedAt: now,
  });
  return { caseId, reused: false as const };
}

export const createCase = internalMutation({
  args: {
    projectId: v.string(),
    idempotencyKey: v.string(),
    inputDigest: v.string(),
    input: v.any(),
  },
  handler: createSourceOnlyCaseRecord,
});

export const admitAsset = internalMutation({
  args: {
    caseId: v.id('sourceOnlyCases'),
    role: v.string(),
    storageId: v.id('_storage'),
    sha256: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const ownerCase = await ctx.db.get(args.caseId);
    if (ownerCase === null) throw new Error('case_not_found');
    const role = assertBoundedString(args.role, 128, 'asset_role');
    const sha256 = assertSha256Digest(args.sha256);
    const mimeType = assertBoundedString(args.mimeType, 160, 'mime_type');
    if (!Number.isSafeInteger(args.sizeBytes) || args.sizeBytes < 1)
      throw new Error('invalid_size');
    const existing = await ctx.db
      .query('caseAssets')
      .withIndex('by_case_role', (query) => query.eq('caseId', args.caseId).eq('role', role))
      .unique();
    if (existing !== null) {
      if (existing.sha256 !== sha256 || existing.storageId !== args.storageId) {
        throw new Error('asset_role_conflict');
      }
      return { assetId: existing._id, reused: true as const };
    }
    const assetId = await ctx.db.insert('caseAssets', {
      caseId: args.caseId,
      role,
      storageId: args.storageId,
      sha256,
      mimeType,
      sizeBytes: args.sizeBytes,
      admittedAt: Date.now(),
    });
    return { assetId, reused: false as const };
  },
});

export async function startJobRecord(
  ctx: MutationCtx,
  args: {
    caseId: Id<'sourceOnlyCases'>;
    idempotencyKey: string;
    inputDigest: string;
    maxAttempts?: number;
  },
) {
  const ownerCase = await ctx.db.get(args.caseId);
  if (ownerCase === null) throw new Error('case_not_found');
  const idempotencyKey = assertBoundedString(args.idempotencyKey, 256, 'idempotency_key');
  const inputDigest = assertSha256Digest(args.inputDigest);
  const existing = await ctx.db
    .query('jobs')
    .withIndex('by_project_idempotency', (query) =>
      query.eq('projectId', ownerCase.projectId).eq('idempotencyKey', idempotencyKey),
    )
    .unique();
  if (existing !== null) {
    assertIdempotentInput(existing.inputDigest, inputDigest);
    return { jobId: existing._id, reused: true as const };
  }
  const maxAttempts = args.maxAttempts ?? 3;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error('invalid_max_attempts');
  }
  const now = Date.now();
  const jobId = await ctx.db.insert('jobs', {
    caseId: args.caseId,
    projectId: ownerCase.projectId,
    idempotencyKey,
    inputDigest,
    status: 'queued',
    attempt: 0,
    maxAttempts,
    leaseToken: 0,
    nextEventSequence: 1,
    currentStage: STAGES[0],
    createdAt: now,
    updatedAt: now,
  });
  for (const [ordinal, name] of STAGES.entries()) {
    await ctx.db.insert('jobStages', {
      jobId,
      ordinal,
      name,
      status: 'pending',
      attempt: 0,
      maxAttempts,
      inputDigest,
      outputArtifactIds: [],
      leaseToken: 0,
      updatedAt: now,
    });
  }
  await appendJobEvent(ctx, jobId, 'job.created', { caseId: args.caseId, inputDigest }, now);
  return { jobId, reused: false as const };
}

export const startJob = internalMutation({
  args: {
    caseId: v.id('sourceOnlyCases'),
    idempotencyKey: v.string(),
    inputDigest: v.string(),
    maxAttempts: v.optional(v.number()),
  },
  handler: startJobRecord,
});

export const claimStage = internalMutation({
  args: {
    jobId: v.id('jobs'),
    stage: stageName,
    leaseId: v.string(),
    leaseMs: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await requireJob(ctx, args.jobId);
    if (job.status === 'cancelled') return { claimed: false as const, reason: 'cancelled' };
    if (job.currentStage !== args.stage) return { claimed: false as const, reason: 'not_current' };
    const row = await requireStage(ctx, args.jobId, args.stage);
    const now = Date.now();
    if (row.status === 'completed') return { claimed: false as const, reason: 'completed' };
    if (row.status === 'running' && (row.leaseUntil ?? 0) > now) {
      return { claimed: false as const, reason: 'leased' };
    }
    if (row.attempt >= row.maxAttempts) return { claimed: false as const, reason: 'exhausted' };
    const leaseId = assertBoundedString(args.leaseId, 256, 'lease_id');
    const leaseUntil = now + assertLeaseDuration(args.leaseMs);
    const leaseToken = row.leaseToken + 1;
    await ctx.db.patch(row._id, {
      status: 'running',
      attempt: row.attempt + 1,
      leaseId,
      leaseToken,
      leaseUntil,
      error: undefined,
      startedAt: row.startedAt ?? now,
      updatedAt: now,
    });
    await ctx.db.patch(job._id, { status: 'running', updatedAt: now });
    await appendJobEvent(ctx, job._id, 'stage.started', { stage: args.stage, leaseToken }, now);
    return { claimed: true as const, leaseToken, leaseUntil, inputDigest: row.inputDigest };
  },
});

export const completeStage = internalMutation({
  args: {
    jobId: v.id('jobs'),
    stage: stageName,
    leaseId: v.string(),
    leaseToken: v.number(),
    checkpoint: v.optional(v.any()),
    outputArtifactIds: v.array(v.id('artifacts')),
  },
  handler: async (ctx, args) => {
    const job = await requireJob(ctx, args.jobId);
    const row = await requireStage(ctx, args.jobId, args.stage);
    const now = Date.now();
    assertStageLease(row, args.leaseId, args.leaseToken, now);
    const checkpointJson =
      args.checkpoint === undefined
        ? undefined
        : boundedCanonicalJson(args.checkpoint, CHECKPOINT_MAX_BYTES, 'stage_checkpoint');
    for (const artifactId of args.outputArtifactIds) {
      const artifact = await ctx.db.get(artifactId);
      if (artifact === null || artifact.jobId !== args.jobId)
        throw new Error('stage_artifact_mismatch');
    }
    await ctx.db.patch(row._id, {
      status: 'completed',
      outputArtifactIds: args.outputArtifactIds,
      checkpointJson,
      leaseId: undefined,
      leaseUntil: undefined,
      completedAt: now,
      updatedAt: now,
    });
    const nextName = STAGES[row.ordinal + 1];
    await ctx.db.patch(job._id, {
      status:
        nextName === undefined
          ? 'completed'
          : nextName === 'await_review'
            ? 'awaiting_review'
            : 'queued',
      currentStage: nextName,
      completedAt: nextName === undefined ? now : undefined,
      updatedAt: now,
    });
    await appendJobEvent(
      ctx,
      job._id,
      'stage.completed',
      nextName === undefined ? { stage: args.stage } : { stage: args.stage, nextStage: nextName },
      now,
    );
    if (nextName === 'await_review') {
      const review = await requireStage(ctx, job._id, 'await_review');
      await ctx.db.patch(review._id, { status: 'awaiting_approval', updatedAt: now });
      await appendJobEvent(ctx, job._id, 'stage.awaiting_approval', { stage: nextName }, now);
    }
    if (nextName === undefined) await appendJobEvent(ctx, job._id, 'job.completed', undefined, now);
    return { completed: true as const, nextStage: nextName };
  },
});

export const failStage = internalMutation({
  args: {
    jobId: v.id('jobs'),
    stage: stageName,
    leaseId: v.string(),
    leaseToken: v.number(),
    error: v.string(),
    retryable: v.boolean(),
  },
  handler: async (ctx, args) => {
    const job = await requireJob(ctx, args.jobId);
    const row = await requireStage(ctx, args.jobId, args.stage);
    const now = Date.now();
    assertStageLease(row, args.leaseId, args.leaseToken, now);
    const error = assertBoundedString(args.error, 2_000, 'stage_error');
    const willRetry = args.retryable && row.attempt < row.maxAttempts;
    await ctx.db.patch(row._id, {
      status: willRetry ? 'pending' : 'failed',
      leaseId: undefined,
      leaseUntil: undefined,
      error,
      updatedAt: now,
    });
    await ctx.db.patch(job._id, { status: willRetry ? 'queued' : 'failed', error, updatedAt: now });
    await appendJobEvent(
      ctx,
      job._id,
      willRetry ? 'stage.retry_scheduled' : 'stage.failed',
      { stage: args.stage, error },
      now,
    );
    return { willRetry };
  },
});

export const approveReview = internalMutation({
  args: { jobId: v.id('jobs'), approverRef: v.string() },
  handler: async (ctx, args) => {
    const job = await requireJob(ctx, args.jobId);
    const review = await requireStage(ctx, args.jobId, 'await_review');
    if (review.status === 'completed') return { approved: true as const, reused: true as const };
    if (review.status !== 'awaiting_approval') throw new Error('review_not_awaiting_approval');
    const now = Date.now();
    const approverRef = assertBoundedString(args.approverRef, 256, 'approver_ref');
    await ctx.db.patch(review._id, { status: 'completed', completedAt: now, updatedAt: now });
    await ctx.db.patch(job._id, { status: 'queued', currentStage: 'freeze', updatedAt: now });
    await appendJobEvent(
      ctx,
      job._id,
      'stage.completed',
      { stage: 'await_review', approverRef, nextStage: 'freeze' },
      now,
    );
    return { approved: true as const, reused: false as const };
  },
});

export const freezePlan = internalMutation({
  args: {
    jobId: v.id('jobs'),
    planArtifactId: v.id('artifacts'),
    planDigest: v.string(),
    renderArtifactId: v.id('artifacts'),
    renderDigest: v.string(),
    generationReadLogDigest: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await requireJob(ctx, args.jobId);
    const planDigest = assertSha256Digest(args.planDigest);
    const renderDigest = assertSha256Digest(args.renderDigest);
    const generationReadLogDigest = assertSha256Digest(args.generationReadLogDigest);
    const existing = await ctx.db
      .query('freezeReceipts')
      .withIndex('by_job', (query) => query.eq('jobId', args.jobId))
      .unique();
    if (existing !== null) {
      if (
        existing.planDigest !== planDigest ||
        existing.renderDigest !== renderDigest ||
        existing.generationReadLogDigest !== generationReadLogDigest
      ) {
        throw new Error('freeze_digest_conflict');
      }
      return { freezeReceiptId: existing._id, reused: true as const };
    }
    if (job.currentStage !== 'freeze') throw new Error('job_not_ready_to_freeze');
    const plan = await ctx.db.get(args.planArtifactId);
    const render = await ctx.db.get(args.renderArtifactId);
    if (plan?.jobId !== args.jobId || render?.jobId !== args.jobId) {
      throw new Error('freeze_artifact_job_mismatch');
    }
    if (plan.sha256 !== planDigest || render.sha256 !== renderDigest) {
      throw new Error('freeze_artifact_digest_mismatch');
    }
    const now = Date.now();
    const freezeReceiptId = await ctx.db.insert('freezeReceipts', {
      jobId: args.jobId,
      planArtifactId: args.planArtifactId,
      planDigest,
      renderArtifactId: args.renderArtifactId,
      renderDigest,
      generationReadLogDigest,
      createdAt: now,
    });
    const stage = await requireStage(ctx, args.jobId, 'freeze');
    await ctx.db.patch(stage._id, { status: 'completed', completedAt: now, updatedAt: now });
    await ctx.db.patch(job._id, {
      status: 'awaiting_review',
      currentStage: 'evaluate_hidden_target',
      frozenPlanDigest: planDigest,
      frozenAt: now,
      updatedAt: now,
    });
    await appendJobEvent(
      ctx,
      job._id,
      'plan.frozen',
      { freezeReceiptId, planDigest, renderDigest },
      now,
    );
    return { freezeReceiptId, reused: false as const };
  },
});

export const unsealEvaluation = internalMutation({
  args: {
    jobId: v.id('jobs'),
    freezeReceiptId: v.id('freezeReceipts'),
    hiddenTargetDigest: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await requireJob(ctx, args.jobId);
    if (job.currentStage !== 'evaluate_hidden_target' || job.frozenAt === undefined) {
      throw new Error('generation_not_frozen');
    }
    const freeze = await ctx.db.get(args.freezeReceiptId);
    if (freeze?.jobId !== args.jobId || freeze.planDigest !== job.frozenPlanDigest) {
      throw new Error('freeze_receipt_mismatch');
    }
    const hiddenTargetDigest = assertSha256Digest(args.hiddenTargetDigest);
    const existing = await ctx.db
      .query('evaluationReceipts')
      .withIndex('by_job', (query) => query.eq('jobId', args.jobId))
      .unique();
    if (existing !== null) {
      if (existing.hiddenTargetDigest !== hiddenTargetDigest)
        throw new Error('target_digest_conflict');
      return { evaluationReceiptId: existing._id, reused: true as const };
    }
    const now = Date.now();
    const evaluationReceiptId = await ctx.db.insert('evaluationReceipts', {
      jobId: args.jobId,
      freezeReceiptId: args.freezeReceiptId,
      hiddenTargetDigest,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(job._id, {
      status: 'queued',
      evaluationUnsealedAt: now,
      updatedAt: now,
    });
    await appendJobEvent(
      ctx,
      job._id,
      'evaluation.unsealed',
      { evaluationReceiptId, freezeReceiptId: args.freezeReceiptId },
      now,
    );
    return { evaluationReceiptId, reused: false as const };
  },
});

export const cancelJob = internalMutation({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args) => {
    const job = await requireJob(ctx, args.jobId);
    if (job.status === 'cancelled') return { cancelled: true as const, reused: true as const };
    if (job.status === 'completed') throw new Error('completed_job_cannot_be_cancelled');
    const now = Date.now();
    await ctx.db.patch(job._id, { status: 'cancelled', updatedAt: now });
    const stages = await ctx.db
      .query('jobStages')
      .withIndex('by_job_ordinal', (query) => query.eq('jobId', args.jobId))
      .collect();
    for (const stage of stages.filter((value) => value.status !== 'completed')) {
      await ctx.db.patch(stage._id, {
        status: 'cancelled',
        leaseId: undefined,
        leaseUntil: undefined,
        updatedAt: now,
      });
    }
    await appendJobEvent(ctx, job._id, 'job.cancelled', undefined, now);
    return { cancelled: true as const, reused: false as const };
  },
});

export const retryStage = internalMutation({
  args: { jobId: v.id('jobs'), stage: stageName },
  handler: async (ctx, args) => {
    const job = await requireJob(ctx, args.jobId);
    const row = await requireStage(ctx, args.jobId, args.stage);
    if (row.status !== 'failed') throw new Error('stage_is_not_failed');
    if (row.attempt >= row.maxAttempts) throw new Error('stage_attempts_exhausted');
    const now = Date.now();
    await ctx.db.patch(row._id, { status: 'pending', error: undefined, updatedAt: now });
    await ctx.db.patch(job._id, {
      status: 'queued',
      currentStage: args.stage,
      error: undefined,
      updatedAt: now,
    });
    await appendJobEvent(
      ctx,
      job._id,
      'stage.retry_scheduled',
      { stage: args.stage, manual: true },
      now,
    );
    return { retried: true as const };
  },
});

export const readJob = internalQuery({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job === null) return null;
    const stages = await ctx.db
      .query('jobStages')
      .withIndex('by_job_ordinal', (query) => query.eq('jobId', args.jobId))
      .collect();
    const events = await ctx.db
      .query('jobEvents')
      .withIndex('by_job_sequence', (query) => query.eq('jobId', args.jobId))
      .collect();
    const artifacts = await ctx.db
      .query('artifacts')
      .withIndex('by_job_artifactKey', (query) => query.eq('jobId', args.jobId))
      .collect();
    return { job, stages, events, artifacts };
  },
});

export const readWorkerInput = internalQuery({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job?.caseId === undefined) throw new Error('job_case_not_found');
    const caseId = job.caseId;
    const ownerCase = await ctx.db.get(caseId);
    if (ownerCase === null) throw new Error('case_not_found');
    const assets = await ctx.db
      .query('caseAssets')
      .withIndex('by_case_role', (query) => query.eq('caseId', caseId))
      .collect();
    return { job, ownerCase, assets };
  },
});

export const recordStageArtifact = internalMutation({
  args: {
    jobId: v.id('jobs'),
    stage: stageName,
    leaseId: v.string(),
    leaseToken: v.number(),
    artifactKey: v.string(),
    kind: v.string(),
    storageId: v.id('_storage'),
    sha256: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    toolName: v.string(),
    toolVersion: v.string(),
    inputDigests: v.array(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const job = await requireJob(ctx, args.jobId);
    const stage = await requireStage(ctx, args.jobId, args.stage);
    const now = Date.now();
    assertStageLease(stage, args.leaseId, args.leaseToken, now);
    const artifactKey = assertBoundedString(args.artifactKey, 256, 'artifact_key');
    const sha256 = assertSha256Digest(args.sha256);
    const existing = await ctx.db
      .query('artifacts')
      .withIndex('by_job_artifactKey', (query) =>
        query.eq('jobId', args.jobId).eq('artifactKey', artifactKey),
      )
      .unique();
    if (existing !== null) {
      if (existing.sha256 !== sha256) throw new Error('artifact_key_digest_conflict');
      return { artifactId: existing._id, reused: true as const };
    }
    const artifactId = await ctx.db.insert('artifacts', {
      projectId: job.projectId,
      jobId: args.jobId,
      artifactKey,
      kind: assertBoundedString(args.kind, 128, 'artifact_kind'),
      storageRef: args.storageId,
      sha256,
      mimeType: assertBoundedString(args.mimeType, 160, 'mime_type'),
      sizeBytes: args.sizeBytes,
      toolName: assertBoundedString(args.toolName, 160, 'tool_name'),
      toolVersion: assertBoundedString(args.toolVersion, 160, 'tool_version'),
      inputDigests: args.inputDigests.map(assertSha256Digest),
      metadataJson:
        args.metadata === undefined
          ? undefined
          : boundedCanonicalJson(args.metadata, CHECKPOINT_MAX_BYTES, 'artifact_metadata'),
      createdAt: now,
    });
    await appendJobEvent(
      ctx,
      job._id,
      'artifact.recorded',
      { artifactId, artifactKey, kind: args.kind, stage: args.stage },
      now,
    );
    return { artifactId, reused: false as const };
  },
});

async function requireStage(ctx: any, jobId: any, name: (typeof STAGES)[number]) {
  const row = await ctx.db
    .query('jobStages')
    .withIndex('by_job_name', (query: any) => query.eq('jobId', jobId).eq('name', name))
    .unique();
  if (row === null) throw new Error('stage_not_found');
  return row;
}

function assertStageLease(row: any, leaseId: string, leaseToken: number, now: number) {
  if (
    row.status !== 'running' ||
    row.leaseId !== leaseId ||
    row.leaseToken !== leaseToken ||
    (row.leaseUntil ?? 0) <= now
  ) {
    throw new Error('stale_stage_lease');
  }
}
