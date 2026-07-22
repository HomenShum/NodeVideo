import { expect, test } from 'vitest';
import { applyCreatorBenchScenario, creatorBenchScenarios } from './creatorbench-scenarios.mjs';

const baseRequest = {
  schemaVersion: 'nodevideo.creator-request/v1',
  id: 'request:source:workflow',
  createdAt: '2026-07-22T00:00:00.000Z',
  sourceAssets: [],
  output: {
    destinations: ['review'],
    targetDurationsMs: [30_000],
    aspectRatios: ['16:9', '9:16', '1:1'],
  },
  constraints: {
    privacy: 'public',
    localOnly: false,
    maxCostUsd: 1,
    maxLatencyMs: 120_000,
    permittedExecutors: [],
    prohibitedExecutors: [],
    mediaEgress: 'prohibited',
  },
  rights: {
    status: 'public-domain',
    permittedDerivativeUse: true,
    permittedModelProcessing: true,
  },
  intent: {
    workflow: 'smart-reframe',
    instruction: 'Reframe the source.',
    preserve: ['source meaning'],
    avoid: ['silent subject switches'],
  },
  requiredHumanApprovalPoints: ['before-render'],
};

test('defines eight distinct request-policy scenarios', () => {
  expect(creatorBenchScenarios).toHaveLength(8);
  expect(new Set(creatorBenchScenarios.map((scenario) => scenario.id)).size).toBe(8);
});

test('applies every scenario without mutating the base request', () => {
  const original = structuredClone(baseRequest);
  const requests = creatorBenchScenarios.map((scenario) =>
    applyCreatorBenchScenario(baseRequest, scenario),
  );
  expect(baseRequest).toEqual(original);
  expect(new Set(requests.map((request) => request.id)).size).toBe(8);
});

test('local-private and bounded-assistance scenarios preserve honest route constraints', () => {
  const local = applyCreatorBenchScenario(
    baseRequest,
    creatorBenchScenarios.find((scenario) => scenario.id === 'local-private'),
  );
  expect(local.constraints.localOnly).toBe(true);
  expect(local.constraints.mediaEgress).toBe('prohibited');
  expect(local.constraints.prohibitedExecutors).toContain('runtime:api');

  const assisted = applyCreatorBenchScenario(
    baseRequest,
    creatorBenchScenarios.find((scenario) => scenario.id === 'bounded-assistance'),
  );
  expect(assisted.selectedSubject).toEqual({
    kind: 'point',
    value: [0.5, 0.5],
    frameMs: 0,
  });
});
