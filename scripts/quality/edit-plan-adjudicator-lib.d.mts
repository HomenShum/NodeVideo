import type { CriticCategory, CriticReport, FrameRange } from '../../src/lib/edit-contracts';

export const PLAN_ADJUDICATOR_VERSION: 'nodevideo.plan-adjudicator@1.2.0';
export const EVENT_SCORE_REPORT_VERSION: 'nodevideo.event-score-report.v2';
export const CRITIC_REPORT_VERSION: 'nodevideo.critic-report.v2';
export const RENDER_METRICS_VERSION: 'nodevideo.render-metrics.v1';
export const MINIMUM_PERMANENT_WINDOW_SCORE: 0.9;
export const MINIMUM_ANY_WINDOW_SCORE: 0.85;
export const RELEASE_READINESS_SCOPE: 'technical-reconstruction-of-authorized-reference-case';

export interface AdjudicationEvent {
  id: string;
  category: CriticCategory;
  pass: boolean;
  score: number;
  permanent: boolean;
  message: string;
  timelineRange?: FrameRange;
  expected: unknown;
  observed: unknown;
}

export interface EventScoreReport {
  schemaVersion: typeof EVENT_SCORE_REPORT_VERSION;
  evaluatorVersion: typeof PLAN_ADJUDICATOR_VERSION;
  groundTruthId: string;
  planId: string;
  planVersion: number;
  renderArtifactId: string;
  renderMetricsProvided: boolean;
  scope: 'plan-only' | 'plan-and-render';
  passed: boolean;
  releaseReady: boolean;
  releaseReadyScope: typeof RELEASE_READINESS_SCOPE;
  summary: {
    total: number;
    passed: number;
    failed: number;
    score: number;
    permanentFailure: boolean;
  };
  releaseBlockers: string[];
  events: AdjudicationEvent[];
}

export interface EditPlanAdjudication {
  criticReport: CriticReport;
  eventScoreReport: EventScoreReport;
}

export function adjudicateEditPlan(
  planInput: unknown,
  renderMetricsInput?: unknown,
  options?: { createdAt?: string },
): EditPlanAdjudication;
