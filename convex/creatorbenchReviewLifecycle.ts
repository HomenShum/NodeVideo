import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

const CONSENT_VERSION = 'creatorbench-review-consent/v1';
const DELETE_CONFIRMATION = 'DELETE MY CREATORBENCH REVIEWS';

const publicReviewSplit = v.union(
  v.literal('development'),
  v.literal('public-test'),
  v.literal('adversarial'),
);

const usability = v.union(
  v.literal('usable_as_is'),
  v.literal('usable_after_minor_correction'),
  v.literal('requires_major_correction'),
  v.literal('unusable'),
  v.literal('unsafe_or_rights_invalid'),
);

function assertReviewerRef(value: string) {
  if (!/^reviewer:[a-f\d]{12,64}$/u.test(value)) {
    throw new Error('Reviewer identity must be a pseudonymous reviewer hash.');
  }
}

function assertConsent(value: string) {
  if (value !== CONSENT_VERSION) throw new Error('Explicit review consent is required.');
}

export const claimAssignment = mutation({
  args: {
    benchmarkVersion: v.string(),
    instanceId: v.string(),
    resultId: v.string(),
    split: publicReviewSplit,
    reviewerRef: v.string(),
    assignmentId: v.string(),
    variantId: v.optional(v.string()),
    blindedVariantOrderJson: v.string(),
    agreementMode: v.boolean(),
    agreementRoundId: v.optional(v.string()),
    consentVersion: v.string(),
  },
  handler: async (ctx, args) => {
    assertReviewerRef(args.reviewerRef);
    assertConsent(args.consentVersion);
    if (args.benchmarkVersion !== 'creatorbench-v1.1') {
      throw new Error('Unsupported benchmark version.');
    }
    if (
      args.agreementMode &&
      !/^agreement:[a-zA-Z\d:_-]{4,100}$/u.test(args.agreementRoundId ?? '')
    ) {
      throw new Error('Agreement mode requires a bounded agreement round ID.');
    }
    if (!args.agreementMode && args.agreementRoundId) {
      throw new Error('Agreement round ID is only valid in agreement mode.');
    }
    const assignment = await ctx.db
      .query('creatorBenchReviews')
      .withIndex('by_assignment', (builder) => builder.eq('assignmentId', args.assignmentId))
      .unique();
    if (assignment) {
      if (
        assignment.reviewerRef !== args.reviewerRef ||
        assignment.instanceId !== args.instanceId ||
        assignment.resultId !== args.resultId
      ) {
        throw new Error('Assignment ID is already bound to another review.');
      }
      return assignment._id;
    }
    const prior = await ctx.db
      .query('creatorBenchReviews')
      .withIndex('by_instance', (builder) =>
        builder.eq('benchmarkVersion', args.benchmarkVersion).eq('instanceId', args.instanceId),
      )
      .collect();
    const sameReviewer = prior.filter((review) => review.reviewerRef === args.reviewerRef);
    if (!args.agreementMode && sameReviewer.length > 0) {
      throw new Error('A reviewer cannot repeatedly evaluate the same instance.');
    }
    if (args.agreementMode) {
      if (sameReviewer.some((review) => review.agreementMode)) {
        throw new Error('Only one agreement re-review is permitted per reviewer and instance.');
      }
      if (sameReviewer.length !== 1 || sameReviewer[0]?.status !== 'completed') {
        throw new Error('Agreement mode requires exactly one completed prior review.');
      }
    }
    const now = Date.now();
    return ctx.db.insert('creatorBenchReviews', {
      benchmarkVersion: args.benchmarkVersion,
      instanceId: args.instanceId,
      resultId: args.resultId,
      split: args.split,
      reviewerRef: args.reviewerRef,
      assignmentId: args.assignmentId,
      variantId: args.variantId,
      blind: true,
      status: 'assigned',
      reasonCodes: [],
      correctnessIssues: [],
      missedSubjectOrContent: [],
      unwantedEdits: [],
      blindedVariantOrderJson: args.blindedVariantOrderJson,
      agreementMode: args.agreementMode,
      agreementRoundId: args.agreementRoundId,
      consentVersion: args.consentVersion,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const submitReview = mutation({
  args: {
    assignmentId: v.string(),
    reviewerRef: v.string(),
    usability,
    correctionTimeSeconds: v.number(),
    reasonCodes: v.array(v.string()),
    correctnessIssues: v.array(v.string()),
    missedSubjectOrContent: v.array(v.string()),
    unwantedEdits: v.array(v.string()),
    preferredVariantId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertReviewerRef(args.reviewerRef);
    if (!Number.isFinite(args.correctionTimeSeconds) || args.correctionTimeSeconds < 0) {
      throw new Error('Correction time must be a non-negative number of seconds.');
    }
    const review = await ctx.db
      .query('creatorBenchReviews')
      .withIndex('by_assignment', (builder) => builder.eq('assignmentId', args.assignmentId))
      .unique();
    if (!review || review.reviewerRef !== args.reviewerRef) {
      throw new Error('Review assignment not found.');
    }
    if (review.status === 'completed') throw new Error('Review assignment is already complete.');
    if (!review.blind) throw new Error('Only blinded assignments may be submitted.');
    const now = Date.now();
    await ctx.db.patch(review._id, {
      status: 'completed',
      usability: args.usability,
      correctionTimeSeconds: args.correctionTimeSeconds,
      reasonCodes: [...new Set(args.reasonCodes)].slice(0, 12),
      correctnessIssues: [...new Set(args.correctnessIssues)].slice(0, 24),
      missedSubjectOrContent: [...new Set(args.missedSubjectOrContent)].slice(0, 24),
      unwantedEdits: [...new Set(args.unwantedEdits)].slice(0, 24),
      preferredVariantId: args.preferredVariantId,
      updatedAt: now,
      completedAt: now,
    });
    return { reviewId: review._id, completedAt: now };
  },
});

export const listReviewerHistory = query({
  args: { reviewerRef: v.string() },
  handler: async (ctx, args) => {
    assertReviewerRef(args.reviewerRef);
    return ctx.db
      .query('creatorBenchReviews')
      .withIndex('by_reviewer_status', (builder) => builder.eq('reviewerRef', args.reviewerRef))
      .order('desc')
      .take(100);
  },
});

export const deleteReviewerData = mutation({
  args: {
    reviewerRef: v.string(),
    confirmReviewerRef: v.string(),
    confirmation: v.string(),
  },
  handler: async (ctx, args) => {
    assertReviewerRef(args.reviewerRef);
    if (args.reviewerRef !== args.confirmReviewerRef) {
      throw new Error('Reviewer deletion confirmation does not match.');
    }
    if (args.confirmation !== DELETE_CONFIRMATION) {
      throw new Error('Reviewer deletion requires the exact confirmation phrase.');
    }
    const records = await ctx.db
      .query('creatorBenchReviews')
      .withIndex('by_reviewer_status', (builder) => builder.eq('reviewerRef', args.reviewerRef))
      .collect();
    for (const record of records) await ctx.db.delete(record._id);
    return { deletedCount: records.length, deletedAt: Date.now(), reviewerRef: args.reviewerRef };
  },
});
