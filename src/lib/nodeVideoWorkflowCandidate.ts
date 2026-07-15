import type { NodeVideoRecipePatch, NodeVideoRecipeSettings, TimeRange } from './contracts';
import { applyNodeVideoRecipePatch } from './runtime';
import {
  type CandidateAdmission,
  type NodeWorkflowRequest,
  type NodeWorkflowResult,
  inspectNodeWorkflowCandidate,
} from './workflowExecutionPort';

export interface NodeVideoRenderShot {
  id: string;
  sourceAssetId: string;
  sourceRange: TimeRange;
  outputRange: TimeRange;
  overlayText?: string;
  beatIndex?: number;
}

export interface NodeVideoWorkflowCandidate {
  kind: 'edit-decision-and-render-manifest';
  projectId: string;
  recipeId: string;
  baseRecipeVersion: number;
  recipePatch: NodeVideoRecipePatch;
  durationMs: number;
  shots: NodeVideoRenderShot[];
  reusedShotIds: string[];
}

/**
 * Checks a sidecar candidate against NodeVideo's recipe invariants. It does not
 * create a job, artifact, proposal, or recipe version; those stay behind the
 * durable application mutations and review gate.
 */
export function inspectNodeVideoWorkflowCandidate(args: {
  request: NodeWorkflowRequest;
  result: NodeWorkflowResult<NodeVideoWorkflowCandidate>;
  expectedAppCommit: string;
  expectedProjectId: string;
  expectedRecipeId: string;
  expectedSourceAssetIds: readonly string[];
  baseSettings: NodeVideoRecipeSettings;
  expectedShotIds: readonly string[];
  digestCandidate: (candidate: NodeVideoWorkflowCandidate) => string | Promise<string>;
  now?: () => Date;
}): Promise<CandidateAdmission<NodeVideoWorkflowCandidate>> {
  return inspectNodeWorkflowCandidate({
    request: args.request,
    result: args.result,
    expectedApp: 'nodevideo',
    expectedAppCommit: args.expectedAppCommit,
    digestCandidate: args.digestCandidate,
    validateCandidate: (candidate) =>
      validateNodeVideoWorkflowCandidate(
        candidate,
        args.request,
        args.baseSettings,
        args.expectedShotIds,
        args.expectedProjectId,
        args.expectedRecipeId,
        args.expectedSourceAssetIds,
      ),
    now: args.now,
  });
}

export function validateNodeVideoWorkflowCandidate(
  candidate: NodeVideoWorkflowCandidate,
  request: NodeWorkflowRequest,
  baseSettings: NodeVideoRecipeSettings,
  expectedShotIds: readonly string[],
  expectedProjectId: string,
  expectedRecipeId: string,
  expectedSourceAssetIds: readonly string[],
): string[] {
  const issues: string[] = [];
  if (candidate?.kind !== 'edit-decision-and-render-manifest') {
    return ['NodeVideo candidate must be an edit decision and render manifest.'];
  }
  if (!bounded(candidate.projectId, 1, 128)) issues.push('NodeVideo project ID is invalid.');
  if (!bounded(candidate.recipeId, 1, 128)) issues.push('NodeVideo recipe ID is invalid.');
  if (candidate.projectId !== expectedProjectId) {
    issues.push('NodeVideo candidate crossed the expected project boundary.');
  }
  if (candidate.recipeId !== expectedRecipeId) {
    issues.push('NodeVideo candidate does not target the expected recipe.');
  }
  if (!Number.isSafeInteger(candidate.baseRecipeVersion) || candidate.baseRecipeVersion < 1) {
    issues.push('NodeVideo base recipe version is invalid.');
  }
  if (request.baseVersion !== undefined && candidate.baseRecipeVersion !== request.baseVersion) {
    issues.push('NodeVideo candidate is stale relative to the requested recipe version.');
  }
  if (!Number.isFinite(candidate.durationMs) || candidate.durationMs <= 0) {
    issues.push('NodeVideo candidate duration is invalid.');
  }

  try {
    applyNodeVideoRecipePatch(baseSettings, candidate.recipePatch);
  } catch (error) {
    issues.push(`NodeVideo recipe patch is invalid: ${errorMessage(error)}`);
  }

  if (
    !Array.isArray(candidate.shots) ||
    candidate.shots.length < 1 ||
    candidate.shots.length > 512
  ) {
    issues.push('NodeVideo candidate must contain 1 to 512 render shots.');
    return issues;
  }
  const shotIds = new Set<string>();
  const sourceAssetIds = new Set(expectedSourceAssetIds);
  for (const shot of candidate.shots) {
    if (!bounded(shot.id, 1, 128)) issues.push('NodeVideo shot ID is invalid.');
    if (shotIds.has(shot.id)) issues.push(`Duplicate NodeVideo shot: ${shot.id}.`);
    shotIds.add(shot.id);
    if (!bounded(shot.sourceAssetId, 1, 256)) {
      issues.push(`NodeVideo shot ${shot.id} has an invalid source asset.`);
    } else if (!sourceAssetIds.has(shot.sourceAssetId)) {
      issues.push(`NodeVideo shot ${shot.id} crossed the expected asset boundary.`);
    }
    validateRange(shot.sourceRange, `NodeVideo shot ${shot.id} source range`, issues);
    validateRange(shot.outputRange, `NodeVideo shot ${shot.id} output range`, issues);
    if (shot.outputRange.endMs > candidate.durationMs) {
      issues.push(`NodeVideo shot ${shot.id} exceeds the manifest duration.`);
    }
    if (shot.overlayText !== undefined && !bounded(shot.overlayText, 1, 500)) {
      issues.push(`NodeVideo shot ${shot.id} overlay text is invalid.`);
    }
    if (
      shot.beatIndex !== undefined &&
      (!Number.isSafeInteger(shot.beatIndex) || shot.beatIndex < 0)
    ) {
      issues.push(`NodeVideo shot ${shot.id} beat index is invalid.`);
    }
  }

  const expected = [...new Set(expectedShotIds)].sort();
  const actual = [...shotIds].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    issues.push('NodeVideo render manifest is missing, duplicating, or adding shots.');
  }
  const reused = candidate.reusedShotIds ?? [];
  if (new Set(reused).size !== reused.length || reused.some((id) => !shotIds.has(id))) {
    issues.push('NodeVideo reused-shot references are invalid.');
  }
  return [...new Set(issues)];
}

function validateRange(range: TimeRange, label: string, issues: string[]): void {
  if (
    !range ||
    !Number.isFinite(range.startMs) ||
    !Number.isFinite(range.endMs) ||
    range.startMs < 0 ||
    range.endMs <= range.startMs
  ) {
    issues.push(`${label} is invalid.`);
  }
}

function bounded(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.length <= max;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
