import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CREATORBENCH_FREEZE_SCHEMA,
  CREATORBENCH_INSTANCE_SCHEMA,
  CREATORBENCH_RESULT_CLASSES,
  CREATORBENCH_RESULT_SCHEMA,
  CREATORBENCH_REVIEW_SCHEMA,
  CREATORBENCH_SOURCE_SCHEMA,
  CREATORBENCH_SPLIT_SCHEMA,
  CREATOR_REQUEST_SCHEMA,
  type CreatorBenchFreezeReceipt,
  type CreatorBenchInstance,
  type CreatorBenchResult,
  type CreatorBenchReview,
  type CreatorBenchSourceRecord,
  type CreatorBenchSplitAssignment,
  type CreatorRequestV1,
  derivePublicClaim,
  validateCreatorBenchResult,
  validateCreatorBenchSource,
  validateCreatorRequest,
  validateFreezeReceipt,
  validatePublicClaimAgainstResults,
  validateSourceCatalog,
  validateSplitIsolation,
} from './creatorbench-contracts';

const HASH = `sha256:${'a'.repeat(64)}`;
const NOW = '2026-07-21T12:00:00.000Z';

const request: CreatorRequestV1 = {
  schemaVersion: CREATOR_REQUEST_SCHEMA,
  id: 'request:heldout:1',
  createdAt: NOW,
  sourceAssets: [
    {
      artifactId: 'asset:heldout:1',
      role: 'primary',
      sha256: HASH,
      locatorClass: 'private-vault',
    },
  ],
  output: {
    destinations: ['review'],
    targetDurationsMs: [30_000],
    aspectRatios: ['9:16'],
  },
  constraints: {
    privacy: 'private',
    localOnly: true,
    maxCostUsd: 1,
    maxLatencyMs: 120_000,
    permittedExecutors: ['local.smart-reframe@1'],
    prohibitedExecutors: ['hosted.smart-reframe@1'],
    mediaEgress: 'prohibited',
  },
  rights: {
    status: 'restricted-private',
    ownerOrLicensorId: 'owner:pseudonymous:1',
    permittedDerivativeUse: true,
    permittedModelProcessing: true,
  },
  intent: {
    workflow: 'smart-reframe',
    instruction: 'Keep the selected speaker visible in a vertical crop.',
    preserve: ['speaker', 'captions'],
    avoid: ['identity switches'],
  },
  requiredHumanApprovalPoints: ['before-render', 'before-canonical-apply'],
};

const review: CreatorBenchReview = {
  schemaVersion: CREATORBENCH_REVIEW_SCHEMA,
  id: 'review:1',
  instanceId: 'instance:1',
  resultId: 'result:1',
  reviewerPseudonym: 'reviewer-17',
  assignmentId: 'assignment:1',
  blind: true,
  usability: 'usable_as_is',
  correctionTimeSeconds: 0,
  correctnessIssues: [],
  missedSubjectOrContent: [],
  unwantedEdits: [],
  reasonCodes: [],
  submittedAt: NOW,
};

const result: CreatorBenchResult = {
  schemaVersion: CREATORBENCH_RESULT_SCHEMA,
  id: 'result:1',
  benchmarkVersion: 'CreatorBench v1',
  instanceId: 'instance:1',
  split: 'private-heldout',
  classification: 'automatic_usable',
  routeReceiptId: 'route:1',
  systemDeclaredSuccess: true,
  userInterventionCount: 0,
  outputArtifactIds: ['output:1'],
  execution: {
    startedAt: NOW,
    completedAt: '2026-07-21T12:00:01.000Z',
    latencyMs: 1_000,
    costUsd: 0,
    executorVersions: ['local.smart-reframe@1'],
  },
  checks: {
    correctSubjectOrContent: true,
    intendedSemanticsPreserved: true,
    audioSynchronized: true,
    exportDecodesAndReopens: true,
    noUnsupportedSyntheticContent: true,
    rightsPassed: true,
    privacyPassed: true,
    noUndeclaredExecutorSubstitution: true,
    provenanceComplete: true,
  },
  review,
  limitationCodes: [],
};

