import { type ComponentApi, createNodeKitCaseflowClient } from '@homenshum/nodekit/convex-caseflow';
import { v } from 'convex/values';
import { components } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx, mutation, query } from './_generated/server';
import { assertBoundedString, boundedCanonicalJson, sha256Digest } from './lib/durability';
import { STAGES, createSourceOnlyCaseRecord, startJobRecord } from './workflow';

type AuthContext = Pick<MutationCtx | QueryCtx, 'auth'>;
type HostContext = MutationCtx | QueryCtx;

const caseflow = createNodeKitCaseflowClient(
  (components as unknown as { nodekitCaseflow: ComponentApi }).nodekitCaseflow,
);

async function authenticatedOwnerIdentity(ctx: AuthContext): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) throw new Error('authentication_required');
  return identity.tokenIdentifier || `${identity.issuer}|${identity.subject}`;
}

async function requireOwnedProject(
  ctx: HostContext,
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
  const json = boundedCanonicalJson(value, 96 * 1024, 'caseflow_request');
  return (await sha256Digest(json)).slice('sha256:'.length);
}

async function projectScopeKey(project: Doc<'nodeVideoProjects'>): Promise<string> {
  return `nodevideo:${await requestHash({
    namespace: 'nodevideo-caseflow/v1',
    ownerIdentity: project.ownerIdentity,
    projectId: project._id,
  })}`;
}

function actor(project: Doc<'nodeVideoProjects'>) {
  return { id: project.ownerIdentity, type: 'user' } as const;
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

async function requireBinding(ctx: HostContext, project: Doc<'nodeVideoProjects'>, caseId: string) {
  const binding = await ctx.db
    .query('nodeVideoCaseflowBindings')
    .withIndex('by_project_case', (builder) =>
      builder.eq('projectId', project._id).eq('caseflowCaseId', caseId),
    )
    .unique();
  if (binding === null) throw new Error('caseflow_case_not_found_or_forbidden');
  return binding;
}

async function bindingResult(
  ctx: HostContext,
  project: Doc<'nodeVideoProjects'>,
  binding: Doc<'nodeVideoCaseflowBindings'>,
  reused: boolean,
) {
  const scopeKey = await projectScopeKey(project);
  const [componentCase, componentRun, domainCase, domainJob] = await Promise.all([
    caseflow.getCase(ctx, { caseId: binding.caseflowCaseId, scopeKey }),
    caseflow.getRun(ctx, { runId: binding.caseflowRunId, scopeKey }),
    ctx.db.get(binding.sourceOnlyCaseId),
    ctx.db.get(binding.jobId),
  ]);
  if (
    componentCase === null ||
    componentRun === null ||
    domainCase === null ||
    domainJob === null
  ) {
    throw new Error('caseflow_binding_is_incomplete');
  }
  return {
    bindingId: binding._id,
    caseId: componentCase.caseId,
    jobId: domainJob._id,
    reused,
    runId: componentRun.runId,
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
 * Binds the installed NodeKit component to NodeVideo's existing source-only
 * case, 19-stage durable job, and authenticated project boundary.
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
    caseId: v.string(),
    jobId: v.id('jobs'),
    reused: v.boolean(),
    runId: v.string(),
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
      return bindingResult(ctx, project, existing, true);
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

    const scopeKey = await projectScopeKey(project);
    const componentCase = await caseflow.createCase(ctx, {
      actor: actor(project),
      primaryJob: assertBoundedString(args.primaryJob, 512, 'caseflow_primary_job'),
      scopeKey,
      title: assertBoundedString(args.title, 256, 'caseflow_title'),
    });
    const componentRun = await caseflow.startRun(ctx, {
      actor: actor(project),
      caseId: componentCase.caseId,
      scopeKey,
      stages: caseflowStages(),
    });
    const now = Date.now();
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
    if (binding === null) throw new Error('caseflow_binding_insert_failed');
    return bindingResult(ctx, project, binding, false);
  },
});

export const enterProjectStage = mutation({
  args: {
    caseId: v.string(),
    idempotencyKey: v.string(),
    nextAction: v.optional(v.string()),
    nextActionOwner: v.optional(v.string()),
    projectId: v.id('nodeVideoProjects'),
    stageId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.projectId);
    const binding = await requireBinding(ctx, project, args.caseId);
    return caseflow.enterStage(ctx, {
      actor: actor(project),
      idempotencyKey: args.idempotencyKey,
      nextAction: args.nextAction,
      nextActionOwner: args.nextActionOwner,
      runId: binding.caseflowRunId,
      scopeKey: await projectScopeKey(project),
      stageId: args.stageId,
    });
  },
});

export const publishProjectArtifact = mutation({
  args: {
    caseId: v.string(),
    content: v.any(),
    idempotencyKey: v.string(),
    kind: v.string(),
    projectId: v.id('nodeVideoProjects'),
    title: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.projectId);
    const binding = await requireBinding(ctx, project, args.caseId);
    return caseflow.createArtifact(ctx, {
      actor: actor(project),
      caseId: binding.caseflowCaseId,
      content: args.content,
      idempotencyKey: args.idempotencyKey,
      kind: args.kind,
      runId: binding.caseflowRunId,
      scopeKey: await projectScopeKey(project),
      title: args.title,
    });
  },
});

