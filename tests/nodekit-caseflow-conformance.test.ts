import {
  type CaseflowRuntime,
  type NodeKitActor,
  type NodeKitArtifact,
  type NodeKitCaseflowSnapshot,
  type NodeKitException,
  type NodeKitProposal,
  contentHash,
  runCaseflowConformance,
  runtimeProfiles,
} from '@homenshum/nodekit/caseflow';
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import schema from '../convex/schema';
import verdict from '../fixtures/proof/nodekit-caseflow-consumer-verdict.json';
import consumerPackage from '../package.json';

const modules = import.meta.glob('../convex/**/*.ts');

function caseflowRuntime(t: ReturnType<typeof convexTest>): CaseflowRuntime {
  return {
    capabilities: runtimeProfiles.convex,
    completeRun: (args) => t.mutation(internal.caseflowRuntime.completeRun, args),
    createArtifact: async <T>(args: {
      actor?: NodeKitActor;
      caseId: string;
      content: T;
      kind?: string;
      runId: string;
      title?: string;
    }) => (await t.mutation(internal.caseflowRuntime.createArtifact, args)) as NodeKitArtifact<T>,
    createCase: (args) => t.mutation(internal.caseflowRuntime.createCase, args),
    createProposal: async <T>(args: {
      actor?: NodeKitActor;
      artifactId: string;
      baseVersion: number;
      patch: T;
      rationale?: string;
    }) => (await t.mutation(internal.caseflowRuntime.createProposal, args)) as NodeKitProposal<T>,
    decideProposal: (args) => t.mutation(internal.caseflowRuntime.decideProposal, args),
    enterStage: (args) => t.mutation(internal.caseflowRuntime.enterStage, args),
    raiseException: async <T>(args: {
      actor?: NodeKitActor;
      code?: string;
      message?: string;
      preservedState?: T;
      runId: string;
    }) => (await t.mutation(internal.caseflowRuntime.raiseException, args)) as NodeKitException<T>,
    resolveException: (args) => t.mutation(internal.caseflowRuntime.resolveException, args),
    snapshot: async () =>
      (await t.query(internal.caseflowRuntime.snapshot, {})) as NodeKitCaseflowSnapshot,
    startRun: (args) => t.mutation(internal.caseflowRuntime.startRun, args),
  };
}

async function createBoundedRun(runtime: ReturnType<typeof caseflowRuntime>) {
  const work = await runtime.createCase({
    primaryJob: 'Produce one reviewed NodeVideo artifact',
    title: 'NodeVideo Caseflow test',
  });
  const run = await runtime.startRun({
    caseId: work.caseId,
    stages: [
      { id: 'working', label: 'Prepare', owner: 'worker' },
      { id: 'review', label: 'Review', owner: 'user' },
      { id: 'complete', label: 'Complete', owner: 'system' },
    ],
  });
  return { run, work };
}