const source: CreatorBenchSourceRecord = {
  schemaVersion: CREATORBENCH_SOURCE_SCHEMA,
  id: 'source:1',
  privateLocatorClass: 'encrypted-evaluator-vault',
  creatorOwnerId: 'creator:1',
  relatedSourceGroupId: 'group:1',
  title: 'Private held-out creator clip',
  rights: {
    status: 'restricted-private',
    licenseName: 'CreatorBench evaluator-only consent',
    attribution: 'Withheld in public artifacts',
    permittedBenchmarkUses: ['analysis', 'human-review'],
    permittedRedistribution: false,
  },
  privacy: 'private',
  acquiredAt: NOW,
  sourceSha256: HASH,
  durationMs: 60_000,
  media: { width: 1920, height: 1080, fps: 30, codec: 'h264', hasAudio: true },
  corpusTier: 'speech-long-form',
  admissibleWorkflows: ['smart-reframe', 'talking-head-cleanup', 'golden-quote-variants'],
  admissibilityNotes: ['Long-form speech source with audio.'],
  split: 'private-heldout',
  knownLimitations: ['Evaluator-only source.'],
};

const instance: CreatorBenchInstance = {
  schemaVersion: CREATORBENCH_INSTANCE_SCHEMA,
  id: 'instance:1',
  benchmarkVersion: 'CreatorBench v1',
  split: 'private-heldout',
  sourceIds: ['source:1'],
  domain: 'talking-head',
  workflow: 'smart-reframe',
  request,
  evaluatorTargetRef: 'evaluator-target:opaque:1',
  adversarialConditions: [],
  createdAt: NOW,
};

const freeze: CreatorBenchFreezeReceipt = {
  schemaVersion: CREATORBENCH_FREEZE_SCHEMA,
  id: 'freeze:creatorbench-v1',
  benchmarkVersion: 'CreatorBench v1',
  frozenAt: NOW,
  sourceCommitSha: 'b'.repeat(40),
  configHash: HASH,
  capabilityManifestHash: HASH,
  routerPolicyHash: HASH,
  thresholdPolicyHash: HASH,
  benchmarkManifestHash: HASH,
  evaluatorVersion: 'creatorbench-evaluator@1',
  evaluatorHash: HASH,
  modelVersions: ['detector@1'],
  executorVersions: ['local.smart-reframe@1'],
  privateSplit: {
    catalogHash: HASH,
    mediaStoredOutsideRepository: true,
    developmentCredentialsDenied: true,
    evaluatorCredentialsEnabledAt: '2026-07-21T12:00:01.000Z',
  },
};

