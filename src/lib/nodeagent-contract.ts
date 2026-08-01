import runtime from './nodeagent-runtime.json';

export const NODE_AGENT_LIMITS = runtime.limits;
export const CREATOR_PLANNING_OPERATIONS = runtime.creatorPlanningOperations;

export type NodeAgentDepthMode = 'iterative' | 'single_pass_degraded' | 'deterministic';
export type NodeAgentTraceKind = 'model' | 'tool' | 'status';
export type NodeAgentTraceStatus = 'completed' | 'degraded' | 'failed';
export type CreatorPlanningOperationKind =
  | 'remove_silence'
  | 'review_fillers'
  | 'extract_quote'
  | 'compose_variants'
  | 'add_transitions'
  | 'preserve_meaning';

export type NodeAgentTraceStep = {
  id: string;
  kind: NodeAgentTraceKind;
  status: NodeAgentTraceStatus;
  detail: string;
  model?: string;
  latencyMs?: number;
};

export type CreatorPlanningOperation = {
  kind: CreatorPlanningOperationKind;
  reason: string;
};

export type NodeAgentPlannerTrace = {
  runId: string;
  depthMode: NodeAgentDepthMode;
  iterations: number;
  trace: NodeAgentTraceStep[];
  degradedReason?: string;
};
