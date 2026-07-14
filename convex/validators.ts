import { v } from 'convex/values';

export const jobStatus = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('awaiting_review'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('cancelled'),
);

export const jobEventKind = v.union(
  v.literal('job.created'),
  v.literal('job.completed'),
  v.literal('job.failed'),
  v.literal('job.retry_scheduled'),
  v.literal('job.cancelled'),
  v.literal('lease.claimed'),
  v.literal('lease.heartbeat'),
  v.literal('worker.progress'),
  v.literal('worker.log'),
  v.literal('artifact.recorded'),
  v.literal('proposal.created'),
  v.literal('proposal.approved'),
  v.literal('proposal.rejected'),
);

export const workerEventKind = v.union(v.literal('worker.progress'), v.literal('worker.log'));

export const proposalStatus = v.union(
  v.literal('pending'),
  v.literal('approved'),
  v.literal('rejected'),
  v.literal('superseded'),
);

export const runtimeLayer = v.union(
  v.literal('frontend'),
  v.literal('convex'),
  v.literal('worker'),
);

export type JobEventKind =
  | 'job.created'
  | 'job.completed'
  | 'job.failed'
  | 'job.retry_scheduled'
  | 'job.cancelled'
  | 'lease.claimed'
  | 'lease.heartbeat'
  | 'worker.progress'
  | 'worker.log'
  | 'artifact.recorded'
  | 'proposal.created'
  | 'proposal.approved'
  | 'proposal.rejected';
