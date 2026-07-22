import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
  internalQuery,
} from './_generated/server';
import {
  CASEFLOW_SCHEMA_VERSIONS,
  type CaseflowDecision,
  TERMINAL_CASEFLOW_RUN_STATUSES,
  caseflowDecision,
} from './caseflowValidators';
import {
  assertBoundedString,
  boundedCanonicalJson,
  canonicalJson,
  sha256Digest,
} from './lib/durability';

const CONTENT_MAX_BYTES = 256 * 1024;
const ACTOR_MAX_BYTES = 8 * 1024;
const DEFAULT_ACTOR = { id: 'nodekit', type: 'system' } as const;

export const convexCaseflowCapabilities = {
  schemaVersion: 'nodekit.runtime-capabilities/v1',
  provider: 'convex',
  durableState: true,
  transactions: true,
  optimisticConcurrency: true,
  subscriptions: 'native',
  durableJobs: 'native',
  fileStorage: true,
  presence: true,
  scheduledJobs: true,
  localDevelopment: true,
} as const;

type CaseflowStageInput = { id?: string; label?: string; owner?: string };
type CaseflowStage = {
  id: string;
  label: string;
  owner: string;
  status: 'active' | 'completed' | 'pending';
};

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function parseJson(json: string): unknown {
  return JSON.parse(json) as unknown;
}

function boundedText(value: unknown, maxLength: number, label: string): string {
  const text = String(value ?? '');
  if (text.length > maxLength) throw new Error(`${label}_too_long`);
  return text;
}

async function contentHash(value: unknown): Promise<string> {
  return (await sha256Digest(canonicalJson(value))).slice('sha256:'.length);
}

function requireId<TableName extends Parameters<MutationCtx['db']['normalizeId']>[0]>(
  ctx: MutationCtx | QueryCtx,
  table: TableName,
  value: string,
  label: string,
) {
  const normalized = ctx.db.normalizeId(table, value);
  if (normalized === null) throw new Error(`${label} not found: ${value}`);
  return normalized;
}

async function requireCase(ctx: MutationCtx | QueryCtx, caseId: string) {
  const id = requireId(ctx, 'caseflowCases', caseId, 'case');
  const row = await ctx.db.get(id);
  if (row === null) throw new Error(`case not found: ${caseId}`);
  return row;
}

async function requireRun(ctx: MutationCtx | QueryCtx, runId: string) {
  const id = requireId(ctx, 'caseflowRuns', runId, 'run');
  const row = await ctx.db.get(id);
  if (row === null) throw new Error(`run not found: ${runId}`);
  return row;
}

async function requireArtifact(ctx: MutationCtx | QueryCtx, artifactId: string) {
  const id = requireId(ctx, 'caseflowArtifacts', artifactId, 'artifact');
  const row = await ctx.db.get(id);
  if (row === null) throw new Error(`artifact not found: ${artifactId}`);
  return row;
}

async function requireProposal(ctx: MutationCtx | QueryCtx, proposalId: string) {
  const id = requireId(ctx, 'caseflowProposals', proposalId, 'proposal');
  const row = await ctx.db.get(id);
  if (row === null) throw new Error(`proposal not found: ${proposalId}`);
  return row;
}

async function requireException(ctx: MutationCtx | QueryCtx, exceptionId: string) {
  const id = requireId(ctx, 'caseflowExceptions', exceptionId, 'exception');
  const row = await ctx.db.get(id);
  if (row === null) throw new Error(`exception not found: ${exceptionId}`);
  return row;
}

function caseView(row: Doc<'caseflowCases'>) {
  return {
    caseId: row._id,
    createdAt: iso(row.createdAt),
    currentRunId: row.currentRunId ?? null,
    primaryJob: row.primaryJob,
    schemaVersion: CASEFLOW_SCHEMA_VERSIONS.case,
    status: row.status,
    title: row.title,
    updatedAt: iso(row.updatedAt),
  };
}

function runView(row: Doc<'caseflowRuns'>) {
  return {
    caseId: row.caseId,
    createdAt: iso(row.createdAt),
    currentStageId: row.currentStageId,
    nextAction: row.nextAction,
    nextActionOwner: row.nextActionOwner,
    runId: row._id,
    schemaVersion: CASEFLOW_SCHEMA_VERSIONS.run,
    stages: row.stages,
    status: row.status,
    updatedAt: iso(row.updatedAt),
  };
}

