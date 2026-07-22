import { v } from 'convex/values';

export const CASEFLOW_SCHEMA_VERSIONS = {
  approval: 'nodekit.approval/v1',
  artifact: 'nodekit.artifact/v1',
  case: 'nodekit.case/v1',
  event: 'nodekit.caseflow-event/v1',
  exception: 'nodekit.exception/v1',
  proposal: 'nodekit.proposal/v1',
  receipt: 'nodekit.receipt/v1',
  run: 'nodekit.run/v1',
} as const;

export const caseflowCaseStatus = v.union(
  v.literal('ready'),
  v.literal('in_progress'),
  v.literal('completed'),
);

export const caseflowRunStatus = v.union(
  v.literal('active'),
  v.literal('blocked'),
  v.literal('cancelled'),
  v.literal('completed'),
  v.literal('failed_safely'),
);

export const caseflowStageStatus = v.union(
  v.literal('active'),
  v.literal('completed'),
  v.literal('pending'),
);

export const caseflowProposalStatus = v.union(
  v.literal('pending'),
  v.literal('accepted'),
  v.literal('rejected'),
  v.literal('conflicted'),
);

export const caseflowDecision = v.union(v.literal('accepted'), v.literal('rejected'));
export const caseflowExceptionStatus = v.union(v.literal('open'), v.literal('resolved'));

export const caseflowStage = v.object({
  id: v.string(),
  label: v.string(),
  owner: v.string(),
  status: caseflowStageStatus,
});

export type CaseflowRunStatus = 'active' | 'blocked' | 'cancelled' | 'completed' | 'failed_safely';
export type CaseflowDecision = 'accepted' | 'rejected';

export const TERMINAL_CASEFLOW_RUN_STATUSES = new Set<CaseflowRunStatus>([
  'cancelled',
  'completed',
  'failed_safely',
]);
