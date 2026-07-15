export const REAL_CASE_VIEW_IDS = [
  'target',
  'reconstruction',
  'side-by-side',
  'difference',
  'source-a',
  'source-b',
] as const;

export type RealCaseViewId = (typeof REAL_CASE_VIEW_IDS)[number];

export interface PublishedCaseView {
  id: RealCaseViewId;
  label: string;
  path: string;
  url: string;
  sha256: string;
  mimeType: 'video/mp4';
}

export interface PublishedCaseManifest {
  schema: 'nodevideo.published-case.v1';
  id: 'authorized-real-v1';
  title: string;
  sourceClass: 'owner-authorized-public-real-media';
  authorization: {
    status: 'owner-authorized-publication';
    sourceContainerMetadataPublished: false;
  };
  targetUsage: 'analysis-and-evaluation-only';
  claimTier: 'perceptually-close-video' | 'structure-matched';
  metrics: {
    ssim: number;
    psnrDb: number;
    vmaf: number;
    metricScope: string;
    targetAudioMatched: false;
    sourceAudioMode: string;
  };
  views: Array<Omit<PublishedCaseView, 'url'>>;
  posterPath: string;
  receiptPath: string;
  resultPath: string;
  limitations: string[];
}

export interface PublishedCaseResult {
  schema: 'nodevideo.reference-reconstruct-result.v1';
  caseId: 'authorized-real-v1';
  status: 'completed';
  automationLevel: 'case-specific-target-guided';
  disclosure: string;
  targetUsage: 'analysis-and-evaluation-only';
  cutFrames: number[];
  renderSourceAssetIds: string[];
  evaluationSourceAssetIds: string[];
  evaluation: PublishedCaseManifest['metrics'];
  validation: {
    passed: boolean;
    claimTier: PublishedCaseManifest['claimTier'];
  };
  limitations: string[];
}

export interface PublishedCaseReceipt {
  schema: string;
  result: { path: string; sha256: string };
  artifacts: Record<string, { path: string; sha256: string; mimeType?: string }>;
  lineage: {
    renderInputAssetIds: string[];
    evaluationInputAssetIds: string[];
    targetUsage: 'analysis-and-evaluation-only';
    audio: { targetMatched: false; targetCopied: false; output: string };
  };
  validation: { passed: boolean };
  startedAt: string;
  trace: {
    spans: Array<{
      id: string;
      name: string;
      status: 'ok' | 'error';
      durationMs: number;
    }>;
  };
}

export interface PublishedCaseDescriptor {
  id: 'authorized-real-v1';
  title: string;
  baseUrl: string;
  manifestUrl: string;
  resultUrl: string;
  receiptUrl: string;
  adjudicationUrl: string;
  adjudicationSha256: string;
  posterUrl: string;
  viewUrls: Record<RealCaseViewId, string>;
}

export interface LoadedPublishedCase {
  descriptor: PublishedCaseDescriptor;
  manifest: PublishedCaseManifest;
  result: PublishedCaseResult;
  receipt: PublishedCaseReceipt;
  adjudication: PublishedCaseAdjudication;
  views: PublishedCaseView[];
  integrity: {
    verified: true;
    verifiedAssetCount: number;
    posterSha256: string;
    resultSha256: string;
    adjudicationSha256: string;
  };
  traceSpans: NodeVideoSpan[];
}

export interface PublishedCaseAdjudication {
  schema: 'nodevideo.case-adjudication.v2';
  caseId: 'authorized-real-v1';
  status: 'invalidated';
  historicalClaimTier: 'perceptually-close-video';
  currentVerdict: 'failed-audiovisual-reconstruction';
  summary: string;
  findings: Array<{ id: string; severity: 'release-blocking' }>;
  releasePolicy: {
    mayClaimPass: false;
    permanentRegressionRange: { startFrame: 482; endFrameExclusive: 589 };
    requireAudioEvaluation: true;
    requireTimedOverlayEvaluation: true;
    requireWorstWindowGate: true;
  };
}

const baseUrl = '/media/authorized-real-v1';
const at = (path: string) => `${baseUrl}/${path}`;

export const PUBLISHED_REAL_CASE: PublishedCaseDescriptor = {
  id: 'authorized-real-v1',
  title: 'Two MOVs reconstructed against the final edit',
  baseUrl,
  manifestUrl: at('case-manifest.json'),
  resultUrl: at('result.json'),
  receiptUrl: at('receipt.json'),
  adjudicationUrl: at('adjudication-v2.json'),
  adjudicationSha256: '16f2e29c6d5b77bdfec072429d54f6256ee8f60b632f0b480d1df61b8705ce2e',
  posterUrl: at('comparison-poster.jpg'),
  viewUrls: {
    target: at('target-web.mp4'),
    reconstruction: at('reconstruction.mp4'),
    'side-by-side': at('comparison-side-by-side.mp4'),
    difference: at('comparison-difference.mp4'),
    'source-a': at('source-a-web.mp4'),
    'source-b': at('source-b-web.mp4'),
  },
};