async function artifactView(ctx: MutationCtx | QueryCtx, row: Doc<'caseflowArtifacts'>) {
  const versions = await ctx.db
    .query('caseflowArtifactVersions')
    .withIndex('by_artifact_version', (query) => query.eq('artifactId', row._id))
    .collect();
  return {
    artifactId: row._id,
    canonicalVersion: row.canonicalVersion,
    caseId: row.caseId,
    createdAt: iso(row.createdAt),
    kind: row.kind,
    runId: row.runId,
    schemaVersion: CASEFLOW_SCHEMA_VERSIONS.artifact,
    title: row.title,
    updatedAt: iso(row.updatedAt),
    versions: versions.map((version) => ({
      content: parseJson(version.contentJson),
      contentHash: version.contentHash,
      createdAt: iso(version.createdAt),
      ...(version.proposalId === undefined ? {} : { proposalId: version.proposalId }),
      version: version.version,
    })),
  };
}

function proposalView(row: Doc<'caseflowProposals'>) {
  return {
    artifactId: row.artifactId,
    baseVersion: row.baseVersion,
    createdAt: iso(row.createdAt),
    patch: parseJson(row.patchJson),
    proposalId: row._id,
    rationale: row.rationale,
    schemaVersion: CASEFLOW_SCHEMA_VERSIONS.proposal,
    status: row.status,
  };
}

function approvalView(row: Doc<'caseflowApprovals'>) {
  return {
    approvalId: row._id,
    comment: row.comment,
    decidedAt: iso(row.decidedAt),
    decision: row.decision,
    proposalId: row.proposalId,
    schemaVersion: CASEFLOW_SCHEMA_VERSIONS.approval,
  };
}

function exceptionView(row: Doc<'caseflowExceptions'>) {
  return {
    code: row.code,
    exceptionId: row._id,
    message: row.message,
    preservedState: parseJson(row.preservedStateJson),
    raisedAt: iso(row.raisedAt),
    resolution: row.resolution ?? null,
    ...(row.resolvedAt === undefined ? {} : { resolvedAt: iso(row.resolvedAt) }),
    runId: row.runId,
    schemaVersion: CASEFLOW_SCHEMA_VERSIONS.exception,
    status: row.status,
  };
}

function eventView(row: Doc<'caseflowEvents'>) {
  return {
    actor: parseJson(row.actorJson),
    aggregateId: row.aggregateId,
    aggregateType: row.aggregateType,
    eventId: row._id,
    eventType: row.eventType,
    occurredAt: iso(row.occurredAt),
    payload: parseJson(row.payloadJson),
    schemaVersion: CASEFLOW_SCHEMA_VERSIONS.event,
    sequence: row.sequence,
  };
}

function receiptView(row: Doc<'caseflowReceipts'>, caseId: Id<'caseflowCases'>) {
  return {
    artifactIds: row.artifactIds,
    caseId,
    eventIds: row.eventIds,
    generatedAt: iso(row.generatedAt),
    proposalIds: row.proposalIds,
    receiptHash: row.receiptHash,
    receiptId: row._id,
    runId: row.runId,
    schemaVersion: CASEFLOW_SCHEMA_VERSIONS.receipt,
    status: row.status,
  };
}

async function receiptWithCase(ctx: MutationCtx | QueryCtx, row: Doc<'caseflowReceipts'>) {
  const run = await ctx.db.get(row.runId);
  if (run === null) throw new Error('receipt run not found');
  const receipt = receiptView(row, run.caseId);
  const { receiptHash, receiptId: _receiptId, ...body } = receipt;
  if ((await contentHash(body)) !== receiptHash) throw new Error('receipt_hash_mismatch');
  return receipt;
}

async function emit(
  ctx: MutationCtx,
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  payload: unknown,
  actor: unknown,
  occurredAt: number,
): Promise<Id<'caseflowEvents'>> {
  const latest = await ctx.db
    .query('caseflowEvents')
    .withIndex('by_aggregate_sequence', (query) => query.eq('aggregateId', aggregateId))
    .order('desc')
    .first();
  return ctx.db.insert('caseflowEvents', {
    actorJson: boundedCanonicalJson(actor ?? DEFAULT_ACTOR, ACTOR_MAX_BYTES, 'caseflow_actor'),
    aggregateId,
    aggregateType: assertBoundedString(aggregateType, 64, 'aggregate_type'),
    eventType: assertBoundedString(eventType, 128, 'event_type'),
    occurredAt,
    payloadJson: boundedCanonicalJson(payload ?? {}, CONTENT_MAX_BYTES, 'caseflow_event_payload'),
    sequence: (latest?.sequence ?? 0) + 1,
  });
}

