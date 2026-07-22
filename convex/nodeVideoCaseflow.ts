import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx, mutation, query } from './_generated/server';
import {
  createCaseRecord,
  decideProposalRecord,
  resolveExceptionRecord,
  startRunRecord,
} from './caseflowRuntime';
import { assertBoundedString, boundedCanonicalJson, sha256Digest } from './lib/durability';
import { STAGES, createSourceOnlyCaseRecord, startJobRecord } from './workflow';

type AuthContext = Pick<MutationCtx | QueryCtx, 'auth'>;

async function authenticatedOwnerIdentity(ctx: AuthContext): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) throw new Error('authentication_required');
  return identity.tokenIdentifier || `${identity.issuer}|${identity.subject}`;
}

async function requireOwnedProject(
  ctx: MutationCtx | QueryCtx,
  projectId: Id<'nodeVideoProjects'>,
): Promise<Doc<'nodeVideoProjects'>> {
  const ownerIdentity = await authenticatedOwnerIdentity(ctx);
  const project = await ctx.db.get(projectId);
  if (project === null || project.ownerIdentity !== ownerIdentity) {
    throw new Error('project_not_found_or_forbidden');
  }
  return project;
}

async function requestHash(value: unknown): Promise<string> {
  const json = boundedCanonicalJson(value, 96 * 1024, 'caseflow_start_request');
  return (await sha256Digest(json)).slice('sha256:'.length);
}

function caseflowStages() {
  return STAGES.map((stage) => ({
    id: stage,
    label: stage.replaceAll('_', ' '),
    owner:
      stage === 'await_review'
        ? 'user'
        : stage === 'evaluate_hidden_target'
          ? 'evaluator'
          : 'worker',
  }));
}

async function bindingResult(
  ctx: MutationCtx,
  binding: Doc<'nodeVideoCaseflowBindings'>,
  reused: boolean,
) {
  const caseflowCase = await ctx.db.get(binding.caseflowCaseId);
  const caseflowRun = await ctx.db.get(binding.caseflowRunId);
  const domainCase = await ctx.db.get(binding.sourceOnlyCaseId);
  const domainJob = await ctx.db.get(binding.jobId);
  if (caseflowCase === null || caseflowRun === null || domainCase === null || domainJob === null) {
    throw new Error('caseflow_binding_is_incomplete');
  }
  return {
    bindingId: binding._id,
    caseId: caseflowCase._id,
    jobId: domainJob._id,
    reused,
    runId: caseflowRun._id,
    sourceOnlyCaseId: domainCase._id,
  };
}

export const createProject = mutation({
  args: { title: v.string() },
  returns: v.object({ projectId: v.id('nodeVideoProjects') }),
  handler: async (ctx, args) => {
    const ownerIdentity = await authenticatedOwnerIdentity(ctx);
    const now = Date.now();
    const projectId = await ctx.db.insert('nodeVideoProjects', {
      createdAt: now,
      ownerIdentity,
      title: assertBoundedString(args.title, 256, 'project_title'),
      updatedAt: now,
    });
    return { projectId };
  },
});

/**
 * Atomically binds a portable Caseflow case/run to NodeVideo's existing
 * source-only case, 19-stage job, and job event stream. The caller supplies a
 * project locator; authenticated ownership is always resolved server-side.
 */
export const startProjectCaseflow = mutation({
  args: {
    idempotencyKey: v.string(),
    input: v.any(),
    primaryJob: v.string(),
    projectId: v.id('nodeVideoProjects'),
    title: v.string(),
  },
  returns: v.object({
    bindingId: v.id('nodeVideoCaseflowBindings'),
    caseId: v.id('caseflowCases'),
    jobId: v.id('jobs'),
    reused: v.boolean(),
    runId: v.id('caseflowRuns'),
    sourceOnlyCaseId: v.id('sourceOnlyCases'),
  }),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.projectId);
    const idempotencyKey = assertBoundedString(
      args.idempotencyKey,
      200,
      'caseflow_idempotency_key',
    );
    const hash = await requestHash({
      input: args.input,
      primaryJob: args.primaryJob,
      title: args.title,
    });
    const existing = await ctx.db
      .query('nodeVideoCaseflowBindings')
      .withIndex('by_project_idempotency', (builder) =>
        builder.eq('projectId', project._id).eq('idempotencyKey', idempotencyKey),
      )
      .unique();
    if (existing !== null) {
      if (existing.requestHash !== hash) {
        throw new Error('idempotency_key_reused_with_different_input');
      }
      return bindingResult(ctx, existing, true);
    }

    const inputJson = boundedCanonicalJson(args.input, 96 * 1024, 'case_input');
    const inputDigest = await sha256Digest(inputJson);
    const domainCase = await createSourceOnlyCaseRecord(ctx, {
      idempotencyKey: `caseflow:${idempotencyKey}`,
      input: args.input,
      inputDigest,
      projectId: project._id,
    });
    const domainJob = await startJobRecord(ctx, {
      caseId: domainCase.caseId,
      idempotencyKey: `caseflow:${idempotencyKey}`,
      inputDigest,
    });
    const domainJobRecord = await ctx.db.get(domainJob.jobId);
    if (domainJobRecord === null || domainJobRecord.caseId !== domainCase.caseId) {
      throw new Error('domain_job_idempotency_scope_conflict');
    }
    const componentCase = await createCaseRecord(ctx, {
      actor: { id: project.ownerIdentity, type: 'user' },
      primaryJob: args.primaryJob,
      title: args.title,
    });
    const componentRun = await startRunRecord(ctx, {
      actor: { id: project.ownerIdentity, type: 'user' },
      caseId: componentCase.caseId,
      stages: caseflowStages(),
    });
    const now = Date.now();
    await ctx.db.insert('caseflowExternalRefs', {
      caseId: componentCase.caseId,
      externalId: domainCase.caseId,
      kind: 'source-only-case',
      namespace: 'nodevideo',
      createdAt: now,
    });
    await ctx.db.insert('caseflowExternalRefs', {
      caseId: componentCase.caseId,
      externalId: domainJob.jobId,
      kind: 'source-only-job',
      namespace: 'nodevideo',
      runId: componentRun.runId,
      createdAt: now,
    });
    const bindingId = await ctx.db.insert('nodeVideoCaseflowBindings', {
      caseflowCaseId: componentCase.caseId,
      caseflowRunId: componentRun.runId,
      createdAt: now,
      idempotencyKey,
      jobId: domainJob.jobId,
      projectId: project._id,
      requestHash: hash,
      sourceOnlyCaseId: domainCase.caseId,
      updatedAt: now,
    });
    const binding = await ctx.db.get(bindingId);
    if (binding === null) throw new Error('caseflow binding insert failed');
    return bindingResult(ctx, binding, false);
  },
});

