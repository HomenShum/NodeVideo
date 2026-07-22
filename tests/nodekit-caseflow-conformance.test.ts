import { contentHash } from '@homenshum/nodekit/caseflow';
import { register } from '@homenshum/nodekit/test';
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob(['../convex/**/*.ts', '!../convex/convex.config.ts']);

function testRuntime() {
  const t = convexTest(schema, modules);
  register(t, 'nodekitCaseflow');
  return t;
}

async function createProjectRun(
  t: ReturnType<typeof testRuntime>,
  owner: ReturnType<ReturnType<typeof testRuntime>['withIdentity']>,
  suffix: string,
) {
  const { projectId } = await owner.mutation(api.nodeVideoCaseflow.createProject, {
    title: `NodeVideo private project ${suffix}`,
  });
  const request = {
    idempotencyKey: `source-only-edit-${suffix}`,
    input: {
      brief: 'Build a phrase-aligned, source-only creator edit with review before freeze.',
      referenceAssetSha256: 'a'.repeat(64),
      sourceAssetSha256: 'b'.repeat(64),
    },
    primaryJob: 'Produce one reviewed and frozen NodeVideo edit plan',
    projectId,
    title: `Creator edit ${suffix}`,
  };
  const started = await owner.mutation(api.nodeVideoCaseflow.startProjectCaseflow, request);
  return { projectId, request, started };
}