function normalizeStages(stages: CaseflowStageInput[]): CaseflowStage[] {
  if (stages.length === 0) throw new Error('run stages are required');
  if (stages.length > 64) throw new Error('too many run stages');
  const normalized = stages.map((stage, index): CaseflowStage => {
    const id = assertBoundedString(stage.id ?? `stage-${index + 1}`, 128, 'stage_id');
    return {
      id,
      label: assertBoundedString(
        stage.label ?? stage.id ?? `Stage ${index + 1}`,
        256,
        'stage_label',
      ),
      owner: assertBoundedString(stage.owner ?? 'system', 128, 'stage_owner'),
      status: index === 0 ? 'active' : 'pending',
    };
  });
  if (new Set(normalized.map((stage) => stage.id)).size !== normalized.length) {
    throw new Error('run stage ids must be unique');
  }
  return normalized;
}

export async function createCaseRecord(
  ctx: MutationCtx,
  args: { title: string; primaryJob: string; actor?: unknown },
) {
  const now = Date.now();
  const caseId = await ctx.db.insert('caseflowCases', {
    createdAt: now,
    primaryJob: assertBoundedString(args.primaryJob, 512, 'case_primary_job'),
    status: 'ready',
    title: assertBoundedString(args.title, 256, 'case_title'),
    updatedAt: now,
  });
  const row = await ctx.db.get(caseId);
  if (row === null) throw new Error('case insert failed');
  const view = caseView(row);
  await emit(ctx, 'case', caseId, 'case.created', view, args.actor, now);
  return view;
}

export async function startRunRecord(
  ctx: MutationCtx,
  args: { caseId: string; stages: CaseflowStageInput[]; actor?: unknown },
) {
  const caseRecord = await requireCase(ctx, args.caseId);
  if (caseRecord.currentRunId !== undefined) {
    const current = await ctx.db.get(caseRecord.currentRunId);
    if (current !== null && !TERMINAL_CASEFLOW_RUN_STATUSES.has(current.status)) {
      return runView(current);
    }
  }
  const stages = normalizeStages(args.stages);
  const now = Date.now();
  const runId = await ctx.db.insert('caseflowRuns', {
    caseId: caseRecord._id,
    createdAt: now,
    currentStageId: stages[0].id,
    nextAction: stages[0].label,
    nextActionOwner: stages[0].owner,
    stages,
    status: 'active',
    updatedAt: now,
  });
  await ctx.db.patch(caseRecord._id, {
    currentRunId: runId,
    status: 'in_progress',
    updatedAt: now,
  });
  const row = await ctx.db.get(runId);
  if (row === null) throw new Error('run insert failed');
  const view = runView(row);
  await emit(ctx, 'run', runId, 'run.started', view, args.actor, now);
  await emit(ctx, 'run', runId, 'stage.entered', { stageId: stages[0].id }, args.actor, now);
  return view;
}

export async function enterStageRecord(
  ctx: MutationCtx,
  args: {
    runId: string;
    stageId: string;
    nextAction?: string;
    nextActionOwner?: string;
    actor?: unknown;
  },
) {
  const run = await requireRun(ctx, args.runId);
  if (TERMINAL_CASEFLOW_RUN_STATUSES.has(run.status)) {
    throw new Error(`run is terminal: ${run.status}`);
  }
  const stageId = assertBoundedString(args.stageId, 128, 'stage_id');
  const targetIndex = run.stages.findIndex((stage) => stage.id === stageId);
  if (targetIndex < 0) throw new Error(`stage not found: ${stageId}`);
  const stages = run.stages.map((stage, index) => ({
    ...stage,
    status:
      index < targetIndex
        ? ('completed' as const)
        : index === targetIndex
          ? ('active' as const)
          : ('pending' as const),
  }));
  const now = Date.now();
  const nextAction = assertBoundedString(
    args.nextAction ?? stages[targetIndex].label,
    512,
    'next_action',
  );
  const nextActionOwner = assertBoundedString(
    args.nextActionOwner ?? stages[targetIndex].owner,
    128,
    'next_action_owner',
  );
  await ctx.db.patch(run._id, {
    currentStageId: stageId,
    nextAction,
    nextActionOwner,
    stages,
    updatedAt: now,
  });
  await emit(
    ctx,
    'run',
    run._id,
    'stage.entered',
    { nextAction, nextActionOwner, stageId },
    args.actor,
    now,
  );
  const updated = await ctx.db.get(run._id);
  if (updated === null) throw new Error('run update failed');
  return runView(updated);
}

