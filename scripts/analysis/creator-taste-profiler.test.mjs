import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  adaptProductionAudit,
  deriveTargetSpecFromEvidence,
  evaluateTargetSpecConsistency,
  learnCreatorTaste,
} from './creator-taste-profiler.mjs';

function legacyAudit() {
  return {
    schemaVersion: 'nodevideo.private-style-gap-audit.v1',
    durationSeconds: 40,
    sampleCadenceSeconds: 1,
    summary: {
      targetLumaMean: 48,
      targetLumaStd: 47,
      targetSaturationMean: 129,
    },
    sourceAndCutDeltas: [{ timelineStartDeltaFrames: 0 }, { timelineStartDeltaFrames: 1 }],
    overlayPlanDeltas: [
      { id: 'overlay.lyric-1', targetPlanY: 0.05 },
      { id: 'overlay.lyric-2', targetPlanY: 0.79 },
    ],
    targetOcr: [
      {
        normalizedText: 'How to pose',
        firstSeconds: 0,
        lastSeconds: 1,
        maxConfidence: 0.99,
        medianBox: { x: 0.1, y: 0.05, width: 0.5, height: 0.08 },
      },
      {
        normalizedText: '@creator',
        firstSeconds: 1,
        lastSeconds: 35,
        maxConfidence: 0.95,
        medianBox: { x: 0.7, y: 0.4, width: 0.2, height: 0.04 },
      },
      {
        normalizedText: 'Thanks for watching',
        firstSeconds: 32,
        lastSeconds: 39,
        maxConfidence: 0.99,
        medianBox: { x: 0.2, y: 0.75, width: 0.6, height: 0.08 },
      },
    ],
  };
}

describe('creator taste profiler', () => {
  it('adapts the deep style-gap audit and refuses its lossy lyric-only target spec', () => {
    const audit = adaptProductionAudit(legacyAudit(), {
      id: 'production.reference',
      createdAt: '2026-07-16T12:00:00.000Z',
      contentKind: 'tutorial',
    });
    expect(audit.observations.textCues.map((cue) => cue.role)).toEqual([
      'hook',
      'identity',
      'end-card',
    ]);
    const consistency = evaluateTargetSpecConsistency(audit);
    expect(consistency.status).toBe('fail');
    expect(consistency.blockingReasons.join(' ')).toMatch(/OCR|roles|branding|end-card|luma/i);
    const profile = learnCreatorTaste([audit], {
      profileId: 'taste.reference',
      learnedAt: '2026-07-16T12:01:00.000Z',
    });
    expect(profile.editorialAttention.endCardRate.value).toBe(1);
    expect(profile.distributionIdentity.persistentIdentityRate.value).toBe(1);
    expect(profile.visualWorld.saturationMean.value).toBe(129);
  });

  it('runs as a repeatable multi-production CLI without media dependencies', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'nodevideo-taste-'));
    const first = path.join(directory, 'first.json');
    const second = path.join(directory, 'second.json');
    const output = path.join(directory, 'taste.json');
    writeFileSync(first, JSON.stringify(legacyAudit()));
    writeFileSync(second, JSON.stringify(legacyAudit()));
    execFileSync(
      process.execPath,
      [
        path.resolve('scripts/analysis/creator-taste-profiler.mjs'),
        '--input',
        first,
        '--input',
        second,
        '--out',
        output,
        '--profile-id',
        'taste.multi-format',
        '--content-kind',
        'other',
      ],
      { cwd: process.cwd(), stdio: 'pipe' },
    );
    const result = JSON.parse(readFileSync(output, 'utf8'));
    expect(result.profile.sourceProductionIds).toHaveLength(2);
    expect(result.consistencyReports.every((report) => report.status === 'fail')).toBe(true);
  });

  it('can rebuild a faithful target spec from visible audit evidence', () => {
    const audit = adaptProductionAudit(legacyAudit(), {
      id: 'production.reinterpreted',
      createdAt: '2026-07-16T12:00:00.000Z',
      contentKind: 'tutorial',
    });
    audit.claimedTargetSpec = deriveTargetSpecFromEvidence(audit);
    expect(evaluateTargetSpecConsistency(audit)).toMatchObject({ status: 'pass', score: 1 });
  });
});
