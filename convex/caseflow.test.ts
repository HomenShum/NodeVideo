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
});