describe('CreatorBench governance contracts', () => {
  it('accepts arbitrary requests through one rights- and privacy-aware contract', () => {
    expect(validateCreatorRequest(request)).toBe(request);
    expect(() =>
      validateCreatorRequest({
        ...request,
        constraints: { ...request.constraints, mediaEgress: 'allowed' },
      }),
    ).toThrow(/local-only/u);
    expect(() =>
      validateCreatorRequest({
        ...request,
        rights: { ...request.rights, status: 'unclear' },
      }),
    ).toThrow(/rights/u);
  });

  it('fails closed on private-media disclosure and invalid redistribution', () => {
    expect(validateCreatorBenchSource(source)).toBe(source);
    expect(() =>
      validateCreatorBenchSource({
        ...source,
        sourceUrl: 'https://example.com/private.mp4',
      }),
    ).toThrow(/cannot expose/u);
    expect(() =>
      validateCreatorBenchSource({
        ...source,
        rights: { ...source.rights, permittedRedistribution: true },
      }),
    ).toThrow(/cannot be marked for redistribution/u);
  });

  it('rejects creator, source-group, template, perceptual, and audio leakage across splits', () => {
    const base: CreatorBenchSplitAssignment = {
      schemaVersion: CREATORBENCH_SPLIT_SCHEMA,
      sourceId: 'source:development',
      split: 'development',
      creatorOwnerId: 'creator:shared',
      relatedSourceGroupId: 'group:development',
      templateFamilyId: 'template:development',
      perceptualHash: HASH,
      audioFingerprint: 'audio:development',
      assignedAt: NOW,
      assignmentPolicyVersion: 'creator-disjoint@1',
    };
    expect(validateSplitIsolation([base])).toEqual([base]);
    expect(() =>
      validateSplitIsolation([
        base,
        {
          ...base,
          sourceId: 'source:heldout',
          split: 'private-heldout',
          relatedSourceGroupId: 'group:heldout',
          templateFamilyId: 'template:heldout',
          perceptualHash: `sha256:${'c'.repeat(64)}`,
          audioFingerprint: 'audio:heldout',
        },
      ]),
    ).toThrow(/creator:creator:shared leaks/u);
  });

  it('binds rights records to their exact split assignments', () => {
    const assignment: CreatorBenchSplitAssignment = {
      schemaVersion: CREATORBENCH_SPLIT_SCHEMA,
      sourceId: source.id,
      split: source.split,
      creatorOwnerId: source.creatorOwnerId,
      relatedSourceGroupId: source.relatedSourceGroupId,
      perceptualHash: HASH,
      assignedAt: NOW,
      assignmentPolicyVersion: 'creator-disjoint@1',
    };
    expect(validateSourceCatalog([source], [assignment])).toEqual({
      sources: [source],
      assignments: [assignment],
    });
    expect(() =>
      validateSourceCatalog([source], [{ ...assignment, creatorOwnerId: 'creator:mismatch' }]),
    ).toThrow(/does not match/u);
  });

  it('keeps the result taxonomy exhaustive and silent failure first-class', () => {
    expect(CREATORBENCH_RESULT_CLASSES).toEqual([
      'automatic_usable',
      'assisted_usable',
      'review_required',
      'safely_abstained',
      'unsupported',
      'technical_failure',
      'silent_failure',
    ]);
    expect(validateCreatorBenchResult(result)).toBe(result);
    expect(() =>
      validateCreatorBenchResult({
        ...result,
        review: { ...review, usability: 'unusable' },
      }),
    ).toThrow(/automatic usable/u);
    expect(
      validateCreatorBenchResult({
        ...result,
        classification: 'silent_failure',
        review: { ...review, usability: 'unusable' },
      }).classification,
    ).toBe('silent_failure');
  });

  it('prevents private evaluator credentials from preceding the freeze', () => {
    expect(validateFreezeReceipt(freeze)).toBe(freeze);
    expect(() =>
      validateFreezeReceipt({
        ...freeze,
        privateSplit: {
          ...freeze.privateSplit,
          evaluatorCredentialsEnabledAt: '2026-07-21T11:59:59.000Z',
        },
      }),
    ).toThrow(/before the freeze/u);
  });

  it('derives every public count and sentence from frozen held-out results', () => {
    const claim = derivePublicClaim({
      benchmarkVersion: 'CreatorBench v1',
      freeze,
      generatedAt: '2026-07-21T12:01:00.000Z',
      instances: [instance],
      sources: [source],
      results: [result],
      limitations: ['One private held-out instance; no broad claim is warranted.'],
    });
    expect(claim.population).toEqual({
      split: 'private-heldout',
      instanceCount: 1,
      sourceCount: 1,
      creatorDisjointSourceCount: 1,
      domainCount: 1,
      workflowCount: 1,
    });
    expect(claim.outcomes.automatic_usable).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    expect(claim.outcomes.silent_failure).toEqual({ numerator: 0, denominator: 1, rate: 0 });
    expect(claim.statement).toContain('automatically in 100.0%');
    expect(
      validatePublicClaimAgainstResults(claim, {
        freeze,
        instances: [instance],
        sources: [source],
        results: [result],
      }),
    ).toBe(claim);
    expect(() =>
      validatePublicClaimAgainstResults(
        { ...claim, statement: 'NodeVideo always works.' },
        {
          freeze,
          instances: [instance],
          sources: [source],
          results: [result],
        },
      ),
    ).toThrow(/not derivable/u);
    expect(() =>
      derivePublicClaim({
        benchmarkVersion: 'CreatorBench v1',
        freeze,
        generatedAt: NOW,
        instances: [instance],
        sources: [source],
        results: [],
        limitations: [],
      }),
    ).toThrow(/exactly one/u);
  });

  it('ships schema IDs aligned with the TypeScript contracts', () => {
    const schemaDirectory = 'benchmarks/creatorbench-v1/schemas';
    const schemas = [
      ['creator-request.schema.json', CREATOR_REQUEST_SCHEMA],
      ['source.schema.json', CREATORBENCH_SOURCE_SCHEMA],
      ['split.schema.json', CREATORBENCH_SPLIT_SCHEMA],
      ['instance.schema.json', CREATORBENCH_INSTANCE_SCHEMA],
      ['result.schema.json', CREATORBENCH_RESULT_SCHEMA],
      ['reviewer.schema.json', CREATORBENCH_REVIEW_SCHEMA],
      ['freeze.schema.json', CREATORBENCH_FREEZE_SCHEMA],
    ];
    for (const [filename, expectedId] of schemas) {
      const schema = JSON.parse(readFileSync(`${schemaDirectory}/${filename}`, 'utf8'));
      expect(schema.$id).toBe(expectedId);
    }
  });
});
