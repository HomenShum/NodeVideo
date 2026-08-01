import { describe, expect, it } from 'vitest';
import {
  CREATORBENCH_INSTANCE_SCHEMA,
  CREATOR_REQUEST_SCHEMA,
  type CreatorBenchInstance,
} from './creatorbench-contracts';
import { executeTalkingHeadCleanupPlan } from './creatorbench-workflow-execution';
import { MEDIA_INDEX_SCHEMA, type MediaIndex } from './media-orchestration-contracts';

const instance: CreatorBenchInstance = {
  schemaVersion: CREATORBENCH_INSTANCE_SCHEMA,
  id: 'instance:speech:cleanup',
  benchmarkVersion: 'creatorbench-test',
  split: 'development',
  sourceIds: ['source:speech'],
  domain: 'talking-head',
  workflow: 'talking-head-cleanup',
  scenarioId: 'baseline',
  request: {
    schemaVersion: CREATOR_REQUEST_SCHEMA,
    id: 'request:speech:cleanup',
    createdAt: '2026-07-22T00:00:00.000Z',
    sourceAssets: [
      {
        artifactId: 'source:speech',
        role: 'primary',
        sha256: `sha256:${'a'.repeat(64)}`,
        locatorClass: 'repository-fixture',
      },
    ],
    output: { destinations: ['review'], targetDurationsMs: [20_000], aspectRatios: ['16:9'] },
    constraints: {
      privacy: 'private',
      localOnly: true,
      maxCostUsd: 0,
      maxLatencyMs: 60_000,
      permittedExecutors: [],
      prohibitedExecutors: ['runtime:api'],
      mediaEgress: 'prohibited',
    },
    rights: {
      status: 'owner-consented',
      ownerOrLicensorId: 'owner:test',
      permittedDerivativeUse: true,
      permittedModelProcessing: true,
    },
    intent: {
      workflow: 'talking-head-cleanup',
      instruction: 'Remove accidental silence but preserve words and cadence.',
      preserve: ['meaning'],
      avoid: ['word truncation'],
    },
    requiredHumanApprovalPoints: ['before-render'],
  },
  adversarialConditions: [],
  createdAt: '2026-07-22T00:00:00.000Z',
};

const mediaIndex: MediaIndex = {
  schemaVersion: MEDIA_INDEX_SCHEMA,
  id: 'index:speech',
  assetId: 'source:speech',
  sourceHash: `sha256:${'a'.repeat(64)}`,
  technical: { durationMs: 20_000, width: 1280, height: 720, frameRate: 30, audioTracks: 1 },
  speech: {
    words: [
      { text: 'We', startMs: 1_000, endMs: 1_300, confidence: 1 },
      { text: 'built', startMs: 1_300, endMs: 1_800, confidence: 1 },
      { text: 'um', startMs: 12_000, endMs: 12_250, confidence: 1 },
    ],
    silenceRegions: [
      { startMs: 2_000, endMs: 2_600 },
      { startMs: 5_000, endMs: 7_000 },
    ],
    fillers: [{ text: 'um', startMs: 12_000, endMs: 12_250, confidence: 1 }],
  },
  visual: {
    shots: [{ id: 'shot:source', startMs: 0, endMs: 20_000, confidence: 1 }],
    subjectTrackIds: [],
    textRegions: [],
  },
  audio: { speechRegions: [{ startMs: 0, endMs: 20_000 }], musicRegions: [] },
  semantics: { topics: [], quotes: [], demonstrations: [] },
  provenance: { generatedAt: '2026-07-22T00:00:00.000Z', tools: [] },
};

describe('CreatorBench canonical workflow execution', () => {
  it('renders only deterministic silence removal and keeps fillers behind review', () => {
    const result = executeTalkingHeadCleanupPlan({ instance, mediaIndex });
    expect(result.automaticCutRanges).toEqual([{ startMs: 5_120, endMs: 6_880 }]);
    expect(result.fillerReviewRanges).toHaveLength(1);
    expect(result.metrics.speechRetention).toBe(1);
    expect(result.metrics.wordTruncations).toBe(0);
    expect(result.semanticPlan.approvals).toHaveLength(1);
    expect(result.evaluation.machinePass).toBe(false);
    expect(result.evaluation.missingMetricNames).toEqual(
      expect.arrayContaining(['intentionalPauseFalsePositives', 'audioClicks', 'exportReopens']),
    );
  });
});
