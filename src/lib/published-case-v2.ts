export const V2_CASE_VIEW_IDS = [
  'corrected',
  'target',
  'side-by-side',
  'source-a',
  'source-b',
] as const;

export const V2_REQUIRED_ARTIFACT_IDS = [
  'edit-understanding',
  'edit-plan',
  'otio',
  'event-score-report',
  'critic-report',
] as const;

export type V2CaseViewId = (typeof V2_CASE_VIEW_IDS)[number];
export type V2RequiredArtifactId = (typeof V2_REQUIRED_ARTIFACT_IDS)[number];

export interface PublishedCaseV2Descriptor {
  id: 'authorized-real-v2';
  title: string;
  manifestUrl: string;
  /** Trusted at build/deploy time. Never read this value from the manifest itself. */
  manifestSha256: string;
}

export interface PublishedCaseV2View {
  id: V2CaseViewId;
  label: string;
  url: string;
  sha256: string;
  mimeType: 'video/mp4';
  ratio: number;
}

export interface PublishedCaseV2Artifact {
  id: V2RequiredArtifactId | string;
  label: string;
  url: string;
  sha256: string;
  mimeType: string;
}

export interface PublishedCaseV2PictureClip {
  id: string;
  label: string;
  outputStartSeconds: number;
  outputEndSeconds: number;
  sourceLabel: string;
  sourceStartSeconds?: number;
  sourceEndSeconds?: number;
  framing: 'fit' | 'fill' | 'black' | 'freeze';
  passed: boolean;
}

export interface PublishedCaseV2Manifest {
  schemaVersion: 'nodevideo.published-case.v2';
  id: 'authorized-real-v2';
  title: string;
  claimBoundary: {
    proven: string[];
    demonstratedBy: string[];
    notClaimed: string[];
  };
  verdict: {
    status: 'passed' | 'blocked';
    summary: string;
    releaseBlockers: string[];
  };
  eventSummary: {
    passedEventCount: number;
    totalEventCount: number;
    picture: string;
    framing: string;
    grade: string;
  };
  permanentWindow: {
    startSeconds: 16.067;
    endSeconds: 19.633;
    expectedSourceLabel: string;
    expectedSourceStartSeconds: number;
    expectedSourceEndSeconds: number;
    passed: boolean;
    summary: string;
  };
  soundtrack: {
    title: string;
    artist: string;
    outputStartSeconds: number;
    outputEndSeconds: number;
    referenceOffsetSeconds: number;
    gainDb: number;
    sourceAudioMuted: boolean;
    beatMappingPassed: boolean;
    licenseBoundary: string;
    summary: string;
  };
  textSummary: {
    cueCount: number;
    passed: boolean;
    summary: string;
  };
  pictureClips: PublishedCaseV2PictureClip[];
  views: PublishedCaseV2View[];
  artifacts: PublishedCaseV2Artifact[];
  receiptUrl: string;
  receiptSha256: string;
  v1AdjudicationUrl: string;
}

export interface PublishedCaseV2IntegrityCheck {
  id: string;
  label: string;
  url: string;
  sha256: string;
}

export interface LoadedPublishedCaseV2 {
  descriptor: PublishedCaseV2Descriptor;
  manifest: PublishedCaseV2Manifest;
  integrity: {
    verified: true;
    manifestSha256: string;
    verifiedAssetCount: number;
    checks: PublishedCaseV2IntegrityCheck[];
  };
  releasePassed: boolean;
}

const manifestSha256 = import.meta.env.VITE_NODEVIDEO_V2_MANIFEST_SHA256 ?? '';

/**
 * The digest is intentionally deployment-owned. Until it is configured, V2 fails closed instead
 * of presenting unverified media or a hard-coded pass claim.
 */