export const PUBLISHED_CASES = { [PUBLISHED_REAL_CASE.id]: PUBLISHED_REAL_CASE } as const;

export const REAL_CASE_VIEW_PRESENTATION: Record<
  RealCaseViewId,
  { ratio: number; width: 'max-w-sm' | 'max-w-3xl' }
> = {
  target: { ratio: 9 / 16, width: 'max-w-sm' },
  reconstruction: { ratio: 9 / 16, width: 'max-w-sm' },
  'side-by-side': { ratio: 9 / 8, width: 'max-w-3xl' },
  difference: { ratio: 9 / 16, width: 'max-w-sm' },
  'source-a': { ratio: 16 / 9, width: 'max-w-3xl' },
  'source-b': { ratio: 16 / 9, width: 'max-w-3xl' },
};

export const REAL_CASE_VIEW_LABELS: Record<RealCaseViewId, string> = {
  target: 'Target',
  reconstruction: 'Reconstruction',
  'side-by-side': 'Side-by-side',
  difference: 'Difference',
  'source-a': 'Source A',
  'source-b': 'Source B',
};

export const REAL_CASE_COPY = {
  subtitle:
    'Two MOV sources were cut, reframed, graded, and rendered against the final MP4 target.',
  invalidated:
    'V1 is retained as failure evidence, not a successful reconstruction. It omitted the soundtrack and most timed text, and its 16.067–19.633 second source mapping is 76 frames late. Aggregate padded-frame scores masked that error.',
  consent:
    'Owner-authorized publication. Public files are metadata-stripped derivatives; original container metadata is not published.',
  targetUsage:
    'The final MP4 is analysis-and-evaluation-only in this historical V1 run. Its soundtrack was excluded, so V1 could not test music identification, beat mapping, or audiovisual fidelity.',
  replay:
    'Vercel serves a hash-verified replay of the historical worker run. Integrity proves which bytes ran; it does not make the invalidated quality claim correct.',
} as const;

export const REAL_CASE_TOOL_STATES = {
  idle: 'input-streaming',
  loading: 'input-available',
  ready: 'output-available',
  error: 'output-error',
} as const;

export async function loadPublishedCase(
  descriptor: PublishedCaseDescriptor = PUBLISHED_REAL_CASE,
): Promise<LoadedPublishedCase> {
  const [manifestBytes, resultBytes, receiptBytes, adjudicationBytes] = await Promise.all([
    fetchBytes(descriptor.manifestUrl, 'case manifest'),
    fetchBytes(descriptor.resultUrl, 'worker result'),
    fetchBytes(descriptor.receiptUrl, 'worker receipt'),
    fetchBytes(descriptor.adjudicationUrl, 'case adjudication'),
  ]);
  const manifest = decodeJson<PublishedCaseManifest>(manifestBytes);
  const result = decodeJson<PublishedCaseResult>(resultBytes);
  const receipt = decodeJson<PublishedCaseReceipt>(receiptBytes);
  const adjudication = decodeJson<PublishedCaseAdjudication>(adjudicationBytes);
  assertCaseContract(descriptor, manifest, result, receipt);
  assertAdjudication(descriptor, adjudication);
  const adjudicationSha256 = await sha256Hex(adjudicationBytes);
  if (adjudicationSha256 !== descriptor.adjudicationSha256) {
    throw new Error('The case adjudication failed SHA-256 verification.');
  }

  const views = REAL_CASE_VIEW_IDS.map((id) => {
    const view = manifest.views.find((candidate) => candidate.id === id);
    if (!view || descriptor.viewUrls[id] !== at(view.path)) {
      throw new Error(`Published view ${id} does not match the case manifest.`);
    }
    return { ...view, url: descriptor.viewUrls[id] };
  });
  const receiptArtifacts = Object.values(receipt.artifacts);
  const verifiedAssets = await Promise.all(
    views.map(async (view) => {
      const artifact = receiptArtifacts.find((candidate) => candidate.path === view.path);
      if (!artifact || artifact.sha256 !== view.sha256) {
        throw new Error(`${view.label} does not match the worker receipt.`);
      }
      const actualHash = await sha256Hex(await fetchBytes(view.url, view.label));
      if (actualHash !== view.sha256) throw new Error(`${view.label} failed SHA-256 verification.`);
      return actualHash;
    }),
  );
  const posterArtifact = receiptArtifacts.find(
    (candidate) => candidate.path === manifest.posterPath,
  );
  const posterSha256 = await sha256Hex(await fetchBytes(descriptor.posterUrl, 'comparison poster'));
  if (!posterArtifact || posterSha256 !== posterArtifact.sha256) {
    throw new Error('The comparison poster failed SHA-256 verification.');
  }
  const resultSha256 = await sha256Hex(resultBytes);
  if (resultSha256 !== receipt.result.sha256) {
    throw new Error('The deployed worker result does not match its receipt.');
  }
  return {
    descriptor,
    manifest,
    result,
    receipt,
    adjudication,
    views,
    integrity: {
      verified: true,
      verifiedAssetCount: verifiedAssets.length,
      posterSha256,
      resultSha256,
      adjudicationSha256,
    },
    traceSpans: toTraceSpans(receipt),
  };
}

