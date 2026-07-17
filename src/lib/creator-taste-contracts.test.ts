import { describe, expect, it } from 'vitest';
import {
  CREATOR_TASTE_PROFILE_SCHEMA_VERSION,
  type CreatorTasteProfile,
  PRODUCTION_AUDIT_SCHEMA_VERSION,
  type ProductionAudit,
  TARGET_SPEC_CONSISTENCY_SCHEMA_VERSION,
  type TargetSpecConsistencyReport,
  regionVerticalZone,
  validateCreatorTasteProfile,
  validateProductionAudit,
  validateTargetSpecConsistencyReport,
} from './creator-taste-contracts';

function audit(): ProductionAudit {
  return {
    schemaVersion: PRODUCTION_AUDIT_SCHEMA_VERSION,
    id: 'production.1',
    createdAt: '2026-07-16T12:00:00.000Z',
    durationMs: 30_000,
    contentKind: 'tutorial',
    evidenceArtifactIds: ['evidence.production.1'],
    observations: {
      textCues: [
        {
          text: 'Three ways to frame a hook',
          role: 'hook',
          startMs: 0,
          endMs: 2_000,
          confidence: 0.98,
          region: { x: 0.1, y: 0.05, width: 0.8, height: 0.1 },
        },
      ],
      cuts: [{ frame: 60, confidence: 0.9 }],
      visualTreatment: { lumaMean: 92, lumaStd: 40, saturationMean: 74 },
    },
    claimedTargetSpec: {
      overlayCount: 1,
      roles: ['hook'],
      persistentIdentity: false,
      endCard: false,
      visualTreatmentDescribed: true,
      verticalZones: ['top'],
    },
  };
}

function supported<T>(value: T) {
  return {
    value,
    supportProductions: 1,
    confidence: 0.45,
    evidenceRefs: ['evidence.production.1'],
  };
}

function profile(): CreatorTasteProfile {
  return {
    schemaVersion: CREATOR_TASTE_PROFILE_SCHEMA_VERSION,
    id: 'taste.creator.1',
    learnedAt: '2026-07-16T12:01:00.000Z',
    sourceProductionIds: ['production.1'],
    applicableContentKinds: ['tutorial'],
    confidence: 0.45,
    editorialAttention: {
      textCuesPerMinute: supported(2),
      hookInFirstThreeSecondsRate: supported(1),
      endCardRate: supported(0),
      preferredCueRoles: supported(['hook']),
    },
    creatorVoice: {
      commentaryRate: supported(0),
      instructionRate: supported(0),
      lyricRate: supported(0),
      ctaRate: supported(0),
    },
    spatialGrammar: {
      roleZones: [{ role: 'hook', zone: 'top', confidence: 1, samples: 1 }],
    },
    visualWorld: {
      lumaMean: supported(92),
      lumaStd: supported(40),
      saturationMean: supported(74),
    },
    distributionIdentity: {
      persistentIdentityRate: supported(0),
      identityTokens: supported([]),
    },
    cautions: ['Profile is provisional.'],
  };
}

function consistency(): TargetSpecConsistencyReport {
  return {
    schemaVersion: TARGET_SPEC_CONSISTENCY_SCHEMA_VERSION,
    auditId: 'production.1',
    status: 'pass',
    score: 1,
    checks: [
      {
        id: 'ocr-overlay-coverage',
        status: 'pass',
        observed: '1 OCR cue',
        claimed: '1 overlay',
        message: 'The target interpretation explains the visible text.',
      },
    ],
    blockingReasons: [],
  };
}

describe('creator taste contracts', () => {
  it('validates a content-agnostic production audit and learned taste profile', () => {
    expect(() => validateProductionAudit(audit())).not.toThrow();
    expect(() => validateCreatorTasteProfile(profile())).not.toThrow();
    expect(regionVerticalZone({ x: 0, y: 0.7, width: 0.2, height: 0.1 })).toBe('bottom');
  });

  it('rejects unsafe regions and unsupported content taxonomies', () => {
    const invalidRegion = structuredClone(audit());
    invalidRegion.observations.textCues[0].region.width = 0.95;
    expect(() => validateProductionAudit(invalidRegion)).toThrow(/horizontal bounds/);

    const invalidKind = structuredClone(audit());
    (invalidKind as unknown as { contentKind: string }).contentKind = 'dance-only-special-case';
    expect(() => validateProductionAudit(invalidKind)).toThrow(/contentKind is invalid/);
  });

  it('requires consistency report status to reflect failed checks', () => {
    expect(() => validateTargetSpecConsistencyReport(consistency())).not.toThrow();
    const contradictory = structuredClone(consistency());
    contradictory.checks[0].status = 'fail';
    expect(() => validateTargetSpecConsistencyReport(contradictory)).toThrow(
      /status must reflect failed checks/,
    );
  });
});