export async function createArtifactRecord(
  ctx: MutationCtx,
  args: {
    caseId: string;
    runId: string;
    kind?: string;
    title?: string;
    content: unknown;
    actor?: unknown;
  },
) {
  const caseRecord = await requireCase(ctx, args.caseId);
  const run = await requireRun(ctx, args.runId);
  if (run.caseId !== caseRecord._id) throw new Error('artifact run does not belong to case');
  const contentJson = boundedCanonicalJson(args.content, CONTENT_MAX_BYTES, 'artifact_content');
  const now = Date.now();
  const artifactId = await ctx.db.insert('caseflowArtifacts', {
    canonicalVersion: 1,
    caseId: caseRecord._id,
    createdAt: now,
    kind: assertBoundedString(args.kind ?? 'generic', 128, 'artifact_kind'),
    runId: run._id,
    title: assertBoundedString(args.title ?? 'Artifact', 256, 'artifact_title'),
    updatedAt: now,
  });
  await ctx.db.insert('caseflowArtifactVersions', {
    artifactId,
    contentHash: await contentHash(args.content),
    contentJson,
    createdAt: now,
    version: 1,
  });
  await emit(
    ctx,
    'artifact',
    artifactId,
    'artifact.created',
    { artifactId, version: 1 },
    args.actor,
    now,
  );
  const row = await ctx.db.get(artifactId);
  if (row === null) throw new Error('artifact insert failed');
  return artifactView(ctx, row);
}

export async function createProposalRecord(
  ctx: MutationCtx,
  args: {
    artifactId: string;
    baseVersion: number;
    patch: unknown;
    rationale?: string;
    actor?: unknown;
  },
) {
  const artifact = await requireArtifact(ctx, args.artifactId);
  if (!Number.isSafeInteger(args.baseVersion) || args.baseVersion < 1) {
    throw new Error('proposal base version must be a positive integer');
  }
  if (args.baseVersion !== artifact.canonicalVersion) {
    throw new Error(
      `proposal base version ${args.baseVersion} is stale; canonical version is ${artifact.canonicalVersion}`,
    );
  }
  const now = Date.now();
  const proposalId = await ctx.db.insert('caseflowProposals', {
    artifactId: artifact._id,
    baseVersion: args.baseVersion,
    createdAt: now,
    patchJson: boundedCanonicalJson(args.patch, CONTENT_MAX_BYTES, 'proposal_patch'),
    rationale: boundedText(args.rationale, 2_000, 'proposal_rationale'),
    status: 'pending',
  });
  const row = await ctx.db.get(proposalId);
  if (row === null) throw new Error('proposal insert failed');
  const view = proposalView(row);
  await emit(ctx, 'proposal', proposalId, 'proposal.created', view, args.actor, now);
  return view;
}

