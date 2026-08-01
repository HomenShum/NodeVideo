import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

describe('NodeVideo Convex Caseflow consumer', () => {
  test('persists a thread, applies once, and rejects a stale second-session proposal', async () => {
    const t = convexTest(schema, modules);
    const ownerKey = 'owner_caseflow_test';
    const campaign = await t.mutation(api.caseflow.createCampaign, {
      ownerKey,
      idempotencyKey: 'founder-launch:test',
      title: 'Founder launch video',
      brief: 'Create landscape, vertical, and square launch outputs.',
    });

    await t.mutation(api.caseflow.appendMessage, {
      caseId: campaign.caseId,
      ownerKey,
      runId: campaign.runId,
      role: 'user',
      text: 'Use the strongest source-grounded product moment.',
    });
    const first = await t.mutation(api.caseflow.createEditProposal, {
      caseId: campaign.caseId,
      ownerKey,
      runId: campaign.runId,
      expectedArtifactVersion: 1,
      snapshot: { variant: 'local-a', operations: [{ kind: 'compose_variants' }] },
      planningReceipt: {
        requestedRoute: 'local/deterministic',
        resolvedProvider: 'nodevideo',
        resolvedModel: 'deterministic-founder-variant-compiler-v2',
        inputScope: { rawMediaUploaded: false },
        costUsd: 0,
        result: 'proposal_created',
      },
    });
    const stale = await t.mutation(api.caseflow.createEditProposal, {
      caseId: campaign.caseId,
      ownerKey,
      runId: campaign.runId,
      expectedArtifactVersion: 1,
      snapshot: { variant: 'local-b', operations: [{ kind: 'compose_variants' }] },
      planningReceipt: {
        requestedRoute: 'local/deterministic',
        resolvedProvider: 'nodevideo',
        resolvedModel: 'deterministic-founder-variant-compiler-v2',
        inputScope: { rawMediaUploaded: false },
        costUsd: 0,
        result: 'proposal_created',
      },
    });

    const accepted = await t.mutation(api.caseflow.decideProposal, {
      caseId: campaign.caseId,
      ownerKey,
      runId: campaign.runId,
      proposalId: first.proposalId,
      expectedDigest: first.proposalDigest,
      decision: 'approved',
      actorRef: 'browser-b',
    });
    expect(accepted).toMatchObject({ applied: true, reused: false, version: 2 });

    const repeated = await t.mutation(api.caseflow.decideProposal, {
      caseId: campaign.caseId,
      ownerKey,
      runId: campaign.runId,
      proposalId: first.proposalId,
      expectedDigest: first.proposalDigest,
      decision: 'approved',
      actorRef: 'browser-a',
    });
    expect(repeated).toMatchObject({ applied: true, reused: true, version: 2 });

    const conflict = await t.mutation(api.caseflow.decideProposal, {
      caseId: campaign.caseId,
      ownerKey,
      runId: campaign.runId,
      proposalId: stale.proposalId,
      expectedDigest: stale.proposalDigest,
      decision: 'approved',
      actorRef: 'browser-a',
    });
    expect(conflict).toMatchObject({ applied: false, conflicted: true, version: 2 });

    const reopened = await t.query(api.caseflow.getCampaign, {
      caseId: campaign.caseId,
      ownerKey,
    });
    expect(reopened.case.currentArtifactVersion).toBe(2);
    expect(
      reopened.messages.some((message) => message.text.includes('strongest source-grounded')),
    ).toBe(true);
    expect(reopened.proposals.find((proposal) => proposal._id === stale.proposalId)?.status).toBe(
      'superseded',
    );
    expect(reopened.timeline.some((entry) => entry.kind === 'proposal.conflicted')).toBe(true);
  });

  test('does not disclose a campaign without its owner capability', async () => {
    const t = convexTest(schema, modules);
    const campaign = await t.mutation(api.caseflow.createCampaign, {
      ownerKey: 'owner_private',
      idempotencyKey: 'private:test',
      title: 'Private campaign',
      brief: 'Private source workflow.',
    });
    await expect(
      t.query(api.caseflow.getCampaign, { caseId: campaign.caseId, ownerKey: 'wrong_owner' }),
    ).rejects.toThrow('case_not_found');
  });

  test('requires exact executor approval and invalidates it when the quote changes', async () => {
    const t = convexTest(schema, modules);
    const ownerKey = 'owner_executor_test';
    const campaign = await t.mutation(api.caseflow.createCampaign, {
      ownerKey,
      idempotencyKey: 'executor:test',
      title: 'Executor governed campaign',
      brief: 'Keep specialist execution behind an exact quote.',
    });
    const proposal = await t.mutation(api.caseflow.createEditProposal, {
      caseId: campaign.caseId,
      ownerKey,
      runId: campaign.runId,
      expectedArtifactVersion: 1,
      snapshot: { variant: 'optional-platform-hero' },
      planningReceipt: { requestedRoute: 'local/deterministic', result: 'proposal_created' },
    });
    const quote = {
      executor: 'higgsfield',
      job: 'seedance_2_0',
      durationSeconds: 5,
      mediaLeavingDevice: ['source-hero.png'],
      estimatedCredits: 7.5,
      currentBalanceCredits: 10,
      outputUse: 'optional platform-hero variant',
      canonicalVideoAffected: false as const,
      quotedAt: 1_784_700_000_000,
    };
    const proposed = await t.mutation(api.caseflow.proposeExecutorJob, {
      caseId: campaign.caseId,
      ownerKey,
      runId: campaign.runId,
      proposalId: proposal.proposalId,
      provider: 'higgsfield',
      capability: 'seedance_2_0',
      inputManifest: {
        schemaVersion: 'nodevideo.executor-input-manifest/v1',
        sourceAssetIds: ['source-hero.png'],
        promptDigest: 'sha256:prompt',
        parametersDigest: 'sha256:parameters',
        rawMediaUploaded: false,
      },
      quote,
    });

    await expect(
      t.mutation(api.caseflow.markExecutorSubmitted, {
        caseId: campaign.caseId,
        ownerKey,
        executorJobId: proposed.executorJobId,
        expectedQuoteDigest: proposed.quoteDigest,
        providerJobId: 'must-not-submit',
      }),
    ).rejects.toThrow('executor_submission_requires_current_exact_approval');

    await t.mutation(api.caseflow.approveExecutorJob, {
      caseId: campaign.caseId,
      ownerKey,
      executorJobId: proposed.executorJobId,
      expectedQuoteDigest: proposed.quoteDigest,
    });
    const refreshed = await t.mutation(api.caseflow.refreshExecutorQuote, {
      caseId: campaign.caseId,
      ownerKey,
      executorJobId: proposed.executorJobId,
      quote: { ...quote, estimatedCredits: 8, quotedAt: quote.quotedAt + 1_000 },
    });
    expect(refreshed.approvalInvalidated).toBe(true);
    await expect(
      t.mutation(api.caseflow.markExecutorSubmitted, {
        caseId: campaign.caseId,
        ownerKey,
        executorJobId: proposed.executorJobId,
        expectedQuoteDigest: proposed.quoteDigest,
        providerJobId: 'still-must-not-submit',
      }),
    ).rejects.toThrow('executor_submission_requires_current_exact_approval');

    const reopened = await t.query(api.caseflow.getCampaign, {
      caseId: campaign.caseId,
      ownerKey,
    });
    expect(reopened.executorJobs[0]?.status).toBe('quote_invalidated');
    expect(reopened.timeline.some((entry) => entry.kind === 'executor.approval_invalidated')).toBe(
      true,
    );
  });

  test('a creator can resume one checkpoint after reload while a concurrent worker fails closed', async () => {
    const t = convexTest(schema, modules);
    const ownerKey = 'owner_durable_agent';
    const campaign = await t.mutation(api.caseflow.createCampaign, {
      ownerKey,
      idempotencyKey: 'durable-agent:test',
      title: 'Durable creator run',
      brief: 'Resume the agent review without repeating the draft.',
    });
    const claim = await t.mutation(api.caseflow.claimAgentExecution, {
      caseId: campaign.caseId,
      ownerKey,
      runId: campaign.runId,
      executionKey: 'digest-1',
      requestDigest: 'digest-1',
      requestText: 'Create a concise vertical launch cut.',
      workerToken: 'worker-a',
    });
    expect(claim).toMatchObject({ state: 'claimed', resumed: false });
    const concurrent = await t.mutation(api.caseflow.claimAgentExecution, {
      caseId: campaign.caseId,
      ownerKey,
      runId: campaign.runId,
      executionKey: 'digest-1',
      requestDigest: 'digest-1',
      requestText: 'Create a concise vertical launch cut.',
      workerToken: 'worker-b',
    });
    expect(concurrent).toMatchObject({ state: 'busy', phase: 'draft' });
    if (claim.state !== 'claimed') throw new Error('expected claimed execution');
    await t.mutation(api.caseflow.checkpointAgentExecution, {
      caseId: campaign.caseId,
      ownerKey,
      executionId: claim.executionId,
      workerToken: 'worker-a',
      phase: 'review',
      status: 'awaiting_resume',
      checkpoint: { schemaVersion: 'nodevideo.agent-checkpoint/v1', marker: 'draft-grounded' },
      error: 'free review overloaded',
    });
    const resumed = await t.mutation(api.caseflow.claimAgentExecution, {
      caseId: campaign.caseId,
      ownerKey,
      runId: campaign.runId,
      executionKey: 'digest-1',
      requestDigest: 'digest-1',
      requestText: 'Create a concise vertical launch cut.',
      workerToken: 'worker-c',
    });
    expect(resumed).toMatchObject({
      state: 'claimed',
      resumed: true,
      checkpoint: { marker: 'draft-grounded' },
    });
    if (resumed.state !== 'claimed') throw new Error('expected resumed execution');
    await t.mutation(api.caseflow.completeAgentExecution, {
      caseId: campaign.caseId,
      ownerKey,
      executionId: resumed.executionId,
      workerToken: 'worker-c',
      result: { ok: true, depthMode: 'iterative' },
    });
    const reopened = await t.mutation(api.caseflow.claimAgentExecution, {
      caseId: campaign.caseId,
      ownerKey,
      runId: campaign.runId,
      executionKey: 'digest-1',
      requestDigest: 'digest-1',
      requestText: 'Create a concise vertical launch cut.',
      workerToken: 'worker-d',
    });
    expect(reopened).toMatchObject({
      state: 'completed',
      result: { ok: true, depthMode: 'iterative' },
    });
  });

  test('a long-running creator thread evicts terminal agent executions at the shared bound', async () => {
    const t = convexTest(schema, modules);
    const ownerKey = 'owner_bounded_agent';
    const campaign = await t.mutation(api.caseflow.createCampaign, {
      ownerKey,
      idempotencyKey: 'bounded-agent:test',
      title: 'Bounded creator history',
      brief: 'Keep durable run history bounded during sustained use.',
    });
    for (let index = 0; index < 24; index += 1) {
      const claimed = await t.mutation(api.caseflow.claimAgentExecution, {
        caseId: campaign.caseId,
        ownerKey,
        runId: campaign.runId,
        executionKey: `digest-${index}`,
        requestDigest: `digest-${index}`,
        requestText: `Prepare creator variant ${index}.`,
        workerToken: `worker-${index}`,
      });
      if (claimed.state !== 'claimed') throw new Error('expected claimed execution');
      await t.mutation(api.caseflow.failAgentExecution, {
        caseId: campaign.caseId,
        ownerKey,
        executionId: claimed.executionId,
        workerToken: `worker-${index}`,
        error: 'synthetic terminal failure',
      });
    }
    const reopened = await t.query(api.caseflow.getCampaign, {
      caseId: campaign.caseId,
      ownerKey,
    });
    expect(reopened.agentExecutions).toHaveLength(20);
    expect(reopened.agentExecutions.some((entry) => entry.executionKey === 'digest-0')).toBe(false);
    expect(reopened.agentExecutions.some((entry) => entry.executionKey === 'digest-23')).toBe(true);
  });
});
