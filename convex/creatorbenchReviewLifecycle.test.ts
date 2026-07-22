import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const lifecycle = (api as any).creatorbenchReviewLifecycle;
const reviewerRef = 'reviewer:0123456789ab';
const consentVersion = 'creatorbench-review-consent/v1';

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    benchmarkVersion: 'creatorbench-v1.1',
    instanceId: 'instance:public:1',
    resultId: 'result:public:1',
    split: 'public-test' as const,
    reviewerRef,
    assignmentId: 'assignment:public:1',
    blindedVariantOrderJson: '["variant:a","variant:b"]',
    agreementMode: false,
    consentVersion,
    ...overrides,
  };
}

function review(assignmentId: string) {
  return {
    assignmentId,
    reviewerRef,
    usability: 'usable_after_minor_correction' as const,
    correctionTimeSeconds: 14,
    reasonCodes: ['caption-position'],
    correctnessIssues: [],
    missedSubjectOrContent: [],
    unwantedEdits: ['caption overlaps product'],
    preferredVariantId: 'variant:b',
  };
}

describe('CreatorBench durable review lifecycle', () => {
  it('requires explicit consent and prevents ordinary repeated review', async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(lifecycle.claimAssignment, assignment({ consentVersion: 'missing' })),
    ).rejects.toThrow(/consent/u);
    await t.mutation(lifecycle.claimAssignment, assignment());
    await t.mutation(lifecycle.submitReview, review('assignment:public:1'));
    await expect(
      t.mutation(lifecycle.claimAssignment, assignment({ assignmentId: 'assignment:public:2' })),
    ).rejects.toThrow(/repeatedly/u);
  });

  it('permits one explicit agreement re-review after a completed blind review', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(lifecycle.claimAssignment, assignment());
    await t.mutation(lifecycle.submitReview, review('assignment:public:1'));
    const agreement = assignment({
      assignmentId: 'assignment:agreement:1',
      agreementMode: true,
      agreementRoundId: 'agreement:round_1',
    });
    await t.mutation(lifecycle.claimAssignment, agreement);
    await t.mutation(lifecycle.submitReview, review('assignment:agreement:1'));
    await expect(
      t.mutation(
        lifecycle.claimAssignment,
        assignment({
          assignmentId: 'assignment:agreement:2',
          agreementMode: true,
          agreementRoundId: 'agreement:round_2',
        }),
      ),
    ).rejects.toThrow(/Only one agreement/u);
  });

  it('exports pseudonymous history and deletes every reviewer record', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(lifecycle.claimAssignment, assignment());
    await t.mutation(lifecycle.submitReview, review('assignment:public:1'));
    expect(await t.query(lifecycle.listReviewerHistory, { reviewerRef })).toHaveLength(1);
    const receipt = await t.mutation(lifecycle.deleteReviewerData, {
      reviewerRef,
      confirmReviewerRef: reviewerRef,
      confirmation: 'DELETE MY CREATORBENCH REVIEWS',
    });
    expect(receipt.deletedCount).toBe(1);
    expect(await t.query(lifecycle.listReviewerHistory, { reviewerRef })).toHaveLength(0);
  });
});