export async function decideProposalRecord(
  ctx: MutationCtx,
  args: {
    proposalId: string;
    decision: CaseflowDecision;
    comment?: string;
    actor?: unknown;
  },
) {
  const proposal = await requireProposal(ctx, args.proposalId);
  const artifact = await requireArtifact(ctx, proposal.artifactId);
  if (proposal.status !== 'pending') {
    const approval = await ctx.db
      .query('caseflowApprovals')
      .withIndex('by_proposal', (query) => query.eq('proposalId', proposal._id))
      .unique();
    const matching =
      approval?.decision === args.decision &&
      (proposal.status === args.decision ||
        (proposal.status === 'conflicted' && args.decision === 'accepted'));
    if (!matching || approval === null) throw new Error(`proposal is already ${proposal.status}`);
    return {
      approval: approvalView(approval),
      artifact: await artifactView(ctx, artifact),
      proposal: proposalView(proposal),
      reused: true as const,
    };
  }

  const now = Date.now();
  const approvalId = await ctx.db.insert('caseflowApprovals', {
    comment: boundedText(args.comment, 2_000, 'approval_comment'),
    decidedAt: now,
    decision: args.decision,
    proposalId: proposal._id,
  });
  const approval = await ctx.db.get(approvalId);
  if (approval === null) throw new Error('approval insert failed');

  if (args.decision === 'accepted' && proposal.baseVersion !== artifact.canonicalVersion) {
    await ctx.db.patch(proposal._id, {
      approvalId,
      decidedAt: now,
      status: 'conflicted',
    });
    await emit(
      ctx,
      'proposal',
      proposal._id,
      'proposal.conflicted',
      { canonicalVersion: artifact.canonicalVersion },
      args.actor,
      now,
    );
  } else {
    await ctx.db.patch(proposal._id, {
      approvalId,
      decidedAt: now,
      status: args.decision,
    });
    if (args.decision === 'accepted') {
      const nextVersion = artifact.canonicalVersion + 1;
      const patch = parseJson(proposal.patchJson);
      await ctx.db.insert('caseflowArtifactVersions', {
        artifactId: artifact._id,
        contentHash: await contentHash(patch),
        contentJson: proposal.patchJson,
        createdAt: now,
        proposalId: proposal._id,
        version: nextVersion,
      });
      await ctx.db.patch(artifact._id, { canonicalVersion: nextVersion, updatedAt: now });
      await emit(
        ctx,
        'artifact',
        artifact._id,
        'artifact.version_created',
        { proposalId: proposal._id, version: nextVersion },
        args.actor,
        now,
      );
    }
    await emit(
      ctx,
      'proposal',
      proposal._id,
      `proposal.${args.decision}`,
      { approvalId },
      args.actor,
      now,
    );
  }

  const updatedProposal = await ctx.db.get(proposal._id);
  const updatedArtifact = await ctx.db.get(artifact._id);
  if (updatedProposal === null || updatedArtifact === null)
    throw new Error('decision update failed');
  return {
    approval: approvalView(approval),
    artifact: await artifactView(ctx, updatedArtifact),
    proposal: proposalView(updatedProposal),
    reused: false as const,
  };
}

export async function raiseExceptionRecord(
  ctx: MutationCtx,
  args: {
    runId: string;
    code?: string;
    message?: string;
    preservedState?: unknown;
    actor?: unknown;
  },
) {
  const run = await requireRun(ctx, args.runId);
  if (TERMINAL_CASEFLOW_RUN_STATUSES.has(run.status)) {
    throw new Error(`run is terminal: ${run.status}`);
  }
  const now = Date.now();
  const exceptionId = await ctx.db.insert('caseflowExceptions', {
    code: assertBoundedString(args.code ?? 'unknown', 128, 'exception_code'),
    message: assertBoundedString(
      args.message ?? 'An exception occurred.',
      2_000,
      'exception_message',
    ),
    preservedStateJson: boundedCanonicalJson(
      args.preservedState ?? {},
      CONTENT_MAX_BYTES,
      'exception_state',
    ),
    raisedAt: now,
    runId: run._id,
    status: 'open',
  });
  await ctx.db.patch(run._id, {
    nextAction: 'Resolve exception',
    nextActionOwner: 'user',
    status: 'blocked',
    updatedAt: now,
  });
  await emit(
    ctx,
    'run',
    run._id,
    'exception.raised',
    { code: args.code ?? 'unknown', exceptionId },
    args.actor,
    now,
  );
  const row = await ctx.db.get(exceptionId);
  if (row === null) throw new Error('exception insert failed');
  return exceptionView(row);
}

