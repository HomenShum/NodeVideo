#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  PRODUCTION_DECISION_LEDGER_SCHEMA_VERSION,
  deriveDecisionCoverage,
  deriveDecisionLedgerStatus,
  validateProductionDecisionLedger,
} from '../../src/lib/production-decision-contracts.ts';

const ARTIFACTS = {
  style: 'artifact.production-style-audit',
  plan: 'artifact.edit-plan',
  manifest: 'artifact.renderer-manifest',
  embodied: 'artifact.embodied-overlay-audit',
  audio: 'artifact.audio-production-audit',
};

export function auditProductionDecisions({
  styleAudit,
  editPlan,
  rendererManifest,
  embodiedAudit,
  audioAudit = null,
  id,
  productionAuditId,
  productionId,
  createdAt,
  contentKind = 'dance',
}) {
  const decisions = [];
  const overlays = overlayClips(editPlan);
  const textOverlays = overlays.filter((clip) => clip.kind === 'text');
  const placements = new Map(
    (rendererManifest.textPlacements ?? []).map((placement) => [placement.clipId, placement]),
  );

  if (textOverlays.length > 1) {
    const centers = textOverlays.map((overlay) => {
      const box = placements.get(overlay.id)?.estimatedGlyphBox ?? overlay.box;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
    const travel = centers
      .slice(1)
      .map((center, index) => Math.hypot(center.x - centers[index].x, center.y - centers[index].y));
    const novelty = clamp(mean(travel) / 0.5);
    decisions.push(
      inferredDecision({
        id: 'decision.attention.spatial-sequence',
        dimension: 'attention',
        observation: `${textOverlays.length} text events use ${new Set(textOverlays.map((item) => zone(item.box))).size} vertical zones; mean normalized eye travel is ${round(mean(travel), 3)}.`,
        intentHypothesis:
          'Changing text position may lead the viewer between gesture regions instead of creating a static subtitle rail.',
        causalFunction: 'direct eye travel while preserving the performer as the primary subject',
        evidenceArtifactIds: [ARTIFACTS.plan, ARTIFACTS.manifest, ARTIFACTS.embodied],
        confidence: clamp(0.45 + novelty * 0.35),
        attentionChoreography: {
          target: 'hands',
          action: 'lead-motion',
          eyeTravel: novelty > 0.5 ? 'alternating' : 'diagonal',
          motionRelationship: 'anticipates',
          spatialNovelty: round(novelty, 3),
          saliencyCompetition: round(1 - Number(embodiedAudit.score ?? 0), 3),
        },
      }),
    );
  }

  const bpm = Number(editPlan.beatGrid?.bpm ?? 0);
  const offsetMs = Number(editPlan.beatGrid?.offsetMs ?? 0);
  if (bpm > 0 && textOverlays.length > 2) {
    const beatMs = 60_000 / bpm;
    const deltas = textOverlays.map((overlay) => {
      const startMs = (overlay.timelineRange.startFrame / editPlan.frameRate) * 1_000;
      const nearest = offsetMs + Math.round((startMs - offsetMs) / beatMs) * beatMs;
      return Math.abs(startMs - nearest);
    });
    const withinEighth = deltas.filter((delta) => delta <= beatMs / 8).length / deltas.length;
    decisions.push(
      inferredDecision({
        id: 'decision.rhythm.overlay-onsets',
        dimension: 'rhythm',
        observation: `${Math.round(withinEighth * 100)}% of text onsets fall within one eighth-note of the ${round(bpm, 3)} BPM grid.`,
        intentHypothesis: 'Text punctuation may reinforce musical accents and choreographic hits.',
        causalFunction: 'make editorial events feel caused by the music and movement',
        evidenceArtifactIds: [ARTIFACTS.plan],
        confidence: round(clamp(0.4 + withinEighth * 0.45), 3),
      }),
    );
  }

  if (embodiedAudit.status && overlays.length > 0) {
    decisions.push(
      inferredDecision({
        id: 'decision.composition.embodied-clearance',
        dimension: 'composition',
        observation: `${embodiedAudit.overlays?.length ?? 0} overlays were audited against the rendered pose; maximum allowed body overlap is ${embodiedAudit.maxBodyOverlapRatio}.`,
        intentHypothesis:
          'Whitespace is being used to keep text readable without obscuring the dance.',
        causalFunction: 'preserve body readability while maintaining text hierarchy',
        evidenceArtifactIds: [ARTIFACTS.embodied, ARTIFACTS.manifest],
        confidence: round(clamp(Number(embodiedAudit.score ?? 0) * 0.85), 3),
      }),
    );
  }

  if (rendererManifest.overlayTemplates?.length > 0) {
    const animations = [...new Set(textOverlays.map((item) => item.animation))];
    decisions.push(
      inferredDecision({
        id: 'decision.typography.hierarchy-and-motion',
        dimension: 'typography',
        observation: `${rendererManifest.overlayTemplates.length} overlay templates and ${animations.length} text animation modes (${animations.join(', ')}) are used.`,
        intentHypothesis:
          'Template and motion changes may distinguish title, commentary, and CTA roles.',
        causalFunction: 'signal semantic hierarchy before the viewer reads every word',
        evidenceArtifactIds: [ARTIFACTS.plan, ARTIFACTS.manifest],
        confidence: 0.72,
      }),
    );
  }

  const candidateSaturation = Number(styleAudit.summary?.candidate?.saturationMean);
  const referenceSaturation = Number(styleAudit.summary?.reference?.saturationMean);
  if (Number.isFinite(candidateSaturation) && Number.isFinite(referenceSaturation)) {
    decisions.push(
      inferredDecision({
        id: 'decision.color.saturation-character',
        dimension: 'color',
        observation: `Reference mean saturation is ${round(referenceSaturation, 2)} versus candidate ${round(candidateSaturation, 2)}.`,
        intentHypothesis:
          'The reference may use stronger chroma as an attention and creator-identity device.',
        causalFunction: 'establish emotional energy and visual recognizability',
        evidenceArtifactIds: [ARTIFACTS.style],
        confidence: 0.78,
      }),
    );
  }

  if (audioAudit?.analysis) {
    const audio = audioAudit.analysis;
    decisions.push(
      inferredDecision({
        id: 'decision.audio.master-and-alignment',
        dimension: 'audio',
        observation: `Candidate/reference alignment is ${audio.estimatedOffsetMs} ms; integrated loudness is ${audio.candidateIntegratedLufs} versus ${audio.referenceIntegratedLufs} LUFS.`,
        intentHypothesis:
          'The quieter reference master may preserve platform headroom while retaining the same choreographic music segment.',
        causalFunction: 'preserve beat mapping and platform-appropriate loudness',
        evidenceArtifactIds: [ARTIFACTS.audio, ARTIFACTS.plan],
        confidence: round(clamp(0.55 + Math.max(0, audio.waveformCorrelation) * 0.3), 3),
      }),
    );
  }

  const identityGroups = (styleAudit.referenceOcr ?? []).filter(
    (item) => /shum|home|shu|men/.test(item.normalizedText) && item.sampleCount >= 2,
  );
  if (identityGroups.length > 0) {
    const identityZones = new Set(
      identityGroups.map((item) => `${side(item.medianBox)}-${zone(item.medianBox)}`),
    );
    decisions.push(
      inferredDecision({
        id: 'decision.identity.spatial-phases',
        dimension: 'identity',
        observation: `Reference identity OCR occupies ${identityZones.size} spatial phases (${[...identityZones].join(', ')}).`,
        intentHypothesis:
          'Moving the identity mark may avoid the performer and refresh peripheral attention.',
        causalFunction:
          'retain attribution without allowing persistent branding to become visual wallpaper',
        evidenceArtifactIds: [ARTIFACTS.style, ARTIFACTS.plan],
        confidence: identityZones.size > 1 ? 0.82 : 0.58,
      }),
    );
  }

  if (textOverlays.length > 0) {
    const first = textOverlays[0];
    const last = textOverlays.at(-1);
    decisions.push(
      inferredDecision({
        id: 'decision.narrative.open-develop-close',
        dimension: 'narrative',
        observation: `The sequence opens with “${first.text}”, develops through ${Math.max(0, textOverlays.length - 2)} commentary events, and closes with “${last.text}”.`,
        intentHypothesis:
          'The text sequence may frame the practice, reward movement moments, and close with a social CTA.',
        causalFunction: 'turn a dance recording into a beginning-middle-end viewer experience',
        evidenceArtifactIds: [ARTIFACTS.plan],
        confidence: 0.7,
      }),
    );
  }

  if (rendererManifest.canvas && rendererManifest.audioDelivery) {
    decisions.push(
      inferredDecision({
        id: 'decision.platform.vertical-social-delivery',
        dimension: 'platform',
        observation: `${rendererManifest.canvas.width}x${rendererManifest.canvas.height} delivery includes a limiter, persistent identity, and end-card assets.`,
        intentHypothesis:
          'The production is shaped for vertical social viewing and downstream Instagram music/licensing handoff.',
        causalFunction: 'make the edit immediately usable in the creator publishing workflow',
        evidenceArtifactIds: [ARTIFACTS.manifest, ARTIFACTS.plan],
        confidence: 0.88,
      }),
    );
  }

  const coverage = deriveDecisionCoverage(decisions);
  const ledger = {
    schemaVersion: PRODUCTION_DECISION_LEDGER_SCHEMA_VERSION,
    id,
    productionAuditId,
    createdAt,
    contentKind,
    sourceProductionIds: [productionId],
    decisions,
    coverage,
    overallStatus: deriveDecisionLedgerStatus(coverage),
    score: Math.min(...coverage.map((item) => item.score)),
    cautions: [
      'Intent hypotheses are not creator facts until owner-confirmed.',
      'A single production can produce profile candidates but cannot produce reusable creator rules.',
      'Target-calibrated evidence measures reconstruction fidelity, not blind source-only creative selection.',
    ],
  };
  validateProductionDecisionLedger(ledger);
  return ledger;
}

function inferredDecision({
  id,
  dimension,
  observation,
  intentHypothesis,
  causalFunction,
  evidenceArtifactIds,
  confidence,
  attentionChoreography = null,
}) {
  return {
    id,
    dimension,
    timelineRange: null,
    observation,
    intentHypothesis,
    causalFunction,
    evidenceArtifactIds,
    alternativesRejected: [],
    confidence,
    evidenceStatus: 'inferred',
    generalizability: 'case-only',
    supportProductions: 1,
    requiresOwnerReview: true,
    attentionChoreography,
  };
}

function overlayClips(editPlan) {
  return (editPlan.tracks ?? [])
    .filter((track) => track.kind === 'overlay')
    .flatMap((track) => track.clips);
}

function zone(box) {
  const center = box.y + box.height / 2;
  return center < 1 / 3 ? 'top' : center < 2 / 3 ? 'middle' : 'bottom';
}

function side(box) {
  const center = box.x + box.width / 2;
  return center < 1 / 3 ? 'left' : center < 2 / 3 ? 'center' : 'right';
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value) {
  return Math.min(1, Math.max(0, value));
}

function round(value, digits) {
  return Number(value.toFixed(digits));
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--') || index + 1 >= argv.length)
      throw new Error(`Invalid argument: ${key}`);
    options[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  for (const key of [
    'style-audit',
    'edit-plan',
    'renderer-manifest',
    'embodied-layout',
    'out',
    'ledger-id',
    'production-audit-id',
    'production-id',
  ]) {
    if (!options[key]) throw new Error(`--${key} is required.`);
  }
  return options;
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const ledger = auditProductionDecisions({
    styleAudit: readJson(options['style-audit']),
    editPlan: readJson(options['edit-plan']),
    rendererManifest: readJson(options['renderer-manifest']),
    embodiedAudit: readJson(options['embodied-layout']),
    audioAudit: options['audio-audit'] ? readJson(options['audio-audit']) : null,
    id: options['ledger-id'],
    productionAuditId: options['production-audit-id'],
    productionId: options['production-id'],
    createdAt: options['created-at'] ?? new Date().toISOString(),
    contentKind: options['content-kind'] ?? 'dance',
  });
  writeFileSync(resolve(options.out), `${JSON.stringify(ledger, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ out: resolve(options.out), status: ledger.overallStatus, score: ledger.score, coverage: ledger.coverage.map(({ dimension, status }) => ({ dimension, status })) })}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
