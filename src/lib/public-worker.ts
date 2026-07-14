import publicReceiptJson from '../../fixtures/media/tutorial-compare-v1/receipt.json';
import publicResultJson from '../../fixtures/media/tutorial-compare-v1/result.json';

export interface PublicWorkerMoment {
  id: string;
  beat: number;
  referenceFrame: number;
  attemptFrame: number;
  form: {
    meanJointAngleErrorDeg: number;
    primaryRegion?: string;
    confidence: number;
  };
  path: { maximumDeviationNormalized: number };
  coaching: { correction: string };
}

export interface PublicWorkerResult {
  status: 'completed' | 'failed';
  artifacts: {
    tutorialComparison: {
      alignment: { attemptOffsetMs: number; confidence: number };
      beatMap: { bpm: number; beats: number[]; evidence: { confidence?: number } };
      criticalMoments: PublicWorkerMoment[];
      summary: {
        strengths: string[];
        primaryCorrection: string;
        secondaryCorrections: string[];
      };
    };
    criticalMomentBursts: Array<{ artifactId: string; momentId: string }>;
  };
  validation: { verdict: 'pass' | 'fail'; checks: Array<{ id: string; verdict: string }> };
}

export interface PublicWorkerReceipt {
  schema: 'nodevideo.worker-receipt.v1';
  boundary: 'public-worker';
  disclosure: string;
  worker: { id: 'nodevideo.tutorial-compare'; version: string; pack: string };
  sourceAssets: Array<{ assetId: string; sha256: string; sourceClass: 'public-fixture' }>;
  result: { path: string; sha256: string; status: 'completed' | 'failed' };
  media: Record<
    'reference' | 'attempt' | 'sideBySide' | 'difference' | 'bursts',
    {
      path: string;
      sha256: string;
      metadata?: {
        format?: { sizeBytes?: number };
        video?: { durationSeconds?: number; codedWidth?: number; codedHeight?: number };
      };
    }
  >;
  events: Array<{
    sequence: number;
    type: string;
    status: string;
    progress: { completed: number; total: number };
    message: string;
    createdAt: string;
    spanId?: string;
    durationMs?: number;
  }>;
  trace: {
    spans: Array<{
      id: string;
      name: string;
      stage: string;
      status: 'ok' | 'error';
      startedAt: string;
      endedAt?: string;
      durationMs?: number;
      attributes: Record<string, unknown>;
    }>;
  };
  validation: {
    passed: boolean;
    assertions: Array<{ name: string; pass: boolean }>;
    metrics: { alignmentOffsetMs: number; criticalMomentCount: number; burstCount: number };
  };
  startedAt: string;
  endedAt: string;
  durationMs: number;
}

export const PUBLIC_WORKER_RESULT = publicResultJson as PublicWorkerResult;
export const PUBLIC_WORKER_RECEIPT = publicReceiptJson as PublicWorkerReceipt;

export const PUBLIC_WORKER_URLS = {
  reference: new URL(
    '../../fixtures/media/tutorial-compare-v1/reference-normalized.mp4',
    import.meta.url,
  ).href,
  attempt: new URL(
    '../../fixtures/media/tutorial-compare-v1/attempt-normalized.mp4',
    import.meta.url,
  ).href,
  comparison: new URL(
    '../../fixtures/media/tutorial-compare-v1/comparison-side-by-side.mp4',
    import.meta.url,
  ).href,
  difference: new URL(
    '../../fixtures/media/tutorial-compare-v1/comparison-difference.mp4',
    import.meta.url,
  ).href,
  bursts: new URL('../../fixtures/media/tutorial-compare-v1/critical-moments.jpg', import.meta.url)
    .href,
  result: new URL('../../fixtures/media/tutorial-compare-v1/result.json', import.meta.url).href,
  receipt: new URL('../../fixtures/media/tutorial-compare-v1/receipt.json', import.meta.url).href,
} as const;

export interface PublicWorkerVerification {
  verified: true;
  mediaSha256: string;
  receipt: PublicWorkerReceipt;
  result: PublicWorkerResult;
}

let verificationPromise: Promise<PublicWorkerVerification> | undefined;

export function verifyPublicWorkerBundle(): Promise<PublicWorkerVerification> {
  verificationPromise ??= verifyPublicWorkerBundleUncached();
  return verificationPromise;
}

async function verifyPublicWorkerBundleUncached(): Promise<PublicWorkerVerification> {
  const [receiptResponse, resultResponse, mediaResponse] = await Promise.all([
    fetch(PUBLIC_WORKER_URLS.receipt, { credentials: 'same-origin' }),
    fetch(PUBLIC_WORKER_URLS.result, { credentials: 'same-origin' }),
    fetch(PUBLIC_WORKER_URLS.comparison, { credentials: 'same-origin' }),
  ]);
  if (!receiptResponse.ok || !resultResponse.ok || !mediaResponse.ok) {
    throw new Error('The public worker bundle could not be fetched from this deployment.');
  }
  const receipt = (await receiptResponse.json()) as PublicWorkerReceipt;
  const result = (await resultResponse.json()) as PublicWorkerResult;
  const mediaSha256 = await sha256Hex(await mediaResponse.arrayBuffer());
  const eventsMonotonic = receipt.events.every(
    (event, index) => index === 0 || event.sequence > receipt.events[index - 1].sequence,
  );
  if (
    receipt.schema !== 'nodevideo.worker-receipt.v1' ||
    receipt.boundary !== 'public-worker' ||
    receipt.worker.id !== 'nodevideo.tutorial-compare' ||
    receipt.validation.passed !== true ||
    result.status !== 'completed' ||
    result.validation.verdict !== 'pass' ||
    result.artifacts.tutorialComparison.criticalMoments.length < 3 ||
    !eventsMonotonic ||
    mediaSha256 !== receipt.media.sideBySide.sha256
  ) {
    throw new Error('The public worker receipt did not match its deployed media and result.');
  }
  return { verified: true, mediaSha256, receipt, result };
}

async function sha256Hex(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
