import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { NodeVideoRecipeSettings } from './contracts';
import {
  type NodeVideoWorkflowCandidate,
  inspectNodeVideoWorkflowCandidate,
  validateNodeVideoWorkflowCandidate,
} from './nodeVideoWorkflowCandidate';
import {
  NODE_WORKFLOW_PROTOCOL_VERSION,
  type NodeWorkflowRequest,
  type NodeWorkflowResult,
  canonicalNodeWorkflowJson,
} from './workflowExecutionPort';

const request: NodeWorkflowRequest = {
  schemaVersion: NODE_WORKFLOW_PROTOCOL_VERSION,
  app: 'nodevideo',
  workflow: 'parallel-shot-render',
  fixtureId: 'nodevideo-resume-shots-v1',
  traceId: 'trace-nodevideo-resume-shots-1',
  inputDigest: `sha256:${'1'.repeat(64)}`,
  baseVersion: 4,
  idempotencyKey: 'nodevideo-resume-shots-v1:run-1',
  concurrency: 4,
  deadlineMs: 10_000,
};

const baseSettings: NodeVideoRecipeSettings = {
  alignment: { method: 'synthetic-fixture', offsetMs: 0, maxSearchMs: 2_000 },
  difference: { scoreThreshold: 0.2, minimumSegmentMs: 100 },
  render: { layout: 'side-by-side', fps: 30 },
  focusWindows: [],
};

describe('NodeVideo workflow execution port', () => {
  it('validates a complete render candidate without creating a job or proposal', async () => {
    const candidate = buildCandidate();
    const admission = await inspectNodeVideoWorkflowCandidate({
      request,
      result: resultFor(candidate),
      expectedAppCommit: 'bb79bc385de93c90cee89b160fc801d18372d89e',
      expectedProjectId: 'project-1',
      expectedRecipeId: 'recipe-1',
      expectedSourceAssetIds: ['project-1:asset-a', 'project-1:asset-b'],
      baseSettings,
      expectedShotIds: ['shot-1', 'shot-2', 'shot-3', 'shot-4'],
      digestCandidate: digest,
      now: () => new Date('2026-07-15T10:00:00.000Z'),
    });

    expect(admission.accepted).toBe(true);
    expect(admission.receipt.finalWriteAuthority).toBe('application_validation_cas_review');
    expect(Object.keys(admission)).not.toContain('proposalId');
    expect(Object.keys(admission)).not.toContain('jobId');
  });

  it('rejects stale recipes and incomplete render manifests', async () => {
    const candidate = buildCandidate();
    candidate.baseRecipeVersion = 3;
    candidate.shots.pop();
    const admission = await inspectNodeVideoWorkflowCandidate({
      request,
      result: resultFor(candidate),
      expectedAppCommit: 'bb79bc385de93c90cee89b160fc801d18372d89e',
      expectedProjectId: 'project-1',
      expectedRecipeId: 'recipe-1',
      expectedSourceAssetIds: ['project-1:asset-a', 'project-1:asset-b'],
      baseSettings,
      expectedShotIds: ['shot-1', 'shot-2', 'shot-3', 'shot-4'],
      digestCandidate: digest,
    });

    expect(admission.accepted).toBe(false);
    expect(admission.receipt.issues).toContain(
      'NodeVideo candidate is stale relative to the requested recipe version.',
    );
    expect(admission.receipt.issues).toContain(
      'NodeVideo render manifest is missing, duplicating, or adding shots.',
    );
  });

  it('rejects a candidate for a different project or recipe', async () => {
    const candidate = buildCandidate();
    candidate.projectId = 'project-2';
    candidate.recipeId = 'recipe-2';
    const firstShot = candidate.shots[0];
    if (!firstShot) throw new Error('fixture must include a render shot');
    firstShot.sourceAssetId = 'project-2:asset-a';

    const admission = await inspectNodeVideoWorkflowCandidate({
      request,
      result: resultFor(candidate),
      expectedAppCommit: 'bb79bc385de93c90cee89b160fc801d18372d89e',
      expectedProjectId: 'project-1',
      expectedRecipeId: 'recipe-1',
      expectedSourceAssetIds: ['project-1:asset-a', 'project-1:asset-b'],
      baseSettings,
      expectedShotIds: ['shot-1', 'shot-2', 'shot-3', 'shot-4'],
      digestCandidate: digest,
    });

    expect(admission.accepted).toBe(false);
    expect(admission.receipt.issues).toContain(
      'NodeVideo candidate crossed the expected project boundary.',
    );
    expect(admission.receipt.issues).toContain(
      'NodeVideo candidate does not target the expected recipe.',
    );
    expect(admission.receipt.issues).toContain(
      'NodeVideo shot shot-1 crossed the expected asset boundary.',
    );
  });

  it('binds a reusable creator profile to the edit candidate', () => {
    const candidate = buildCandidate();
    candidate.creatorTaste = {
      profileId: 'creator-taste.owner-v1',
      profileDigest: `sha256:${'a'.repeat(64)}`,
      sourceProductionIds: ['production.reference-1'],
      evaluationReady: true,
    };
    expect(
      validateNodeVideoWorkflowCandidate(
        candidate,
        request,
        baseSettings,
        ['shot-1', 'shot-2', 'shot-3', 'shot-4'],
        'project-1',
        'recipe-1',
        ['project-1:asset-a', 'project-1:asset-b'],
      ),
    ).toEqual([]);
  });
});

function buildCandidate(): NodeVideoWorkflowCandidate {
  const fixture = JSON.parse(
    readFileSync(
      new URL('./fixtures/rocketride-nodevideo-resume-shots.json', import.meta.url),
      'utf8',
    ),
  ) as { candidate: NodeVideoWorkflowCandidate };
  return fixture.candidate;
}

function resultFor(
  candidate: NodeVideoWorkflowCandidate,
): NodeWorkflowResult<NodeVideoWorkflowCandidate> {
  return {
    schemaVersion: NODE_WORKFLOW_PROTOCOL_VERSION,
    runId: 'nodevideo-native-001',
    traceId: request.traceId,
    framework: 'native',
    candidate,
    inputDigest: request.inputDigest,
    idempotencyKey: request.idempotencyKey,
    outputDigest: digest(candidate),
    events: [
      { sequence: 1, atMs: 0, kind: 'run.started' },
      { sequence: 2, atMs: 15, kind: 'candidate.produced', unitId: 'shot-1' },
      { sequence: 3, atMs: 20, kind: 'candidate.produced', unitId: 'shot-2' },
    ],
    metrics: {
      coldStartMs: 1,
      warmupMs: 0,
      executionMs: 19,
      totalMs: 20,
      retryCount: 0,
      completedUnits: 2,
      failedUnits: 0,
      duplicateUnits: 0,
      leakedUnits: 0,
    },
    provenance: {
      adapter: 'nodevideo-native',
      adapterVersion: '1.0.0',
      runtime: 'node',
      runtimeVersion: process.version,
      appCommit: 'bb79bc385de93c90cee89b160fc801d18372d89e',
      deterministic: true,
      location: 'local',
    },
  };
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalNodeWorkflowJson(value)).digest('hex')}`;
}