describe('NodeKit Caseflow Convex consumer', () => {
  it('passes the packaged conformance suite against durable Convex state', async () => {
    const t = convexTest(schema, modules);
    const verdict = await runCaseflowConformance(() => caseflowRuntime(t));

    expect(verdict.passed).toBe(true);
    expect(verdict.capabilityNegotiation).toMatchObject({ passed: true, provider: 'convex' });
    expect(verdict.assertions).toEqual({
      activeRunStartIsIdempotent: true,
      canonicalVersionAdvancedOnce: true,
      contentAddressedReceipt: true,
      exceptionStatePreserved: true,
      nextActionOwnerExplicit: true,
      oneAuthoritativeCase: true,
      repeatedCompletionIsIdempotent: true,
      repeatedDecisionIsIdempotent: true,
      staleProposalFailedClosed: true,
    });

    const snapshot = await t.query(internal.caseflowRuntime.snapshot, {});
    expect(snapshot.cases).toHaveLength(1);
    expect(snapshot.approvals).toHaveLength(2);
    expect(snapshot.artifacts[0].versions).toHaveLength(2);
    expect(snapshot.receipts).toHaveLength(1);
  });

  it('resolves project scope from auth and denies cross-owner access', async () => {
    const t = convexTest(schema, modules);
    const ownerA = t.withIdentity({ issuer: 'https://auth.nodevideo.test', subject: 'owner-a' });
    const ownerB = t.withIdentity({ issuer: 'https://auth.nodevideo.test', subject: 'owner-b' });
    const { projectId } = await ownerA.mutation(api.nodeVideoCaseflow.createProject, {
      title: 'Owner A private project',
    });
    const request = {
      idempotencyKey: 'upload-001',
      input: { brief: 'Cut on phrase boundaries', sourceAssetIds: ['source-a', 'source-b'] },
      primaryJob: 'Render a source-only edit for review',
      projectId,
      title: 'Private creator edit',
    };

    await expect(t.mutation(api.nodeVideoCaseflow.startProjectCaseflow, request)).rejects.toThrow(
      'authentication_required',
    );
    const first = await ownerA.mutation(api.nodeVideoCaseflow.startProjectCaseflow, request);
    const repeated = await ownerA.mutation(api.nodeVideoCaseflow.startProjectCaseflow, request);
    expect(repeated).toEqual({ ...first, reused: true });
    await expect(
      ownerA.mutation(api.nodeVideoCaseflow.startProjectCaseflow, {
        ...request,
        input: { brief: 'Different request' },
      }),
    ).rejects.toThrow('idempotency_key_reused_with_different_input');
    await expect(
      ownerB.query(api.nodeVideoCaseflow.readProjectCaseflow, {
        caseId: first.caseId,
        projectId,
      }),
    ).rejects.toThrow('project_not_found_or_forbidden');

    const internalRuntime = caseflowRuntime(t);
    const artifact = await internalRuntime.createArtifact({
      caseId: first.caseId,
      content: { status: 'draft' },
      runId: first.runId,
      title: 'Owner-scoped edit plan',
    });
    const proposal = await internalRuntime.createProposal({
      artifactId: artifact.artifactId,
      baseVersion: 1,
      patch: { status: 'reviewed' },
    });
    await expect(
      ownerB.mutation(api.nodeVideoCaseflow.decideProjectProposal, {
        decision: 'accepted',
        projectId,
        proposalId: proposal.proposalId as Id<'caseflowProposals'>,
      }),
    ).rejects.toThrow('project_not_found_or_forbidden');
    const ownerDecision = await ownerA.mutation(api.nodeVideoCaseflow.decideProjectProposal, {
      decision: 'accepted',
      projectId,
      proposalId: proposal.proposalId as Id<'caseflowProposals'>,
    });
    expect(ownerDecision).toMatchObject({ reused: false });

    const snapshot = await ownerA.query(api.nodeVideoCaseflow.readProjectCaseflow, {
      caseId: first.caseId,
      projectId,
    });
    expect(snapshot.binding.requestHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(snapshot.component.externalRefs.map((reference) => reference.kind).sort()).toEqual([
      'source-only-case',
      'source-only-job',
    ]);
    expect(snapshot.domain.case.projectId).toBe(projectId);
    expect(snapshot.domain.job._id).toBe(first.jobId);
    expect(snapshot.domain.stages).toHaveLength(19);
    expect(snapshot.domain.events.map((event) => event.kind)).toContain('job.created');
  });

  it('applies one same-base proposal and fails the stale proposal closed', async () => {
    const t = convexTest(schema, modules);
    const runtime = caseflowRuntime(t);
    const { run, work } = await createBoundedRun(runtime);
    const artifact = await runtime.createArtifact({
      caseId: work.caseId,
      content: { value: 1 },
      runId: run.runId,
      title: 'Edit plan',
    });
    const accepted = await runtime.createProposal({
      artifactId: artifact.artifactId,
      baseVersion: 1,
      patch: { value: 2 },
    });
    const stale = await runtime.createProposal({
      artifactId: artifact.artifactId,
      baseVersion: 1,
      patch: { value: 99 },
    });

    const first = await runtime.decideProposal({
      decision: 'accepted',
      proposalId: accepted.proposalId,
    });
    const repeated = await runtime.decideProposal({
      decision: 'accepted',
      proposalId: accepted.proposalId,
    });
    const conflicted = await runtime.decideProposal({
      decision: 'accepted',
      proposalId: stale.proposalId,
    });

    expect(first.reused).toBe(false);
    expect(repeated).toMatchObject({ reused: true });
    expect(repeated.approval.approvalId).toBe(first.approval.approvalId);
    expect(conflicted.proposal.status).toBe('conflicted');
    expect(conflicted.artifact.canonicalVersion).toBe(2);
    expect(conflicted.artifact.versions.at(-1)?.content).toEqual({ value: 2 });
    await expect(
      runtime.decideProposal({ decision: 'rejected', proposalId: accepted.proposalId }),
    ).rejects.toThrow('proposal is already accepted');
  });

  it('recovers an exception and resumes after constructing a fresh adapter', async () => {
    const t = convexTest(schema, modules);
    const firstRuntime = caseflowRuntime(t);
    const { run } = await createBoundedRun(firstRuntime);
    const raised = await firstRuntime.raiseException({
      code: 'worker_interrupted',
      message: 'The render worker stopped after a durable checkpoint.',
      preservedState: { completedFrames: 120, checkpoint: 'sha256:checkpoint' },
      runId: run.runId,
    });
    await expect(firstRuntime.completeRun({ runId: run.runId })).rejects.toThrow(
      'run has unresolved exceptions',
    );

    const reloadedRuntime = caseflowRuntime(t);
    const blocked = await reloadedRuntime.snapshot();
    expect(blocked.runs[0]).toMatchObject({ nextActionOwner: 'user', status: 'blocked' });
    expect(blocked.exceptions[0].preservedState).toEqual({
      checkpoint: 'sha256:checkpoint',
      completedFrames: 120,
    });
    const recovered = await reloadedRuntime.resolveException({
      exceptionId: raised.exceptionId,
      nextAction: 'Resume from checkpoint',
      nextActionOwner: 'worker',
      resolution: 'A replacement worker claimed the durable checkpoint.',
    });
    expect(recovered.run).toMatchObject({
      nextAction: 'Resume from checkpoint',
      nextActionOwner: 'worker',
      status: 'active',
    });
    await reloadedRuntime.enterStage({ runId: run.runId, stageId: 'complete' });
    const completed = await reloadedRuntime.completeRun({ runId: run.runId });
    expect(completed.run.status).toBe('completed');
  });

  it('keeps one stable content-addressed receipt and detects stored tampering', async () => {
    const t = convexTest(schema, modules);
    const runtime = caseflowRuntime(t);
    const { run, work } = await createBoundedRun(runtime);
    await runtime.createArtifact({
      caseId: work.caseId,
      content: { export: 'nodevideo-final.mp4', sha256: 'a'.repeat(64) },
      kind: 'render-receipt',
      runId: run.runId,
      title: 'Render receipt',
    });
    const completed = await runtime.completeRun({ runId: run.runId });
    const repeated = await runtime.completeRun({ runId: run.runId });
    const { receiptHash, receiptId, ...receiptBody } = completed.receipt;

    expect(receiptHash).toBe(contentHash(receiptBody));
    expect(repeated).toMatchObject({ reused: true });
    expect(repeated.receipt).toEqual(completed.receipt);
    const snapshot = await runtime.snapshot();
    expect(snapshot.receipts).toHaveLength(1);

    await t.run(async (ctx) => {
      await ctx.db.patch(receiptId as Id<'caseflowReceipts'>, { receiptHash: '0'.repeat(64) });
    });
    await expect(runtime.completeRun({ runId: run.runId })).rejects.toThrow(
      'receipt_hash_mismatch',
    );
  });

  it('keeps the local consumer verdict immutable and tied to the pinned source', () => {
    const { evidenceHash, ...body } = verdict;
    expect(evidenceHash).toBe(contentHash(body));
    expect(verdict.status).toBe('passed');
    expect(verdict.consumer.commit).toBe('5562337b69ffd022642012d593470d8c417748f2');
    expect(verdict.nodekit.sourceHash).toBe(
      '0ced0adf6e0f719be9a5fabefd69754a79102f39b6b6a54b20daeb60ceba7c0b',
    );
    expect(consumerPackage.dependencies['@homenshum/nodekit']).toContain(verdict.nodekit.commit);
    expect(verdict.commands.every((command) => command.passed)).toBe(true);
    const { deployed, published, ...behaviorAssertions } = verdict.assertions;
    expect(Object.values(behaviorAssertions).every(Boolean)).toBe(true);
    expect(deployed).toBe(false);
    expect(published).toBe(false);
  });
});
