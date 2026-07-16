import { describe, expect, it } from 'vitest';
import type { CreatorTasteWorkflowCandidate } from './creator-taste-nodeagent';
import { validateCreatorTasteWorkflowCandidate } from './creator-taste-nodeagent';

const audit = {
  schemaVersion: 'nodevideo.production-audit.v1' as const,
  id: 'production.one',
  createdAt: '2026-07-16T00:00:00.000Z',
  durationMs: 10_000,
  contentKind: 'tutorial' as const,
  evidenceArtifactIds: ['artifact.audit.one'],
  observations: {
    textCues: [
      {
        text: 'Watch this',
        role: 'hook' as const,
        startMs: 0,
        endMs: 1_000,
        confidence: 0.9,
        region: { x: 0.1, y: 0.05, width: 0.8, height: 0.08 },
      },
    ],
    cuts: [{ frame: 30, confidence: 0.8 }],
  },
};

function candidate(): CreatorTasteWorkflowCandidate {
  const supported = <T>(value: T) => ({
    value,
    supportProductions: 1,
    confidence: 0.5,
    evidenceRefs: ['artifact.audit.one'],
  });
  return {
    kind: 'creator-taste-and-production-audit',
    projectId: 'project.one',
    profile: {
      schemaVersion: 'nodevideo.creator-taste-profile.v1',
      id: 'profile.one',
      learnedAt: '2026-07-16T00:00:00.000Z',
      sourceProductionIds: ['production.one'],
      applicableContentKinds: ['tutorial'],
      confidence: 0.5,
      editorialAttention: {
        textCuesPerMinute: supported(6),
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
      distributionIdentity: {
        persistentIdentityRate: supported(0),
        identityTokens: supported([]),
      },
      cautions: ['Single-production profile.'],
    },
    audits: [audit],
    consistencyReports: [
      {
        schemaVersion: 'nodevideo.target-spec-consistency.v1',
        auditId: 'production.one',
        status: 'pass',
        score: 1,
        checks: [
          {
            id: 'spec.coverage',
            status: 'pass',
            observed: 'hook',
            claimed: 'hook',
            message: 'Observed and claimed overlays agree.',
          },
        ],
        blockingReasons: [],
      },
    ],
    evaluationReady: true,
  };
}

describe('Creator taste NodeAgent admission', () => {
  it('accepts a content-neutral profile bound to its exact audits and consistency reports', () => {
    expect(validateCreatorTasteWorkflowCandidate(candidate(), 'project.one', ['tutorial'])).toEqual(
      [],
    );
  });

  it('blocks creative evaluation when the interpreted target spec is inconsistent', () => {
    const value = candidate();
    value.consistencyReports[0].status = 'fail';
    value.consistencyReports[0].checks[0].status = 'fail';
    value.consistencyReports[0].blockingReasons = ['Missing end card.'];
    expect(validateCreatorTasteWorkflowCandidate(value, 'project.one')).toContain(
      'evaluationReady does not match the conjunctive target-spec consistency gate.',
    );
  });
});
