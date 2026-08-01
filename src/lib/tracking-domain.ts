import catalog from '../../config/tracking-domain-packs.json';

export const TRACKING_DOMAIN_SCHEMA = 'nodevideo.tracking-domain.v1' as const;
export const TRACKING_ATLAS_RECEIPT_SCHEMA = 'nodevideo.tracking-atlas-receipt.v1' as const;

export type TrackingDomain = 'group' | 'object' | 'animal' | 'sport';
export type TrackingValidationTier =
  | 'contract'
  | 'rights-cleared-fixture'
  | 'held-out'
  | 'creator-reviewed';

export type TrackingDomainPack = {
  id: string;
  title: string;
  domain: TrackingDomain;
  description: string;
  targets: string[];
  detectors: string[];
  policy: string;
  fixture: string;
  startSeconds: number;
  durationSeconds: number;
  seedLabel?: string;
  seedBox?: [number, number, number, number];
  sourceUrl: string;
  sourceTitle: string;
};

export type DetectionObservation = {
  timelineFrame: number;
  label: string;
  confidence: number;
  box: { x: number; y: number; width: number; height: number };
  trackId?: string;
};

export type ActionEnvelope = {
  timelineFrame: number;
  box: { x: number; y: number; width: number; height: number };
  sourceLabels: string[];
  confidence: number;
  fallback: 'none' | 'hold' | 'wide';
};

export type TrackingAtlasReceipt = {
  schemaVersion: typeof TRACKING_ATLAS_RECEIPT_SCHEMA;
  id: string;
  packId: string;
  source: {
    videoId: string;
    url: string;
    title: string;
    uploader: string;
    license: string;
    sourceSha256: string;
    retrievedAt: string;
  };
  execution: {
    detector: string;
    tracker: string;
    policy: string;
    frameCount: number;
    analyzedFrames: number;
    latencyMs: number;
    costUsd: number;
  };
  evaluation: {
    tier: TrackingValidationTier;
    detectionCoverage: number;
    targetCoverage: number;
    lowConfidenceHoldRate: number;
    trackSwitchCount: number;
    manualCorrections: number;
    previewExportParity: boolean;
    verdict: 'pass' | 'review' | 'fail';
    limitations: string[];
  };
  outputs: {
    beforeImage: string;
    afterImage: string;
    comparisonVideo: string;
    analysisVideo: string;
    receipt: string;
    sha256: Record<'beforeImage' | 'afterImage' | 'comparisonVideo' | 'analysisVideo', string>;
  };
};

export const TRACKING_DOMAIN_PACKS = catalog.packs as TrackingDomainPack[];

export function getTrackingDomainPack(id: string): TrackingDomainPack {
  const pack = TRACKING_DOMAIN_PACKS.find((candidate) => candidate.id === id);
  if (!pack) throw new Error(`Unknown tracking domain pack: ${id}`);
  return pack;
}

export function selectTrackingDomainPack(input: {
  domain: TrackingDomain;
  labels?: string[];
  requestedPolicy?: string;
}): TrackingDomainPack {
  const labels = new Set((input.labels ?? []).map((label) => label.toLowerCase()));
  const candidates = TRACKING_DOMAIN_PACKS.filter((pack) => pack.domain === input.domain);
  const selected = candidates
    .map((pack) => ({
      pack,
      score:
        (input.requestedPolicy === pack.policy ? 10 : 0) +
        pack.targets.filter((target) => labels.has(target.toLowerCase())).length,
    }))
    .sort(
      (left, right) => right.score - left.score || left.pack.id.localeCompare(right.pack.id),
    )[0]?.pack;
  if (!selected) throw new Error(`No tracking pack supports domain ${input.domain}.`);
  return selected;
}

export function validateTrackingAtlasReceipt(receipt: TrackingAtlasReceipt) {
  if (receipt.schemaVersion !== TRACKING_ATLAS_RECEIPT_SCHEMA) {
    throw new Error('Tracking atlas receipt schema is unsupported.');
  }
  getTrackingDomainPack(receipt.packId);
  if (receipt.source.license !== 'Creative Commons Attribution license (reuse allowed)') {
    throw new Error(`${receipt.id} does not carry the required reusable source license.`);
  }
  if (!/^sha256:[a-f\d]{64}$/u.test(receipt.source.sourceSha256)) {
    throw new Error(`${receipt.id} source hash is invalid.`);
  }
  for (const [name, value] of Object.entries({
    detectionCoverage: receipt.evaluation.detectionCoverage,
    targetCoverage: receipt.evaluation.targetCoverage,
    lowConfidenceHoldRate: receipt.evaluation.lowConfidenceHoldRate,
  })) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${receipt.id} ${name} must be between zero and one.`);
    }
  }
  if (receipt.evaluation.verdict === 'pass' && receipt.evaluation.targetCoverage < 0.8) {
    throw new Error(`${receipt.id} cannot pass below the target coverage floor.`);
  }
  for (const [name, hash] of Object.entries(receipt.outputs.sha256)) {
    if (!/^sha256:[a-f\d]{64}$/u.test(hash)) {
      throw new Error(`${receipt.id} ${name} output hash is invalid.`);
    }
  }
  return receipt;
}

export function summarizeTrackingCoverage(receipts: TrackingAtlasReceipt[]) {
  const valid = receipts.map(validateTrackingAtlasReceipt);
  const passed = valid.filter((receipt) => receipt.evaluation.verdict === 'pass');
  return {
    total: valid.length,
    passed: passed.length,
    review: valid.filter((receipt) => receipt.evaluation.verdict === 'review').length,
    failed: valid.filter((receipt) => receipt.evaluation.verdict === 'fail').length,
    meanTargetCoverage:
      valid.reduce((sum, receipt) => sum + receipt.evaluation.targetCoverage, 0) /
      Math.max(1, valid.length),
    domains: new Set(valid.map((receipt) => getTrackingDomainPack(receipt.packId).domain)).size,
  };
}
