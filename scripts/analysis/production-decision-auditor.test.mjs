import { describe, expect, it } from 'vitest';
import { auditProductionDecisions } from './production-decision-auditor.mjs';

const overlay = (id, text, startFrame, box) => ({
  id,
  kind: 'text',
  timelineRange: { startFrame, endFrameExclusive: startFrame + 15 },
  text,
  templateId: 'text.creator-commentary',
  box,
  animation: 'pop',
});

describe('production decision auditor', () => {
  it('exposes inferred intent and source-only performance rationale', () => {
    const ledger = auditProductionDecisions({
      styleAudit: {
        summary: {
          candidate: { saturationMean: 55 },
          reference: { saturationMean: 128 },
        },
        referenceOcr: [
          {
            normalizedText: 'shumhomen',
            sampleCount: 10,
            medianBox: { x: 0.75, y: 0.2, width: 0.2, height: 0.03 },
          },
          {
            normalizedText: 'shumhomen',
            sampleCount: 4,
            medianBox: { x: 0.05, y: 0.65, width: 0.2, height: 0.03 },
          },
        ],
      },
      editPlan: {
        frameRate: 30,
        beatGrid: { bpm: 120, offsetMs: 0 },
        tracks: [
          {
            kind: 'overlay',
            clips: [
              overlay('one', 'Open', 0, { x: 0.1, y: 0.1, width: 0.3, height: 0.1 }),
              overlay('two', 'Hit', 15, { x: 0.6, y: 0.4, width: 0.3, height: 0.1 }),
              overlay('three', 'Close', 30, { x: 0.2, y: 0.8, width: 0.4, height: 0.1 }),
            ],
          },
        ],
      },
      rendererManifest: {
        canvas: { width: 720, height: 1280 },
        textPlacements: [],
        overlayTemplates: ['text.creator-commentary'],
        audioDelivery: { limiter: 'ffmpeg-alimiter' },
      },
      embodiedAudit: { status: 'pass', score: 1, maxBodyOverlapRatio: 0.05, overlays: [] },
      audioAudit: {
        analysis: {
          estimatedOffsetMs: 0,
          candidateIntegratedLufs: -9.6,
          referenceIntegratedLufs: -13.9,
          waveformCorrelation: 0.64,
        },
      },
      sourceAnalysis: {
        phrases: [
          {
            selectedTakeAssetId: 'asset.take-a',
            selectionReason: 'Source-only global optimum.',
            candidates: [
              { takeAssetId: 'asset.take-a', totalScore: 0.9 },
              { takeAssetId: 'asset.take-b', totalScore: 0.8 },
            ],
          },
        ],
      },
      id: 'ledger.test',
      productionAuditId: 'audit.test',
      productionId: 'production.test',
      createdAt: '2026-07-16T12:00:00.000Z',
      contentKind: 'dance',
    });

    expect(ledger.overallStatus).toBe('provisional');
    expect(ledger.coverage.find((item) => item.dimension === 'performance')?.status).toBe(
      'provisional',
    );
    expect(ledger.coverage.find((item) => item.dimension === 'attention')?.status).toBe(
      'provisional',
    );
    expect(ledger.decisions.every((item) => item.requiresOwnerReview)).toBe(true);
  });
});