export async function resolveExceptionRecord(
  ctx: MutationCtx,
  args: {
    exceptionId: string;
    resolution?: string;
    nextAction?: string;
    nextActionOwner?: string;
    actor?: unknown;
  },
) {
  const exception = await requireException(ctx, args.exceptionId);
  if (exception.status !== 'open') throw new Error('exception is already resolved');
  const run = await ctx.db.get(exception.runId);
  if (run === null) throw new Error('exception run not found');
  const now = Date.now();
  const resolution = assertBoundedString(args.resolution ?? 'resolved', 2_000, 'resolution');
  const nextAction = assertBoundedString(args.nextAction ?? 'Continue run', 512, 'next_action');
  const nextActionOwner = assertBoundedString(
    args.nextActionOwner ?? 'system',
    128,
    'next_action_owner',
  );
  await ctx.db.patch(exception._id, {
    resolution,
    resolvedAt: now,
    status: 'resolved',
  });
  await ctx.db.patch(run._id, {
    nextAction,
    nextActionOwner,
    status: 'active',
    updatedAt: now,
  });
  await emit(
    ctx,
    'run',
    run._id,
    'exception.resolved',
    { exceptionId: exception._id, resolution },
    args.actor,
    now,
  );
  const updatedException = await ctx.db.get(exception._id);
  const updatedRun = await ctx.db.get(run._id);
  if (updatedException === null || updatedRun === null) throw new Error('exception update failed');
  return { exception: exceptionView(updatedException), run: runView(updatedRun) };
}

export async function completeRunRecord(
  ctx: MutationCtx,
  args: { runId: string; actor?: unknown },
) {
  const run = await requireRun(ctx, args.runId);
  if (run.status === 'completed') {
    const existing = await ctx.db
      .query('caseflowReceipts')
      .withIndex('by_run', (query) => query.eq('runId', run._id))
      .unique();
    if (existing === null) throw new Error('completed run is missing its receipt');
    return {
      receipt: await receiptWithCase(ctx, existing),
      reused: true as const,
      run: runView(run),
    };
  }
  if (TERMINAL_CASEFLOW_RUN_STATUSES.has(run.status)) {
    throw new Error(`run is terminal: ${run.status}`);
  }
  const openException = await ctx.db
    .query('caseflowExceptions')
    .withIndex('by_run_status', (query) => query.eq('runId', run._id).eq('status', 'open'))
    .first();
  if (openException !== null) throw new Error('run has unresolved exceptions');

  const now = Date.now();
  const caseRecord = await ctx.db.get(run.caseId);
  if (caseRecord === null) throw new Error('run case not found');
  const completedStages = run.stages.map((stage) => ({ ...stage, status: 'completed' as const }));
  await ctx.db.patch(run._id, {
    nextAction: 'Review receipt',
    nextActionOwner: 'user',
    stages: completedStages,
    status: 'completed',
    updatedAt: now,
  });
  await ctx.db.patch(caseRecord._id, { status: 'completed', updatedAt: now });
  await emit(ctx, 'run', run._id, 'run.completed', {}, args.actor, now);

  const artifacts = await ctx.db
    .query('caseflowArtifacts')
    .withIndex('by_run', (query) => query.eq('runId', run._id))
    .collect();
  const proposals = (
    await Promise.all(
      artifacts.map((artifact) =>
        ctx.db
          .query('caseflowProposals')
          .withIndex('by_artifact_createdAt', (query) => query.eq('artifactId', artifact._id))
          .collect(),
      ),
    )
  ).flat();
  const aggregateIds = [
    run._id as string,
    ...artifacts.map((artifact) => artifact._id as string),
    ...proposals.map((proposal) => proposal._id as string),
  ];
  const events = (
    await Promise.all(
      aggregateIds.map((aggregateId) =>
        ctx.db
          .query('caseflowEvents')
          .withIndex('by_aggregate_sequence', (query) => query.eq('aggregateId', aggregateId))
          .collect(),
      ),
    )
  )
    .flat()
    .sort((left, right) => left.occurredAt - right.occurredAt || left._id.localeCompare(right._id));
  const artifactIds = artifacts.map((artifact) => artifact._id).sort();
  const proposalIds = proposals.map((proposal) => proposal._id).sort();
  const eventIds = events.map((event) => event._id);
  const receiptBody = {
    artifactIds,
    caseId: run.caseId,
    eventIds,
    generatedAt: iso(now),
    proposalIds,
    runId: run._id,
    schemaVersion: CASEFLOW_SCHEMA_VERSIONS.receipt,
    status: 'completed' as const,
  };
  const receiptId = await ctx.db.insert('caseflowReceipts', {
    artifactIds,
    eventIds,
    generatedAt: now,
    proposalIds,
    receiptHash: await contentHash(receiptBody),
    runId: run._id,
    status: 'completed',
  });
  const receipt = await ctx.db.get(receiptId);
  if (receipt === null) throw new Error('receipt insert failed');
  await emit(
    ctx,
    'run',
    run._id,
    'receipt.created',
    { receiptHash: receipt.receiptHash, receiptId },
    args.actor,
    now,
  );
  const updatedRun = await ctx.db.get(run._id);
  if (updatedRun === null) throw new Error('run completion failed');
  return {
    receipt: await receiptWithCase(ctx, receipt),
    reused: false as const,
    run: runView(updatedRun),
  };
}

