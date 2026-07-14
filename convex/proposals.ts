import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import {
  assertActiveLease,
  assertBoundedString,
  assertProposalApproval,
  assertSha256Digest,
  boundedCanonicalJson,
  sha256Digest,
} from './lib/durability';
import { appendJobEvent, requireJob } from './lib/persistence';

const PROPOSAL_MAX_BYTES = 64 * 1024;

export const create = internalMutation({
  args: {
    jobId: v.id('jobs'),
    leaseId: v.string(),
    leaseToken: v.number(),
    artifactId: v.optional(v.id('artifacts')),
    baseRecipeVersion: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const job = await requireJob(ctx, args.jobId);
    const now = Date.now();
    assertActiveLease(job, args.leaseId, args.leaseToken, now);
    const baseRecipeVersion = assertBoundedString(
      args.baseRecipeVersion,
      128,
      'base_recipe_version',
    );

    if (args.artifactId !== undefined) {
      const artifact = await ctx.db.get(args.artifactId);
      if (artifact === null || artifact.jobId !== job._id) {
        throw new Error('proposal_artifact_job_mismatch');
      }
    }

    const payloadJson = boundedCanonicalJson(args.payload, PROPOSAL_MAX_BYTES, 'proposal_payload');
    const payloadDigest = await sha256Digest(payloadJson);
    const proposalId = await ctx.db.insert('proposals', {
      projectId: job.projectId,
      jobId: job._id,
      artifactId: args.artifactId,
      baseRecipeVersion,
      payloadJson,
      payloadDigest,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(job._id, {
      status: 'awaiting_review',
      leaseId: undefined,
      leaseUntil: undefined,
      updatedAt: now,
    });
    await appendJobEvent(
      ctx,
      job._id,
      'proposal.created',
      { baseRecipeVersion, payloadDigest, proposalId },
      now,
    );
    return { payloadDigest, proposalId };
  },
});

export const approve = internalMutation({
  args: {
    proposalId: v.id('proposals'),
    expectedDigest: v.string(),
    approverRef: v.string(),
  },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (proposal === null) throw new Error('proposal_not_found');
    const expectedDigest = assertSha256Digest(args.expectedDigest);
    const approverRef = assertBoundedString(args.approverRef, 256, 'approver_ref');
    await assertProposalApproval(proposal.payloadJson, proposal.payloadDigest, expectedDigest);

    if (proposal.status === 'approved') {
      if (proposal.approvalDigest !== expectedDigest) {
        throw new Error('proposal_approval_digest_conflict');
      }
      return { approved: true as const, reused: true };
    }
    if (proposal.status !== 'pending') throw new Error('proposal_is_not_pending');

    const now = Date.now();
    await ctx.db.patch(proposal._id, {
      status: 'approved',
      approvalDigest: expectedDigest,
      approverRef,
      updatedAt: now,
      decidedAt: now,
    });
    await appendJobEvent(
      ctx,
      proposal.jobId,
      'proposal.approved',
      { approverRef, payloadDigest: expectedDigest, proposalId: proposal._id },
      now,
    );
    return { approved: true as const, reused: false };
  },
});

export const reject = internalMutation({
  args: { proposalId: v.id('proposals'), approverRef: v.string() },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (proposal === null) throw new Error('proposal_not_found');
    const approverRef = assertBoundedString(args.approverRef, 256, 'approver_ref');
    if (proposal.status === 'rejected') return { rejected: true as const, reused: true };
    if (proposal.status !== 'pending') throw new Error('proposal_is_not_pending');

    const now = Date.now();
    await ctx.db.patch(proposal._id, {
      status: 'rejected',
      approverRef,
      updatedAt: now,
      decidedAt: now,
    });
    await appendJobEvent(
      ctx,
      proposal.jobId,
      'proposal.rejected',
      { approverRef, proposalId: proposal._id },
      now,
    );
    return { rejected: true as const, reused: false };
  },
});

export const get = internalQuery({
  args: { proposalId: v.id('proposals') },
  handler: (ctx, args) => ctx.db.get(args.proposalId),
});