export const PUBLISHED_REAL_CASE_V2: PublishedCaseV2Descriptor = {
  id: 'authorized-real-v2',
  title: 'Authorized audiovisual reconstruction',
  manifestUrl: '/media/authorized-real-v2/manifest.json',
  manifestSha256,
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function loadPublishedCaseV2(
  descriptor: PublishedCaseV2Descriptor = PUBLISHED_REAL_CASE_V2,
  fetcher: Fetcher = fetch,
): Promise<LoadedPublishedCaseV2> {
  if (!isSha256(descriptor.manifestSha256)) {
    throw new Error('The trusted V2 manifest digest is not configured for this deployment.');
  }
  assertPublicUrl(descriptor.manifestUrl, 'V2 manifest');

  const manifestBytes = await fetchBytes(descriptor.manifestUrl, 'V2 manifest', fetcher);
  const actualManifestSha256 = await sha256Hex(manifestBytes);
  if (actualManifestSha256 !== descriptor.manifestSha256) {
    throw new Error('The V2 manifest failed trusted SHA-256 verification.');
  }

  const manifest = decodeJson<PublishedCaseV2Manifest>(manifestBytes, 'V2 manifest');
  assertManifestContract(descriptor, manifest);

  const declaredAssets: PublishedCaseV2IntegrityCheck[] = [
    ...manifest.views.map(({ id, label, sha256, url }) => ({
      id: `view:${id}`,
      label,
      sha256,
      url,
    })),
    ...manifest.artifacts.map(({ id, label, sha256, url }) => ({
      id: `artifact:${id}`,
      label,
      sha256,
      url,
    })),
    {
      id: 'artifact:receipt',
      label: 'Receipt',
      sha256: manifest.receiptSha256,
      url: manifest.receiptUrl,
    },
  ];

  const checks = await Promise.all(
    declaredAssets.map(async (asset) => {
      const bytes = await fetchBytes(asset.url, asset.label, fetcher);
      const actualSha256 = await sha256Hex(bytes);
      if (actualSha256 !== asset.sha256) {
        throw new Error(`${asset.label} failed SHA-256 verification.`);
      }
      return asset;
    }),
  );

  const releasePassed = computeReleasePassed(manifest);
  return {
    descriptor,
    manifest,
    integrity: {
      verified: true,
      manifestSha256: actualManifestSha256,
      verifiedAssetCount: checks.length,
      checks,
    },
    releasePassed,
  };
}

function computeReleasePassed(manifest: PublishedCaseV2Manifest) {
  return (
    manifest.verdict.status === 'passed' &&
    manifest.verdict.releaseBlockers.length === 0 &&
    manifest.permanentWindow.passed &&
    manifest.soundtrack.sourceAudioMuted &&
    manifest.soundtrack.beatMappingPassed &&
    manifest.textSummary.passed &&
    manifest.pictureClips.every((clip) => clip.passed) &&
    manifest.eventSummary.totalEventCount > 0 &&
    manifest.eventSummary.passedEventCount === manifest.eventSummary.totalEventCount
  );
}

function assertManifestContract(
  descriptor: PublishedCaseV2Descriptor,
  manifest: PublishedCaseV2Manifest,
) {
  const viewIds = manifest.views?.map(({ id }) => id) ?? [];
  const artifactIds = new Set(manifest.artifacts?.map(({ id }) => id) ?? []);
  const allUrls = [
    ...(manifest.views?.map(({ url }) => url) ?? []),
    ...(manifest.artifacts?.map(({ url }) => url) ?? []),
    manifest.receiptUrl,
    manifest.v1AdjudicationUrl,
  ];
  const pictureClips = manifest.pictureClips ?? [];
  const hasCompleteTimeline = pictureClips.every((clip, index) => {
    const prior = pictureClips[index - 1];
    return (
      clip.outputEndSeconds > clip.outputStartSeconds &&
      (index === 0 || Math.abs(clip.outputStartSeconds - prior.outputEndSeconds) < 0.001)
    );
  });

  if (
    manifest.schemaVersion !== 'nodevideo.published-case.v2' ||
    manifest.id !== descriptor.id ||
    manifest.title.length === 0 ||
    !Array.isArray(manifest.claimBoundary?.proven) ||
    manifest.claimBoundary.proven.length === 0 ||
    !Array.isArray(manifest.claimBoundary?.demonstratedBy) ||
    !Array.isArray(manifest.claimBoundary?.notClaimed) ||
    !['passed', 'blocked'].includes(manifest.verdict?.status) ||
    !Array.isArray(manifest.verdict?.releaseBlockers) ||
    !Number.isInteger(manifest.eventSummary?.passedEventCount) ||
    !Number.isInteger(manifest.eventSummary?.totalEventCount) ||
    manifest.eventSummary.passedEventCount < 0 ||
    manifest.eventSummary.passedEventCount > manifest.eventSummary.totalEventCount ||
    manifest.permanentWindow?.startSeconds !== 16.067 ||
    manifest.permanentWindow?.endSeconds !== 19.633 ||
    typeof manifest.permanentWindow?.passed !== 'boolean' ||
    typeof manifest.soundtrack?.sourceAudioMuted !== 'boolean' ||
    typeof manifest.soundtrack?.beatMappingPassed !== 'boolean' ||
    !Number.isInteger(manifest.textSummary?.cueCount) ||
    manifest.textSummary.cueCount < 0 ||
    typeof manifest.textSummary?.passed !== 'boolean' ||
    pictureClips.length < 6 ||
    !hasCompleteTimeline ||
    viewIds.length !== V2_CASE_VIEW_IDS.length ||
    new Set(viewIds).size !== V2_CASE_VIEW_IDS.length ||
    V2_CASE_VIEW_IDS.some((id) => !viewIds.includes(id)) ||
    V2_REQUIRED_ARTIFACT_IDS.some((id) => !artifactIds.has(id)) ||
    !isSha256(manifest.receiptSha256) ||
    manifest.views.some(
      (view) => !isSha256(view.sha256) || view.mimeType !== 'video/mp4' || view.ratio <= 0,
    ) ||
    manifest.artifacts.some(
      (artifact) =>
        !isSha256(artifact.sha256) || artifact.label.length === 0 || artifact.mimeType.length === 0,
    )
  ) {
    throw new Error('The V2 manifest failed its audiovisual proof contract.');
  }

  for (const [index, url] of allUrls.entries()) {
    assertPublicUrl(url, `V2 manifest URL ${index + 1}`);
  }

  if (manifest.verdict.status === 'passed' && !computeReleasePassed(manifest)) {
    throw new Error('The V2 manifest claims pass while one or more release gates are blocked.');
  }
  if (manifest.verdict.status === 'blocked' && manifest.verdict.releaseBlockers.length === 0) {
    throw new Error('The V2 manifest is blocked but does not identify a release blocker.');
  }
}

function assertPublicUrl(url: string, label: string) {
  if (
    typeof url !== 'string' ||
    !url.startsWith('/') ||
    url.startsWith('//') ||
    url.includes('..') ||
    /[\\\r\n]/.test(url)
  ) {
    throw new Error(`${label} must use a same-origin public path.`);
  }
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

async function fetchBytes(url: string, label: string, fetcher: Fetcher): Promise<ArrayBuffer> {
  const response = await fetcher(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Could not load ${label} from this deployment.`);
  return response.arrayBuffer();
}

function decodeJson<T>(bytes: ArrayBuffer, label: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