function assertAdjudication(
  descriptor: PublishedCaseDescriptor,
  adjudication: PublishedCaseAdjudication,
) {
  if (
    adjudication.schema !== 'nodevideo.case-adjudication.v2' ||
    adjudication.caseId !== descriptor.id ||
    adjudication.status !== 'invalidated' ||
    adjudication.currentVerdict !== 'failed-audiovisual-reconstruction' ||
    adjudication.releasePolicy?.mayClaimPass !== false ||
    adjudication.releasePolicy?.permanentRegressionRange?.startFrame !== 482 ||
    adjudication.releasePolicy?.permanentRegressionRange?.endFrameExclusive !== 589 ||
    adjudication.findings?.length < 4
  ) {
    throw new Error('The published case is missing its release-blocking V2 adjudication.');
  }
}

function assertCaseContract(
  descriptor: PublishedCaseDescriptor,
  manifest: PublishedCaseManifest,
  result: PublishedCaseResult,
  receipt: PublishedCaseReceipt,
) {
  const renderSources = new Set(receipt.lineage?.renderInputAssetIds ?? []);
  const metricsAgree =
    manifest.metrics.ssim === result.evaluation.ssim &&
    manifest.metrics.psnrDb === result.evaluation.psnrDb &&
    manifest.metrics.vmaf === result.evaluation.vmaf;
  const viewPaths = manifest.views.map((view) => view.path);
  if (
    manifest.schema !== 'nodevideo.published-case.v1' ||
    manifest.id !== descriptor.id ||
    result.caseId !== descriptor.id ||
    result.status !== 'completed' ||
    manifest.authorization.status !== 'owner-authorized-publication' ||
    manifest.authorization.sourceContainerMetadataPublished !== false ||
    manifest.targetUsage !== 'analysis-and-evaluation-only' ||
    receipt.lineage?.targetUsage !== 'analysis-and-evaluation-only' ||
    result.targetUsage !== 'analysis-and-evaluation-only' ||
    renderSources.has('asset.target-edit') ||
    !renderSources.has('asset.source-a-original') ||
    !renderSources.has('asset.source-b-original') ||
    receipt.lineage?.audio?.targetCopied !== false ||
    receipt.lineage?.audio?.targetMatched !== false ||
    manifest.metrics.targetAudioMatched !== false ||
    result.validation?.claimTier !== manifest.claimTier ||
    manifest.views.length !== REAL_CASE_VIEW_IDS.length ||
    new Set(viewPaths).size !== REAL_CASE_VIEW_IDS.length ||
    result.cutFrames.join(',') !== '201,482,589,753' ||
    result.validation?.passed !== true ||
    receipt.validation?.passed !== true ||
    !metricsAgree
  ) {
    throw new Error('The published case failed its authorization, lineage, or metric contract.');
  }
}

const TRACE_STAGE: Record<string, NodeVideoStageKind> = {
  'probe-inputs': 'ingest',
  'sanitize-release-media': 'normalize',
  'render-reconstruction': 'render',
  'render-web-sources': 'render',
  'render-target-proxy': 'render',
  'render-comparisons': 'render',
  'evaluate-reconstruction': 'diffs',
};

function toTraceSpans(receipt: PublishedCaseReceipt): NodeVideoSpan[] {
  let cursor = Date.parse(receipt.startedAt);
  return receipt.trace.spans.map((span) => {
    const startedAt = new Date(cursor).toISOString();
    cursor += span.durationMs;
    return {
      id: span.id,
      traceId: 'trace.authorized-real-v1',
      name: span.name,
      stageKind: TRACE_STAGE[span.id] ?? 'summary',
      status: span.status,
      startedAt,
      endedAt: new Date(cursor).toISOString(),
      attributes: { durationMs: span.durationMs },
      artifactIds: [],
    };
  });
}

async function fetchBytes(url: string, label: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Could not load ${label} from this deployment.`);
  return response.arrayBuffer();
}

function decodeJson<T>(bytes: ArrayBuffer): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
import type { NodeVideoSpan, NodeVideoStageKind } from '@/lib/contracts';
