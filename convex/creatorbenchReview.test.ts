import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const creatorbench = (api as any).creatorbenchReview;

describe('CreatorBench reviewer persistence', () => {
  it('stores one blinded pseudonymous judgment per assignment and rejects repeats', async () => {
    const t = convexTest(schema, modules);
    const args = {
      benchmarkVersion: 'creatorbench-v1.3',
      instanceId: 'instance:public:1',
      resultId: 'result:public:1',
      split: 'public-test' as const,
      reviewerRef: 'reviewer:0123456789ab',
      assignmentId: 'assignment:1',
      variantId: 'variant:a',
      blindedVariantOrderJson: '["variant:a","variant:b"]',
    };
    await t.mutation(creatorbench.claimAssignment, args);
    await t.mutation(creatorbench.submitReview, {
      assignmentId: args.assignmentId,
      reviewerRef: args.reviewerRef,
      usability: 'usable_after_minor_correction',
      correctionTimeSeconds: 14,
      reasonCodes: ['caption-position'],
      correctnessIssues: [],
      missedSubjectOrContent: [],
      unwantedEdits: ['caption overlaps product'],
      preferredVariantId: 'variant:b',
    });
    await expect(
      t.mutation(creatorbench.submitReview, {
        assignmentId: args.assignmentId,
        reviewerRef: args.reviewerRef,
        usability: 'usable_as_is',
        correctionTimeSeconds: 0,
        reasonCodes: [],
        correctnessIssues: [],
        missedSubjectOrContent: [],
        unwantedEdits: [],
      }),
    ).rejects.toThrow(/already complete/u);
    const history = await t.query(creatorbench.listReviewerHistory, {
      reviewerRef: args.reviewerRef,
    });
    expect(history[0]).toMatchObject({ blind: true, usability: 'usable_after_minor_correction' });
  });
});