describe('NodeVideo consumes the packed NodeKit Convex component', () => {
  it('registers the installed component and keeps auth and project scope in the host', async () => {
    const t = testRuntime();
    const ownerA = t.withIdentity({ issuer: 'https://auth.nodevideo.test', subject: 'owner-a' });
    const ownerB = t.withIdentity({ issuer: 'https://auth.nodevideo.test', subject: 'owner-b' });
    const { projectId, request, started } = await createProjectRun(t, ownerA, 'owner-boundary');

    await expect(t.mutation(api.nodeVideoCaseflow.startProjectCaseflow, request)).rejects.toThrow(
      'authentication_required',
    );
    const repeated = await ownerA.mutation(api.nodeVideoCaseflow.startProjectCaseflow, request);
    expect(repeated).toEqual({ ...started, reused: true });
    await expect(
      ownerA.mutation(api.nodeVideoCaseflow.startProjectCaseflow, {
        ...request,
        input: { brief: 'A different input under the same key' },
      }),
    ).rejects.toThrow('idempotency_key_reused_with_different_input');
    await expect(
      ownerB.query(api.nodeVideoCaseflow.readProjectCaseflow, {
        caseId: started.caseId,
        projectId,
      }),
    ).rejects.toThrow('project_not_found_or_forbidden');

    const snapshot = await ownerA.query(api.nodeVideoCaseflow.readProjectCaseflow, {
      caseId: started.caseId,
      projectId,
    });
    expect(snapshot.component.case.caseId).toMatch(/^case_/u);
    expect(snapshot.component.run.runId).toMatch(/^run_/u);
    expect(snapshot.component.run.stages).toHaveLength(19);
    expect(snapshot.component.run.stages.map((stage: { id: string }) => stage.id)).toContain(
      'render_preview',
    );
    expect(snapshot.component.receipt).toBeNull();
    expect(snapshot.domain.case.projectId).toBe(projectId);
    expect(snapshot.domain.job._id).toBe(started.jobId);
    expect(snapshot.domain.stages).toHaveLength(19);
    expect(snapshot.domain.events.map((event: { kind: string }) => event.kind)).toContain(
      'job.created',
    );
  });

  it('executes a NodeVideo artifact lifecycle with retry, conflict, recovery, and receipt proof', async () => {
    const t = testRuntime();
    const owner = t.withIdentity({ issuer: 'https://auth.nodevideo.test', subject: 'creator' });
    const stranger = t.withIdentity({ issuer: 'https://auth.nodevideo.test', subject: 'stranger' });
    const { projectId, started } = await createProjectRun(t, owner, 'material-lifecycle');

    const entered = await owner.mutation(api.nodeVideoCaseflow.enterProjectStage, {
      caseId: started.caseId,
      idempotencyKey: 'stage-render-preview',
      nextAction: 'Inspect the phrase-aligned render preview',
      nextActionOwner: 'user',
      projectId,
      stageId: 'render_preview',
    });
    const enteredRetry = await owner.mutation(api.nodeVideoCaseflow.enterProjectStage, {
      caseId: started.caseId,
      idempotencyKey: ' stage-render-preview ',
      nextAction: 'Inspect the phrase-aligned render preview',
      nextActionOwner: 'user',
      projectId,
      stageId: 'render_preview',
    });
    expect(enteredRetry).toEqual(entered);

    const artifactRequest = {
      caseId: started.caseId,
      content: {
        durationMs: 31_240,
        frozen: false,
        output: { mimeType: 'video/mp4', sha256: 'c'.repeat(64) },
        schemaVersion: 'nodevideo.edit-plan/v1',
        timeline: [
          { endMs: 4_000, sourceAssetSha256: 'b'.repeat(64), startMs: 0 },
          { endMs: 8_500, sourceAssetSha256: 'b'.repeat(64), startMs: 4_000 },
        ],
      },
      idempotencyKey: 'render-plan-v1',
      kind: 'nodevideo-edit-plan',
      projectId,
      title: 'Phrase-aligned source-only edit plan',
    };
    const artifact = await owner.mutation(
      api.nodeVideoCaseflow.publishProjectArtifact,
      artifactRequest,
    );
    const artifactRetry = await owner.mutation(api.nodeVideoCaseflow.publishProjectArtifact, {
      ...artifactRequest,
      idempotencyKey: ' render-plan-v1 ',
    });
    expect(artifactRetry.artifactId).toBe(artifact.artifactId);
    expect(artifact.versions[0].contentHash).toBe(contentHash(artifactRequest.content));

    const accepted = await owner.mutation(api.nodeVideoCaseflow.proposeProjectArtifact, {
      artifactId: artifact.artifactId,
      baseVersion: 1,
      idempotencyKey: 'freeze-approved-plan',
      patch: { ...artifactRequest.content, frozen: true, reviewDecision: 'approved' },
      projectId,
      rationale: 'Creator approved the source-only timing and crop decisions.',
    });
    const acceptedRetry = await owner.mutation(api.nodeVideoCaseflow.proposeProjectArtifact, {
      artifactId: artifact.artifactId,
      baseVersion: 1,
      idempotencyKey: ' freeze-approved-plan ',
      patch: { ...artifactRequest.content, frozen: true, reviewDecision: 'approved' },
      projectId,
      rationale: 'Creator approved the source-only timing and crop decisions.',
    });
    expect(acceptedRetry.proposalId).toBe(accepted.proposalId);
    const stale = await owner.mutation(api.nodeVideoCaseflow.proposeProjectArtifact, {
      artifactId: artifact.artifactId,
      baseVersion: 1,
      idempotencyKey: 'alternate-cut-v1',
      patch: { ...artifactRequest.content, frozen: true, reviewDecision: 'alternate' },
      projectId,
      rationale: 'Alternative cut raced with the approved edit.',
    });

    await expect(
      stranger.mutation(api.nodeVideoCaseflow.decideProjectProposal, {
        decision: 'accepted',
        projectId,
        proposalId: accepted.proposalId,
      }),
    ).rejects.toThrow('project_not_found_or_forbidden');
    const firstDecision = await owner.mutation(api.nodeVideoCaseflow.decideProjectProposal, {
      comment: 'Freeze this exact cut.',
      decision: 'accepted',
      projectId,
      proposalId: accepted.proposalId,
    });
    const repeatedDecision = await owner.mutation(api.nodeVideoCaseflow.decideProjectProposal, {
      comment: 'Freeze this exact cut.',
      decision: 'accepted',
      projectId,
      proposalId: accepted.proposalId,
    });
    expect(repeatedDecision.reused).toBe(true);
    expect(repeatedDecision.approval.approvalId).toBe(firstDecision.approval.approvalId);
    const staleDecision = await owner.mutation(api.nodeVideoCaseflow.decideProjectProposal, {
      decision: 'accepted',
      projectId,
      proposalId: stale.proposalId,
    });
    expect(staleDecision.proposal.status).toBe('conflicted');
    expect(staleDecision.artifact.canonicalVersion).toBe(2);

    const exceptionRequest = {
      caseId: started.caseId,
      code: 'render_worker_interrupted',
      idempotencyKey: 'checkpoint-after-frame-412',
      message: 'The render worker stopped after writing a durable media checkpoint.',
      preservedState: {
        checkpointSha256: 'd'.repeat(64),
        completedFrames: 412,
        frozenArtifactVersion: 2,
      },
      projectId,
    };
    const raised = await owner.mutation(
      api.nodeVideoCaseflow.raiseProjectException,
      exceptionRequest,
    );
    const raisedRetry = await owner.mutation(api.nodeVideoCaseflow.raiseProjectException, {
      ...exceptionRequest,
      idempotencyKey: ' checkpoint-after-frame-412 ',
    });
    expect(raisedRetry.exceptionId).toBe(raised.exceptionId);
    await expect(
      owner.mutation(api.nodeVideoCaseflow.publishProjectArtifact, {
        ...artifactRequest,
        idempotencyKey: 'blocked-write',
      }),
    ).rejects.toThrow('run is not active: blocked');

    const blocked = await owner.query(api.nodeVideoCaseflow.readProjectCaseflow, {
      caseId: started.caseId,
      projectId,
    });
    expect(blocked.component.run).toMatchObject({ nextActionOwner: 'user', status: 'blocked' });
    const recovered = await owner.mutation(api.nodeVideoCaseflow.resolveProjectException, {
      exceptionId: raised.exceptionId,
      nextAction: 'Resume rendering from the verified checkpoint',
      nextActionOwner: 'worker',
      projectId,
      resolution: 'Replacement worker verified and claimed the checkpoint.',
    });
    expect(recovered.run).toMatchObject({ nextActionOwner: 'worker', status: 'active' });

    await owner.mutation(api.nodeVideoCaseflow.enterProjectStage, {
      caseId: started.caseId,
      idempotencyKey: 'stage-freeze',
      projectId,
      stageId: 'freeze',
    });
    const completed = await owner.mutation(api.nodeVideoCaseflow.completeProjectRun, {
      caseId: started.caseId,
      projectId,
    });
    const repeatedCompletion = await owner.mutation(api.nodeVideoCaseflow.completeProjectRun, {
      caseId: started.caseId,
      projectId,
    });
    expect(repeatedCompletion.reused).toBe(true);
    expect(repeatedCompletion.receipt).toEqual(completed.receipt);

    const { receiptHash, receiptId: _receiptId, ...receiptBody } = completed.receipt;
    expect(receiptHash).toBe(contentHash(receiptBody));
    expect(completed.receipt).toMatchObject({
      caseId: started.caseId,
      runId: started.runId,
      schemaVersion: 'nodekit.receipt/v2',
      status: 'completed',
    });
    expect(completed.receipt.artifactBindings).toContainEqual(
      expect.objectContaining({
        artifactId: artifact.artifactId,
        canonicalVersion: 2,
        contentHash: firstDecision.artifact.versions.at(-1)?.contentHash,
      }),
    );
    expect(completed.receipt.approvalBindings).toContainEqual(
      expect.objectContaining({ approvalId: firstDecision.approval.approvalId }),
    );
    expect(completed.receipt.proposalBindings).toContainEqual(
      expect.objectContaining({ proposalId: stale.proposalId, status: 'conflicted' }),
    );
  });

  it('terminates interrupted video work explicitly and idempotently', async () => {
    const t = testRuntime();
    const owner = t.withIdentity({ issuer: 'https://auth.nodevideo.test', subject: 'operator' });

    const cancelled = await createProjectRun(t, owner, 'cancelled');
    const firstCancel = await owner.mutation(api.nodeVideoCaseflow.cancelProjectRun, {
      caseId: cancelled.started.caseId,
      projectId: cancelled.projectId,
      reason: 'Creator withdrew the source assets.',
    });
    const cancelRetry = await owner.mutation(api.nodeVideoCaseflow.cancelProjectRun, {
      caseId: cancelled.started.caseId,
      projectId: cancelled.projectId,
      reason: 'Creator withdrew the source assets.',
    });
    expect(firstCancel.receipt.status).toBe('cancelled');
    expect(cancelRetry.reused).toBe(true);
    expect(cancelRetry.receipt).toEqual(firstCancel.receipt);

    const failed = await createProjectRun(t, owner, 'failed-safely');
    const partial = await owner.mutation(api.nodeVideoCaseflow.publishProjectArtifact, {
      caseId: failed.started.caseId,
      content: { checkpointSha256: 'e'.repeat(64), completedFrames: 91 },
      idempotencyKey: 'partial-render-checkpoint',
      kind: 'render-checkpoint',
      projectId: failed.projectId,
      title: 'Preserved render checkpoint',
    });
    await owner.mutation(api.nodeVideoCaseflow.raiseProjectException, {
      caseId: failed.started.caseId,
      code: 'codec_unavailable',
      idempotencyKey: 'codec-failure',
      message: 'The required codec is unavailable, but the checkpoint is valid.',
      preservedState: { artifactId: partial.artifactId },
      projectId: failed.projectId,
    });
    const firstFailure = await owner.mutation(api.nodeVideoCaseflow.failProjectRunSafely, {
      caseId: failed.started.caseId,
      projectId: failed.projectId,
      reason: 'Codec remained unavailable after bounded retries.',
    });
    const failureRetry = await owner.mutation(api.nodeVideoCaseflow.failProjectRunSafely, {
      caseId: failed.started.caseId,
      projectId: failed.projectId,
      reason: 'Codec remained unavailable after bounded retries.',
    });
    expect(firstFailure.receipt.status).toBe('failed_safely');
    expect(firstFailure.receipt.artifactIds).toContain(partial.artifactId);
    expect(failureRetry.reused).toBe(true);
    expect(failureRetry.receipt).toEqual(firstFailure.receipt);
  });
});
