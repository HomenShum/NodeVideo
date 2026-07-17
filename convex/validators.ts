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
  v.literal('stage.started'),
  v.literal('stage.completed'),
  v.literal('stage.failed'),
  v.literal('stage.retry_scheduled'),
  v.literal('stage.awaiting_approval'),
  v.literal('plan.frozen'),
  v.literal('evaluation.unsealed'),
);

export const stageName = v.union(
  v.literal('validate_inputs'),
  v.literal('ingest_reference'),
  v.literal('learn_creator_profile'),
  v.literal('normalize_media'),
  v.literal('align_reference_song'),
  v.literal('extract_reference_motion'),
  v.literal('analyze_takes'),
  v.literal('ground_subjects'),
  v.literal('interpret_production'),
  v.literal('match_phrases'),
  v.literal('plan_sequence'),
  v.literal('place_lyrics'),
  v.literal('compose_editorial_overlays'),
  v.literal('compile_plan'),
  v.literal('render_preview'),
  v.literal('validate_preview'),
  v.literal('await_review'),
  v.literal('freeze'),
  v.literal('evaluate_hidden_target'),
);

export const stageStatus = v.union(
  v.literal('pending'),
  v.literal('running'),
  v.literal('awaiting_approval'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('cancelled'),
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
  | 'proposal.rejected'
  | 'stage.started'
  | 'stage.completed'
  | 'stage.failed'
  | 'stage.retry_scheduled'
  | 'stage.awaiting_approval'
  | 'plan.frozen'
  | 'evaluation.unsealed';