export const proposeProjectArtifact = mutation({
  args: {
    artifactId: v.string(),
    baseVersion: v.number(),
    idempotencyKey: v.string(),
    patch: v.any(),
    projectId: v.id('nodeVideoProjects'),
    rationale: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.projectId);
    const scopeKey = await projectScopeKey(project);
    const artifact = await caseflow.getArtifact(ctx, { artifactId: args.artifactId, scopeKey });
    if (artifact === null) throw new Error('artifact_not_found_or_forbidden');
    await requireBinding(ctx, project, artifact.caseId);
    return caseflow.createProposal(ctx, {
      actor: actor(project),
      artifactId: args.artifactId,
      baseVersion: args.baseVersion,
      idempotencyKey: args.idempotencyKey,
      patch: args.patch,
      rationale: args.rationale,
      scopeKey,
    });
  },
});

export const decideProjectProposal = mutation({
  args: {
    comment: v.optional(v.string()),
    decision: v.union(v.literal('accepted'), v.literal('rejected')),
    projectId: v.id('nodeVideoProjects'),
    proposalId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.projectId);
    return caseflow.decideProposal(ctx, {
      actor: actor(project),
      comment: args.comment,
      decision: args.decision,
      proposalId: args.proposalId,
      scopeKey: await projectScopeKey(project),
    });
  },
});

export const raiseProjectException = mutation({
  args: {
    caseId: v.string(),
    code: v.string(),
    idempotencyKey: v.string(),
    message: v.string(),
    preservedState: v.any(),
    projectId: v.id('nodeVideoProjects'),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.projectId);
    const binding = await requireBinding(ctx, project, args.caseId);
    return caseflow.raiseException(ctx, {
      actor: actor(project),
      code: args.code,
      idempotencyKey: args.idempotencyKey,
      message: args.message,
      preservedState: args.preservedState,
      runId: binding.caseflowRunId,
      scopeKey: await projectScopeKey(project),
    });
  },
});

export const resolveProjectException = mutation({
  args: {
    exceptionId: v.string(),
    nextAction: v.optional(v.string()),
    nextActionOwner: v.optional(v.string()),
    projectId: v.id('nodeVideoProjects'),
    resolution: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.projectId);
    return caseflow.resolveException(ctx, {
      actor: actor(project),
      exceptionId: args.exceptionId,
      nextAction: args.nextAction,
      nextActionOwner: args.nextActionOwner,
      resolution: args.resolution,
      scopeKey: await projectScopeKey(project),
    });
  },
});

async function terminateProjectRun(
  ctx: MutationCtx,
  args: {
    caseId: string;
    projectId: Id<'nodeVideoProjects'>;
    reason?: string;
  },
  status: 'cancelled' | 'completed' | 'failed_safely',
) {
  const project = await requireOwnedProject(ctx, args.projectId);
  const binding = await requireBinding(ctx, project, args.caseId);
  const common = {
    actor: actor(project),
    runId: binding.caseflowRunId,
    scopeKey: await projectScopeKey(project),
  };
  if (status === 'completed') return caseflow.completeRun(ctx, common);
  if (status === 'cancelled') return caseflow.cancelRun(ctx, { ...common, reason: args.reason });
  return caseflow.failRunSafely(ctx, { ...common, reason: args.reason });
}

export const completeProjectRun = mutation({
  args: { caseId: v.string(), projectId: v.id('nodeVideoProjects') },
  returns: v.any(),
  handler: (ctx, args) => terminateProjectRun(ctx, args, 'completed'),
});

export const cancelProjectRun = mutation({
  args: {
    caseId: v.string(),
    projectId: v.id('nodeVideoProjects'),
    reason: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => terminateProjectRun(ctx, args, 'cancelled'),
});

export const failProjectRunSafely = mutation({
  args: {
    caseId: v.string(),
    projectId: v.id('nodeVideoProjects'),
    reason: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => terminateProjectRun(ctx, args, 'failed_safely'),
});

export const readProjectCaseflow = query({
  args: { caseId: v.string(), projectId: v.id('nodeVideoProjects') },
  returns: v.any(),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.projectId);
    const binding = await requireBinding(ctx, project, args.caseId);
    const scopeKey = await projectScopeKey(project);
    const [componentCase, componentRun, domainCase, domainJob, domainStages, domainEvents] =
      await Promise.all([
        caseflow.getCase(ctx, { caseId: binding.caseflowCaseId, scopeKey }),
        caseflow.getRun(ctx, { runId: binding.caseflowRunId, scopeKey }),
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
      ]);
    if (
      componentCase === null ||
      componentRun === null ||
      domainCase === null ||
      domainJob === null
    ) {
      throw new Error('caseflow_binding_is_incomplete');
    }
    const [receipt, timeline, pendingApprovals] = await Promise.all([
      caseflow.getReceiptForRun(ctx, { runId: binding.caseflowRunId, scopeKey }),
      caseflow.getTimeline(ctx, {
        aggregateId: binding.caseflowRunId,
        aggregateType: 'run',
        limit: 200,
        scopeKey,
      }),
      caseflow.listPendingApprovals(ctx, { limit: 200, scopeKey }),
    ]);
    return {
      binding,
      component: {
        case: componentCase,
        pendingApprovals,
        receipt,
        run: componentRun,
        timeline,
      },
      domain: { case: domainCase, events: domainEvents, job: domainJob, stages: domainStages },
    };
  },
});
