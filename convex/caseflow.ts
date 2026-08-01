import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { boundedCanonicalJson, sha256Digest } from './lib/durability';

const JSON_LIMIT = 512 * 1024;
const JOURNEY = 'founder-launch-video';

function required(value: string, label: string, maximum = 2_000) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}_required`);
  if (normalized.length > maximum) throw new Error(`${label}_too_long`);
  return normalized;
}

async function requireCase(ctx: any, caseId: any, ownerKey: string) {
  const record = await ctx.db.get(caseId);
  if (!record || record.ownerKey !== ownerKey) throw new Error('case_not_found');
  return record;
}

async function nextSequence(ctx: any, caseId: any) {
  const events = await ctx.db
    .query('timelineEvents')
    .withIndex('by_case_sequence', (q: any) => q.eq('caseId', caseId))
    .collect();
  return events.reduce((maximum: number, event: any) => Math.max(maximum, event.sequence), 0) + 1;
}

async function event(
  ctx: any,
  input: { caseId: any; runId?: any; kind: string; payload?: unknown },
) {
  await ctx.db.insert('timelineEvents', {
    caseId: input.caseId,
    runId: input.runId,
    sequence: await nextSequence(ctx, input.caseId),
    kind: input.kind,
    actorRef: 'case-owner',
    payloadJson:
      input.payload === undefined
        ? undefined
        : boundedCanonicalJson(input.payload, JSON_LIMIT, 'timeline_event'),
    createdAt: Date.now(),
  });
}

export const createCampaign = mutation({
  args: {
    ownerKey: v.string(),
    idempotencyKey: v.string(),
    title: v.string(),
    brief: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerKey = required(args.ownerKey, 'owner_key', 256);
    const idempotencyKey = required(args.idempotencyKey, 'idempotency_key', 256);
    const existing = await ctx.db
      .query('cases')
      .withIndex('by_owner_idempotency', (q) =>
        q.eq('ownerKey', ownerKey).eq('idempotencyKey', idempotencyKey),
      )
      .unique();
    if (existing) {
      const run = await ctx.db
        .query('runs')
        .withIndex('by_case_updatedAt', (q) => q.eq('caseId', existing._id))
        .order('desc')
        .first();
      if (!run) throw new Error('campaign_run_missing');
      return { caseId: existing._id, runId: run._id, threadId: run.threadId, reused: true };
    }

    const now = Date.now();
    const inputJson = boundedCanonicalJson(
      { title: args.title, brief: args.brief, journey: JOURNEY },
      JSON_LIMIT,
      'campaign_input',
    );
    const inputDigest = await sha256Digest(inputJson);
    const caseId = await ctx.db.insert('cases', {
      ownerKey,
      idempotencyKey,
      title: required(args.title, 'case_title', 240),
      brief: required(args.brief, 'case_brief'),
      journey: JOURNEY,
      status: 'intake',
      currentArtifactVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const threadId = await ctx.db.insert('agentThreads', {
      caseId,
      title: 'Founder launch production thread',
      createdAt: now,
      updatedAt: now,
    });
    const sourceCaseId = await ctx.db.insert('sourceOnlyCases', {
      projectId: String(caseId),
      idempotencyKey,
      inputDigest,
      inputJson,
      createdAt: now,
      updatedAt: now,
    });
    const jobId = await ctx.db.insert('jobs', {
      caseId: sourceCaseId,
      projectId: String(caseId),
      idempotencyKey,
      inputDigest,
      status: 'queued',
      attempt: 0,
      maxAttempts: 3,
      leaseToken: 0,
      nextEventSequence: 1,
      currentStage: 'compile_plan',
      createdAt: now,
      updatedAt: now,
    });
    const runId = await ctx.db.insert('runs', {
      caseId,
      jobId,
      threadId,
      idempotencyKey,
      status: 'queued',
      currentStage: 'intake',
      createdAt: now,
      updatedAt: now,
    });
    const initialJson = boundedCanonicalJson(
      { schemaVersion: 'nodekit.artifact/v1', caseId: String(caseId), status: 'awaiting-source' },
      JSON_LIMIT,
      'initial_artifact',
    );
    const initialDigest = await sha256Digest(initialJson);
    const artifactId = await ctx.db.insert('artifacts', {
      projectId: String(caseId),
      jobId,
      artifactKey: 'creator.canonical-video',
      kind: 'nodevideo.campaign',
      storageRef: 'caseflow:inline',
      sha256: initialDigest,
      mimeType: 'application/json',
      sizeBytes: new TextEncoder().encode(initialJson).byteLength,
      toolName: 'nodekit.caseflow',
      toolVersion: 'v1',
      inputDigests: [inputDigest],
      metadataJson: initialJson,
      createdAt: now,
    });
    await ctx.db.insert('artifactVersions', {
      caseId,
      artifactId,
      version: 1,
      snapshotJson: initialJson,
      snapshotDigest: initialDigest,
      createdBy: 'system',
      createdAt: now,
    });
    await ctx.db.patch(caseId, { selectedArtifactId: artifactId });
    await ctx.db.insert('messages', {
      threadId,
      runId,
      role: 'assistant',
      text: 'Add a product recording or use the rights-cleared demo. Source media stays local unless a later proposal names exact egress.',
      createdAt: now,
    });
    await event(ctx, {
      caseId,
      runId,
      kind: 'case.created',
      payload: { schemaVersion: 'nodekit.case/v1', journey: JOURNEY },
    });
    return { caseId, runId, threadId, reused: false };
  },
});

export const appendMessage = mutation({
  args: {
    caseId: v.id('cases'),
    ownerKey: v.string(),
    runId: v.id('runs'),
    role: v.union(v.literal('user'), v.literal('assistant'), v.literal('tool')),
    text: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await requireCase(ctx, args.caseId, args.ownerKey);
    const run = await ctx.db.get(args.runId);
    if (!run || run.caseId !== args.caseId) throw new Error('run_not_found');
    const createdAt = Date.now();
    const messageId = await ctx.db.insert('messages', {
      threadId: run.threadId,
      runId: args.runId,
      role: args.role,
      text: required(args.text, 'message', 20_000),
      metadataJson:
        args.metadata === undefined
          ? undefined
          : boundedCanonicalJson(args.metadata, JSON_LIMIT, 'message_metadata'),
      createdAt,
    });
    await ctx.db.patch(run.threadId, { updatedAt: createdAt });
    await event(ctx, {
      caseId: args.caseId,
      runId: args.runId,
      kind: `message.${args.role}`,
      payload: { messageId },
    });
    return { messageId };
  },
});

export const markSourceReady = mutation({
  args: {
    caseId: v.id('cases'),
    ownerKey: v.string(),
    runId: v.id('runs'),
    sourceName: v.string(),
    sourceDigest: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerCase = await requireCase(ctx, args.caseId, args.ownerKey);
    const run = await ctx.db.get(args.runId);
    if (!run || run.caseId !== args.caseId) throw new Error('run_not_found');
    if (run.currentStage !== 'intake') {
      return { stage: run.currentStage, reused: true };
    }
    const now = Date.now();
    await ctx.db.patch(args.runId, { status: 'running', currentStage: 'planning', updatedAt: now });
    await ctx.db.patch(args.caseId, { status: 'planning', updatedAt: now });
    await event(ctx, {
      caseId: args.caseId,
      runId: args.runId,
      kind: 'source.ready',
      payload: {
        sourceName: required(args.sourceName, 'source_name', 512),
        sourceDigest: required(args.sourceDigest, 'source_digest', 256),
        mediaLocation: 'local-browser',
      },
    });
    return {
      stage: 'planning' as const,
      reused: false,
      artifactVersion: ownerCase.currentArtifactVersion,
    };
  },
});

export const createEditProposal = mutation({
  args: {
    caseId: v.id('cases'),
    ownerKey: v.string(),
    runId: v.id('runs'),
    expectedArtifactVersion: v.number(),
    snapshot: v.any(),
    planningReceipt: v.any(),
  },
  handler: async (ctx, args) => {
    const ownerCase = await requireCase(ctx, args.caseId, args.ownerKey);
    const run = await ctx.db.get(args.runId);
    if (!run || run.caseId !== args.caseId) throw new Error('run_not_found');
    if (ownerCase.currentArtifactVersion !== args.expectedArtifactVersion) {
      throw new Error('proposal_base_version_is_stale');
    }
    const payloadJson = boundedCanonicalJson(args.snapshot, JSON_LIMIT, 'proposal_snapshot');
    const proposalDigest = await sha256Digest(payloadJson);
    const planningReceiptJson = boundedCanonicalJson(
      { ...args.planningReceipt, proposalDigest },
      JSON_LIMIT,
      'planning_receipt',
    );
    const now = Date.now();
    const proposalId = await ctx.db.insert('proposals', {
      projectId: String(args.caseId),
      jobId: run.jobId,
      artifactId: ownerCase.selectedArtifactId,
      baseRecipeVersion: String(args.expectedArtifactVersion),
      payloadJson,
      payloadDigest: proposalDigest,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.runId, {
      status: 'awaiting_review',
      currentStage: 'review',
      planningReceiptJson,
      updatedAt: now,
    });
    await ctx.db.patch(args.caseId, { status: 'review', updatedAt: now });
    await event(ctx, {
      caseId: args.caseId,
      runId: args.runId,
      kind: 'proposal.created',
      payload: {
        proposalId,
        proposalDigest,
        baseVersion: args.expectedArtifactVersion,
        requestedRoute: args.planningReceipt?.requestedRoute,
      },
    });
    return { proposalId, proposalDigest };
  },
});

export const decideProposal = mutation({
  args: {
    caseId: v.id('cases'),
    ownerKey: v.string(),
    runId: v.id('runs'),
    proposalId: v.id('proposals'),
    expectedDigest: v.string(),
    decision: v.union(v.literal('approved'), v.literal('rejected')),
    actorRef: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerCase = await requireCase(ctx, args.caseId, args.ownerKey);
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal || proposal.projectId !== String(args.caseId) || proposal.jobId === undefined) {
      throw new Error('proposal_not_found');
    }
    if (proposal.payloadDigest !== args.expectedDigest) throw new Error('approval_digest_mismatch');
    const existing = await ctx.db
      .query('approvals')
      .withIndex('by_proposal', (q) => q.eq('proposalId', args.proposalId))
      .unique();
    if (existing) {
      if (existing.proposalDigest !== args.expectedDigest || existing.decision !== args.decision) {
        throw new Error('proposal_already_decided');
      }
      return {
        applied: existing.decision === 'approved',
        reused: true,
        version: ownerCase.currentArtifactVersion,
      };
    }
    if (proposal.status !== 'pending') throw new Error('proposal_is_not_pending');
    const baseVersion = Number(proposal.baseRecipeVersion);
    if (args.decision === 'approved' && baseVersion !== ownerCase.currentArtifactVersion) {
      await ctx.db.patch(args.proposalId, { status: 'superseded', updatedAt: Date.now() });
      await event(ctx, {
        caseId: args.caseId,
        runId: args.runId,
        kind: 'proposal.conflicted',
        payload: {
          proposalId: args.proposalId,
          baseVersion,
          canonicalVersion: ownerCase.currentArtifactVersion,
        },
      });
      return {
        applied: false,
        conflicted: true,
        reused: false,
        version: ownerCase.currentArtifactVersion,
      };
    }

    const now = Date.now();
    await ctx.db.insert('approvals', {
      caseId: args.caseId,
      runId: args.runId,
      proposalId: args.proposalId,
      expectedArtifactVersion: baseVersion,
      proposalDigest: args.expectedDigest,
      decision: args.decision,
      actorRef: required(args.actorRef, 'actor_ref', 256),
      createdAt: now,
    });
    await ctx.db.patch(args.proposalId, {
      status: args.decision,
      approvalDigest: args.decision === 'approved' ? args.expectedDigest : undefined,
      approverRef: args.actorRef,
      decidedAt: now,
      updatedAt: now,
    });
    let version = ownerCase.currentArtifactVersion;
    if (args.decision === 'approved') {
      const artifactId = ownerCase.selectedArtifactId;
      if (!artifactId) throw new Error('canonical_artifact_missing');
      version += 1;
      await ctx.db.insert('artifactVersions', {
        caseId: args.caseId,
        artifactId,
        version,
        parentVersion: ownerCase.currentArtifactVersion,
        snapshotJson: proposal.payloadJson,
        snapshotDigest: proposal.payloadDigest,
        createdBy: args.actorRef,
        createdAt: now,
      });
      await ctx.db.patch(args.caseId, {
        currentArtifactVersion: version,
        status: 'execution',
        updatedAt: now,
      });
      await ctx.db.patch(args.runId, {
        status: 'running',
        currentStage: 'execution',
        updatedAt: now,
      });
    }
    await event(ctx, {
      caseId: args.caseId,
      runId: args.runId,
      kind: `proposal.${args.decision}`,
      payload: { proposalId: args.proposalId, proposalDigest: args.expectedDigest, version },
    });
    return { applied: args.decision === 'approved', reused: false, version };
  },
});

const executorQuote = v.object({
  executor: v.string(),
  job: v.string(),
  durationSeconds: v.number(),
  mediaLeavingDevice: v.array(v.string()),
  estimatedCredits: v.number(),
  currentBalanceCredits: v.number(),
  outputUse: v.string(),
  canonicalVideoAffected: v.boolean(),
  quotedAt: v.number(),
});

const executorManifest = v.object({
  schemaVersion: v.literal('nodevideo.executor-input-manifest/v1'),
  sourceAssetIds: v.array(v.string()),
  promptDigest: v.string(),
  parametersDigest: v.string(),
  rawMediaUploaded: v.boolean(),
});

export const proposeExecutorJob = mutation({
  args: {
    caseId: v.id('cases'),
    ownerKey: v.string(),
    runId: v.id('runs'),
    proposalId: v.id('proposals'),
    provider: v.string(),
    capability: v.string(),
    inputManifest: executorManifest,
    quote: executorQuote,
  },
  handler: async (ctx, args) => {
    await requireCase(ctx, args.caseId, args.ownerKey);
    const run = await ctx.db.get(args.runId);
    const proposal = await ctx.db.get(args.proposalId);
    if (!run || run.caseId !== args.caseId) throw new Error('run_not_found');
    if (!proposal || proposal.jobId !== run.jobId) throw new Error('proposal_not_found');
    if (args.quote.executor !== args.provider) throw new Error('executor_quote_provider_mismatch');
    if (args.quote.estimatedCredits < 0 || args.quote.currentBalanceCredits < 0) {
      throw new Error('executor_quote_credits_invalid');
    }
    if (args.quote.canonicalVideoAffected) {
      throw new Error('executor_may_not_mutate_canonical_video');
    }
    if (args.inputManifest.rawMediaUploaded) {
      throw new Error('executor_manifest_cannot_claim_prior_upload');
    }
    const inputManifestJson = boundedCanonicalJson(
      args.inputManifest,
      JSON_LIMIT,
      'executor_input_manifest',
    );
    const quoteJson = boundedCanonicalJson(args.quote, JSON_LIMIT, 'executor_quote');
    const quoteDigest = await sha256Digest(quoteJson);
    const now = Date.now();
    const executorJobId = await ctx.db.insert('executorJobs', {
      caseId: args.caseId,
      runId: args.runId,
      proposalId: args.proposalId,
      provider: required(args.provider, 'executor_provider', 120),
      capability: required(args.capability, 'executor_capability', 160),
      status: 'proposed',
      inputManifestJson,
      quoteJson,
      quoteDigest,
      createdAt: now,
      updatedAt: now,
    });
    await event(ctx, {
      caseId: args.caseId,
      runId: args.runId,
      kind: 'executor.proposed',
      payload: { executorJobId, quoteDigest, provider: args.provider, capability: args.capability },
    });
    return { executorJobId, quoteDigest };
  },
});

export const refreshExecutorQuote = mutation({
  args: {
    caseId: v.id('cases'),
    ownerKey: v.string(),
    executorJobId: v.id('executorJobs'),
    quote: executorQuote,
  },
  handler: async (ctx, args) => {
    await requireCase(ctx, args.caseId, args.ownerKey);
    const job = await ctx.db.get(args.executorJobId);
    if (!job || job.caseId !== args.caseId) throw new Error('executor_job_not_found');
    if (['submitted', 'running', 'completed'].includes(job.status)) {
      throw new Error('executor_quote_cannot_change_after_submission');
    }
    if (args.quote.executor !== job.provider) throw new Error('executor_quote_provider_mismatch');
    const quoteJson = boundedCanonicalJson(args.quote, JSON_LIMIT, 'executor_quote');
    const quoteDigest = await sha256Digest(quoteJson);
    const invalidated = Boolean(job.approvedQuoteDigest && job.approvedQuoteDigest !== quoteDigest);
    const now = Date.now();
    await ctx.db.patch(args.executorJobId, {
      quoteJson,
      quoteDigest,
      status: invalidated ? 'quote_invalidated' : 'proposed',
      approvedQuoteDigest: invalidated ? undefined : job.approvedQuoteDigest,
      updatedAt: now,
    });
    await event(ctx, {
      caseId: args.caseId,
      runId: job.runId,
      kind: invalidated ? 'executor.approval_invalidated' : 'executor.quote_refreshed',
      payload: { executorJobId: args.executorJobId, quoteDigest },
    });
    return { quoteDigest, approvalInvalidated: invalidated };
  },
});

export const approveExecutorJob = mutation({
  args: {
    caseId: v.id('cases'),
    ownerKey: v.string(),
    executorJobId: v.id('executorJobs'),
    expectedQuoteDigest: v.string(),
  },
  handler: async (ctx, args) => {
    await requireCase(ctx, args.caseId, args.ownerKey);
    const job = await ctx.db.get(args.executorJobId);
    if (!job || job.caseId !== args.caseId) throw new Error('executor_job_not_found');
    if (!['proposed', 'quote_invalidated', 'approved'].includes(job.status)) {
      throw new Error('executor_job_not_approvable');
    }
    const currentDigest = await sha256Digest(job.quoteJson);
    if (currentDigest !== args.expectedQuoteDigest)
      throw new Error('executor_quote_digest_mismatch');
    if (job.status === 'approved' && job.approvedQuoteDigest === currentDigest) {
      return { quoteDigest: currentDigest, reused: true };
    }
    await ctx.db.patch(args.executorJobId, {
      status: 'approved',
      approvedQuoteDigest: currentDigest,
      updatedAt: Date.now(),
    });
    await event(ctx, {
      caseId: args.caseId,
      runId: job.runId,
      kind: 'executor.approved',
      payload: { executorJobId: args.executorJobId, quoteDigest: currentDigest },
    });
    return { quoteDigest: currentDigest, reused: false };
  },
});

export const chooseExecutorAlternative = mutation({
  args: {
    caseId: v.id('cases'),
    ownerKey: v.string(),
    executorJobId: v.id('executorJobs'),
    decision: v.union(v.literal('decline'), v.literal('local_alternative')),
  },
  handler: async (ctx, args) => {
    await requireCase(ctx, args.caseId, args.ownerKey);
    const job = await ctx.db.get(args.executorJobId);
    if (!job || job.caseId !== args.caseId) throw new Error('executor_job_not_found');
    if (['submitted', 'running', 'completed'].includes(job.status)) {
      throw new Error('executor_job_already_started');
    }
    if (job.status === 'cancelled') return { cancelled: true, reused: true };
    await ctx.db.patch(args.executorJobId, {
      status: 'cancelled',
      approvedQuoteDigest: undefined,
      error: args.decision,
      updatedAt: Date.now(),
    });
    await event(ctx, {
      caseId: args.caseId,
      runId: job.runId,
      kind:
        args.decision === 'decline' ? 'executor.declined' : 'executor.local_alternative_selected',
      payload: { executorJobId: args.executorJobId, quoteDigest: job.quoteDigest },
    });
    return { cancelled: true, reused: false };
  },
});

export const markExecutorSubmitted = mutation({
  args: {
    caseId: v.id('cases'),
    ownerKey: v.string(),
    executorJobId: v.id('executorJobs'),
    expectedQuoteDigest: v.string(),
    providerJobId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireCase(ctx, args.caseId, args.ownerKey);
    const job = await ctx.db.get(args.executorJobId);
    if (!job || job.caseId !== args.caseId) throw new Error('executor_job_not_found');
    const currentDigest = await sha256Digest(job.quoteJson);
    if (
      job.status !== 'approved' ||
      job.approvedQuoteDigest !== currentDigest ||
      currentDigest !== args.expectedQuoteDigest
    ) {
      throw new Error('executor_submission_requires_current_exact_approval');
    }
    const providerJobId = required(args.providerJobId, 'provider_job_id', 256);
    await ctx.db.patch(args.executorJobId, {
      status: 'submitted',
      providerJobId,
      updatedAt: Date.now(),
    });
    await event(ctx, {
      caseId: args.caseId,
      runId: job.runId,
      kind: 'executor.submitted',
      payload: { executorJobId: args.executorJobId, providerJobId, quoteDigest: currentDigest },
    });
    return { submitted: true };
  },
});

export const issueConsumerReceipt = mutation({
  args: {
    caseId: v.id('cases'),
    ownerKey: v.string(),
    runId: v.id('runs'),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const ownerCase = await requireCase(ctx, args.caseId, args.ownerKey);
    const run = await ctx.db.get(args.runId);
    if (!run || run.caseId !== args.caseId) throw new Error('run_not_found');
    const payloadJson = boundedCanonicalJson(args.payload, JSON_LIMIT, 'consumer_receipt');
    const payloadDigest = await sha256Digest(payloadJson);
    const existing = await ctx.db
      .query('receipts')
      .withIndex('by_run_createdAt', (q) => q.eq('runId', args.runId))
      .filter((q) => q.eq(q.field('payloadDigest'), payloadDigest))
      .first();
    if (existing) return { receiptId: existing._id, payloadDigest, reused: true };
    const now = Date.now();
    const receiptId = await ctx.db.insert('receipts', {
      caseId: args.caseId,
      runId: args.runId,
      kind: 'nodekit.consumer-proof/v1',
      payloadJson,
      payloadDigest,
      createdAt: now,
    });
    await ctx.db.patch(args.caseId, { status: 'completed', updatedAt: now });
    await ctx.db.patch(args.runId, {
      status: 'completed',
      currentStage: 'receipt',
      updatedAt: now,
    });
    await event(ctx, {
      caseId: args.caseId,
      runId: args.runId,
      kind: 'receipt.created',
      payload: { receiptId, payloadDigest, artifactVersion: ownerCase.currentArtifactVersion },
    });
    return { receiptId, payloadDigest, reused: false };
  },
});

export const getCampaign = query({
  args: { caseId: v.id('cases'), ownerKey: v.string() },
  handler: async (ctx, args) => {
    const ownerCase = await requireCase(ctx, args.caseId, args.ownerKey);
    const runs = await ctx.db
      .query('runs')
      .withIndex('by_case_updatedAt', (q) => q.eq('caseId', args.caseId))
      .collect();
    const run = runs.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!run) throw new Error('campaign_run_missing');
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_thread_createdAt', (q) => q.eq('threadId', run.threadId))
      .collect();
    const proposals = await ctx.db
      .query('proposals')
      .withIndex('by_job_status', (q) => q.eq('jobId', run.jobId))
      .collect();
    const selectedArtifactId = ownerCase.selectedArtifactId;
    const versions = selectedArtifactId
      ? await ctx.db
          .query('artifactVersions')
          .withIndex('by_artifact_version', (q) => q.eq('artifactId', selectedArtifactId))
          .collect()
      : [];
    const executorJobs = await ctx.db
      .query('executorJobs')
      .withIndex('by_run_updatedAt', (q) => q.eq('runId', run._id))
      .collect();
    const receipts = await ctx.db
      .query('receipts')
      .withIndex('by_run_createdAt', (q) => q.eq('runId', run._id))
      .collect();
    const timeline = await ctx.db
      .query('timelineEvents')
      .withIndex('by_case_sequence', (q) => q.eq('caseId', args.caseId))
      .collect();
    return {
      case: ownerCase,
      run,
      messages,
      proposals,
      versions,
      executorJobs,
      receipts,
      timeline,
    };
  },
});
