import type { EditPlan } from './edit-contracts.ts';

export const EDIT_PLAN_V2_SCHEMA = 'nodevideo.edit-plan.v2' as const;

export type EditOperationV2 =
  | { id: string; kind: 'retain'; assetId: string; sourceStartMs: number; sourceEndMs: number }
  | {
      id: string;
      kind: 'remove';
      assetId: string;
      sourceStartMs: number;
      sourceEndMs: number;
      reason: string;
    }
  | { id: string; kind: 'caption'; text: string; startMs: number; endMs: number; styleId: string }
  | { id: string; kind: 'transition'; atMs: number; techniqueId: string; durationMs: number }
  | {
      id: string;
      kind: 'reframe';
      startMs: number;
      endMs: number;
      aspectRatio: '16:9' | '9:16' | '1:1';
    }
  | { id: string; kind: 'audio-level'; startMs: number; endMs: number; gainDb: number };

export type EditPlanV2 = {
  schemaVersion: typeof EDIT_PLAN_V2_SCHEMA;
  id: string;
  version: number;
  createdAt: string;
  mediaIndexIds: string[];
  intentId: string;
  outputIntentId: string;
  templateId?: string;
  operations: EditOperationV2[];
  approvals: Array<{
    id: string;
    operationIds: string[];
    status: 'required' | 'approved' | 'rejected';
    reason: string;
  }>;
  lineage: {
    sourceAssetIds: string[];
    recipeId: string;
    compiledRecipeId: string;
    executorIds: string[];
  };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function validateEditPlanV2(plan: EditPlanV2): EditPlanV2 {
  assert(plan.schemaVersion === EDIT_PLAN_V2_SCHEMA, 'EditPlan v2 schema is unsupported');
  assert(plan.id && plan.intentId && plan.outputIntentId, 'EditPlan v2 identity is required');
  assert(plan.mediaIndexIds.length > 0, 'EditPlan v2 requires a MediaIndex');
  assert(plan.lineage.sourceAssetIds.length > 0, 'EditPlan v2 requires source lineage');
  const ids = new Set<string>();
  for (const operation of plan.operations) {
    assert(operation.id && !ids.has(operation.id), 'EditPlan v2 operation IDs must be unique');
    ids.add(operation.id);
    if ('sourceStartMs' in operation) {
      assert(operation.sourceStartMs >= 0, `${operation.id} starts before the source`);
      assert(operation.sourceEndMs > operation.sourceStartMs, `${operation.id} has no duration`);
    }
    if ('startMs' in operation)
      assert(operation.endMs > operation.startMs, `${operation.id} has no duration`);
    if (operation.kind === 'transition')
      assert(operation.durationMs > 0, `${operation.id} has no duration`);
  }
  for (const approval of plan.approvals) {
    assert(
      approval.operationIds.every((id) => ids.has(id)),
      `${approval.id} references a missing operation`,
    );
  }
  return plan;
}

/** Wraps a proven v1 renderer plan without changing its rendering semantics. */
export function describeV1PlanAsV2(input: {
  plan: EditPlan;
  mediaIndexId: string;
  intentId: string;
  outputIntentId: string;
  recipeId: string;
  compiledRecipeId: string;
  executorIds: string[];
}): EditPlanV2 {
  const operations: EditOperationV2[] = [];
  for (const track of input.plan.tracks) {
    if (track.kind !== 'video' || track.role !== 'primary') continue;
    for (const clip of track.clips) {
      if (clip.kind !== 'source') continue;
      operations.push({
        id: `retain:${clip.id}`,
        kind: 'retain',
        assetId: clip.assetId,
        sourceStartMs: (clip.sourceRange.startFrame / input.plan.frameRate) * 1_000,
        sourceEndMs: (clip.sourceRange.endFrameExclusive / input.plan.frameRate) * 1_000,
      });
    }
  }
  return validateEditPlanV2({
    schemaVersion: EDIT_PLAN_V2_SCHEMA,
    id: `${input.plan.id}:v2-description`,
    version: input.plan.version,
    createdAt: input.plan.createdAt,
    mediaIndexIds: [input.mediaIndexId],
    intentId: input.intentId,
    outputIntentId: input.outputIntentId,
    operations,
    approvals: [],
    lineage: {
      sourceAssetIds: [
        ...new Set(
          operations.flatMap((operation) => ('assetId' in operation ? [operation.assetId] : [])),
        ),
      ],
      recipeId: input.recipeId,
      compiledRecipeId: input.compiledRecipeId,
      executorIds: [...new Set(input.executorIds)],
    },
  });
}