export async function snapshotRecords(ctx: MutationCtx | QueryCtx) {
  const [approvals, artifacts, cases, events, exceptions, externalRefs, proposals, receipts, runs] =
    await Promise.all([
      ctx.db.query('caseflowApprovals').collect(),
      ctx.db.query('caseflowArtifacts').collect(),
      ctx.db.query('caseflowCases').collect(),
      ctx.db.query('caseflowEvents').collect(),
      ctx.db.query('caseflowExceptions').collect(),
      ctx.db.query('caseflowExternalRefs').collect(),
      ctx.db.query('caseflowProposals').collect(),
      ctx.db.query('caseflowReceipts').collect(),
      ctx.db.query('caseflowRuns').collect(),
    ]);
  return {
    approvals: approvals.map(approvalView),
    artifacts: await Promise.all(artifacts.map((artifact) => artifactView(ctx, artifact))),
    cases: cases.map(caseView),
    events: events.map(eventView),
    exceptions: exceptions.map(exceptionView),
    externalRefs: externalRefs.map((reference) => ({
      caseId: reference.caseId,
      createdAt: iso(reference.createdAt),
      externalId: reference.externalId,
      externalRefId: reference._id,
      kind: reference.kind,
      namespace: reference.namespace,
      runId: reference.runId ?? null,
    })),
    proposals: proposals.map(proposalView),
    receipts: await Promise.all(receipts.map((receipt) => receiptWithCase(ctx, receipt))),
    runs: runs.map(runView),
  };
}

export const createCase = internalMutation({
  args: { actor: v.optional(v.any()), primaryJob: v.string(), title: v.string() },
  handler: createCaseRecord,
});

export const startRun = internalMutation({
  args: {
    actor: v.optional(v.any()),
    caseId: v.string(),
    stages: v.array(
      v.object({
        id: v.optional(v.string()),
        label: v.optional(v.string()),
        owner: v.optional(v.string()),
      }),
    ),
  },
  handler: startRunRecord,
});

export const enterStage = internalMutation({
  args: {
    actor: v.optional(v.any()),
    nextAction: v.optional(v.string()),
    nextActionOwner: v.optional(v.string()),
    runId: v.string(),
    stageId: v.string(),
  },
  handler: enterStageRecord,
});

export const createArtifact = internalMutation({
  args: {
    actor: v.optional(v.any()),
    caseId: v.string(),
    content: v.any(),
    kind: v.optional(v.string()),
    runId: v.string(),
    title: v.optional(v.string()),
  },
  handler: createArtifactRecord,
});

export const createProposal = internalMutation({
  args: {
    actor: v.optional(v.any()),
    artifactId: v.string(),
    baseVersion: v.number(),
    patch: v.any(),
    rationale: v.optional(v.string()),
  },
  handler: createProposalRecord,
});

export const decideProposal = internalMutation({
  args: {
    actor: v.optional(v.any()),
    comment: v.optional(v.string()),
    decision: caseflowDecision,
    proposalId: v.string(),
  },
  handler: decideProposalRecord,
});

export const raiseException = internalMutation({
  args: {
    actor: v.optional(v.any()),
    code: v.optional(v.string()),
    message: v.optional(v.string()),
    preservedState: v.optional(v.any()),
    runId: v.string(),
  },
  handler: raiseExceptionRecord,
});

export const resolveException = internalMutation({
  args: {
    actor: v.optional(v.any()),
    exceptionId: v.string(),
    nextAction: v.optional(v.string()),
    nextActionOwner: v.optional(v.string()),
    resolution: v.optional(v.string()),
  },
  handler: resolveExceptionRecord,
});

export const completeRun = internalMutation({
  args: { actor: v.optional(v.any()), runId: v.string() },
  handler: completeRunRecord,
});

export const snapshot = internalQuery({
  args: {},
  handler: snapshotRecords,
});
