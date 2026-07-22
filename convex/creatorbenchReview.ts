import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

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

function assertPseudonymousReviewerRef(value: string) {
  if (!/^reviewer:[a-f\d]{12,64}$/u.test(value)) {
    throw new Error('Reviewer identity must be a pseudonymous reviewer hash.');
  }
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
  },
  handler: async (ctx, args) => {
    assertPseudonymousReviewerRef(args.reviewerRef);
    if (args.benchmarkVersion !== 'creatorbench-v1.1')
      throw new Error('Unsupported benchmark version.');
    const existing = await ctx.db
      .query('creatorBenchReviews')
      .withIndex('by_assignment', (queryBuilder) =>
        queryBuilder.eq('assignmentId', args.assignmentId),
      )
      .unique();
    if (existing) {
      if (existing.reviewerRef !== args.reviewerRef || existing.instanceId !== args.instanceId) {
        throw new Error('Assignment ID is already bound to another review.');
      }
      return existing._id;
    }
    const previous = await ctx.db
      .query('creatorBenchReviews')
      .withIndex('by_instance', (queryBuilder) =>
        queryBuilder
          .eq('benchmarkVersion', args.benchmarkVersion)
          .eq('instanceId', args.instanceId),
      )
      .collect();
    if (previous.some((review) => review.reviewerRef === args.reviewerRef)) {
      throw new Error('A reviewer cannot repeatedly evaluate the same instance.');
    }
    const now = Date.now();
    return ctx.db.insert('creatorBenchReviews', {
      ...args,
      status: 'assigned',
      blind: true,
      reasonCodes: [],
      correctnessIssues: [],
      missedSubjectOrContent: [],
      unwantedEdits: [],
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
    assertPseudonymousReviewerRef(args.reviewerRef);
    if (!Number.isFinite(args.correctionTimeSeconds) || args.correctionTimeSeconds < 0) {
      throw new Error('Correction time must be a non-negative number of seconds.');
    }
    const review = await ctx.db
      .query('creatorBenchReviews')
      .withIndex('by_assignment', (queryBuilder) =>
        queryBuilder.eq('assignmentId', args.assignmentId),
      )
      .unique();
    if (!review || review.reviewerRef !== args.reviewerRef)
      throw new Error('Review assignment not found.');
    if (review.status === 'completed') throw new Error('Review assignment is already complete.');
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
    return review._id;
  },
});

export const listReviewerHistory = query({
  args: { reviewerRef: v.string() },
  handler: async (ctx, args) => {
    assertPseudonymousReviewerRef(args.reviewerRef);
    return ctx.db
      .query('creatorBenchReviews')
      .withIndex('by_reviewer_status', (queryBuilder) =>
        queryBuilder.eq('reviewerRef', args.reviewerRef),
      )
      .order('desc')
      .take(100);
  },
});