export const readProjectCaseflow = query({
  args: { caseId: v.id('caseflowCases'), projectId: v.id('nodeVideoProjects') },
  returns: v.any(),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.projectId);
    const binding = await ctx.db
      .query('nodeVideoCaseflowBindings')
      .withIndex('by_project_case', (builder) =>
        builder.eq('projectId', project._id).eq('caseflowCaseId', args.caseId),
      )
      .unique();
    if (binding === null) throw new Error('caseflow_case_not_found_or_forbidden');
    const [caseflowCase, caseflowRun, domainCase, domainJob, domainStages, domainEvents, refs] =
      await Promise.all([
        ctx.db.get(binding.caseflowCaseId),
        ctx.db.get(binding.caseflowRunId),
        ctx.db.get(binding.sourceOnlyCaseId),
        ctx.db.get(binding.jobId),
        ctx.db
          .query('jobStages')
          .withIndex('by_job_ordinal', (builder) => builder.eq('jobId', binding.jobId))
          .collect(),
        ctx.db
          .query('jobEvents')
          .withIndex('by_job_sequence', (builder) => builder.eq('jobId', binding.jobId))
          .collect(),
        ctx.db
          .query('caseflowExternalRefs')
          .withIndex('by_case', (builder) => builder.eq('caseId', binding.caseflowCaseId))
          .collect(),
      ]);
    if (
      caseflowCase === null ||
      caseflowRun === null ||
      domainCase === null ||
      domainJob === null
    ) {
      throw new Error('caseflow_binding_is_incomplete');
    }
    return {
      binding,
      component: { case: caseflowCase, externalRefs: refs, run: caseflowRun },
      domain: { case: domainCase, events: domainEvents, job: domainJob, stages: domainStages },
    };
  },
});

export const decideProjectProposal = mutation({
  args: {
    comment: v.optional(v.string()),
    decision: v.union(v.literal('accepted'), v.literal('rejected')),
    projectId: v.id('nodeVideoProjects'),
    proposalId: v.id('caseflowProposals'),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.projectId);
    const proposal = await ctx.db.get(args.proposalId);
    if (proposal === null) throw new Error('proposal_not_found_or_forbidden');
    const artifact = await ctx.db.get(proposal.artifactId);
    if (artifact === null) throw new Error('proposal_not_found_or_forbidden');
    const binding = await ctx.db
      .query('nodeVideoCaseflowBindings')
      .withIndex('by_project_case', (builder) =>
        builder.eq('projectId', project._id).eq('caseflowCaseId', artifact.caseId),
      )
      .unique();
    if (binding === null) throw new Error('proposal_not_found_or_forbidden');
    return decideProposalRecord(ctx, {
      actor: { id: project.ownerIdentity, type: 'user' },
      comment: args.comment,
      decision: args.decision,
      proposalId: args.proposalId,
    });
  },
});

export const resolveProjectException = mutation({
  args: {
    exceptionId: v.id('caseflowExceptions'),
    nextAction: v.optional(v.string()),
    nextActionOwner: v.optional(v.string()),
    projectId: v.id('nodeVideoProjects'),
    resolution: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.projectId);
    const exception = await ctx.db.get(args.exceptionId);
    if (exception === null) throw new Error('exception_not_found_or_forbidden');
    const run = await ctx.db.get(exception.runId);
    if (run === null) throw new Error('exception_not_found_or_forbidden');
    const binding = await ctx.db
      .query('nodeVideoCaseflowBindings')
      .withIndex('by_project_case', (builder) =>
        builder.eq('projectId', project._id).eq('caseflowCaseId', run.caseId),
      )
      .unique();
    if (binding === null) throw new Error('exception_not_found_or_forbidden');
    return resolveExceptionRecord(ctx, {
      actor: { id: project.ownerIdentity, type: 'user' },
      exceptionId: args.exceptionId,
      nextAction: args.nextAction,
      nextActionOwner: args.nextActionOwner,
      resolution: args.resolution,
    });
  },
});
