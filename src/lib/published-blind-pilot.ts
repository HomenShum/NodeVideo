export const BLIND_PILOT_ARTIFACT_IDS = [
  'edit-plan',
  'music-handoff',
  'rationale',
  'read-log',
  'freeze',
  'held-out-evaluation',
  'held-out-comparison',
  'redaction-receipt',
] as const;

const BLIND_PILOT_ARTIFACT_FILES = {
  'edit-plan': 'edit-plan.json',
  'music-handoff': 'music-handoff.json',
  rationale: 'rationale.md',
  'read-log': 'read-log.json',
  freeze: 'freeze.json',
  'held-out-evaluation': 'held-out-evaluation.json',
  'held-out-comparison': 'held-out-comparison.mp4',
  'redaction-receipt': 'redaction-receipt.json',
} as const;

export interface BlindPilotArtifact {
  id: (typeof BLIND_PILOT_ARTIFACT_IDS)[number];
  label: string;
  mimeType: string;
  sha256: string;
  url: string;
}

export interface BlindPilotMusicAnchor {
  id: string;
  label: string;
  referenceSeconds: number;
  videoSeconds: number;
}

export interface PublishedBlindPilotManifest {
  schemaVersion: 'nodevideo.blind-source-only-pilot.v1';
  id: 'blind-source-only-pilot-01';
  title: string;
  protocol: {
    freshPlannerContext: true;
    frozenAt: string;
    publicCatalogAllowed: true;
    sourceInputSha256: string[];
    targetAccessDuringGeneration: false;
    targetMountedDuringGeneration: false;
  };
  verdict: {
    limitations: string[];
    protocolStatus: 'passed' | 'blocked';
    summary: string;
    tasteStatus: 'awaiting-blinded-human-evaluation' | 'evaluated-blinded';
    tasteEvidenceRef: string | null;
  };
  claimBoundary: {
    notClaimed: string[];
    proven: string[];
  };
  preview: {
    audioPolicy: 'commercial-music-absent';
    durationSeconds: number;
    height: number;
    mimeType: 'video/mp4';
    ratio: number;
    sha256: string;
    url: string;
    width: number;
  };
  musicHandoff: {
    anchors: BlindPilotMusicAnchor[];
    artist: string;
    availabilityStatus: 'confirm-in-instagram';
    commercialAudioPublished: false;
    rationale: string;
    searchQuery: string;
    referenceBasis: 'full-track-timestamp' | 'catalog-preview-relative' | 'audible-cue';
    referenceCue: string;
    referenceDurationSeconds: number;
    referenceEndSeconds: number;
    referenceStartSeconds: number;
    title: string;
  };
  instagramHandoff: {
    steps: string[];
    userAddsAudioInInstagram: true;
  };
  artifacts: BlindPilotArtifact[];
}

export interface PublishedBlindPilotDescriptor {
  id: 'blind-source-only-pilot-01';
  manifestSha256: string;
  manifestUrl: string;
  title: string;
}

export interface LoadedPublishedBlindPilot {
  descriptor: PublishedBlindPilotDescriptor;
  integrity: { manifestSha256: string; verified: true; verifiedAssetCount: number };
  manifest: PublishedBlindPilotManifest;
  protocolPassed: boolean;
}

const manifestSha256 = import.meta.env.VITE_NODEVIDEO_BLIND_MANIFEST_SHA256 ?? '';

export const PUBLISHED_BLIND_PILOT: PublishedBlindPilotDescriptor = {
  id: 'blind-source-only-pilot-01',
  manifestSha256,
  manifestUrl: '/media/blind-source-only-pilot-01/manifest.json',
  title: 'Blind source-only creative pilot',
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function loadPublishedBlindPilot(
  descriptor: PublishedBlindPilotDescriptor = PUBLISHED_BLIND_PILOT,
  fetcher: Fetcher = fetch,
): Promise<LoadedPublishedBlindPilot> {
  if (!isSha256(descriptor.manifestSha256)) {
    throw new Error('The trusted blind-pilot manifest digest is not configured.');
  }
  assertPublicUrl(descriptor.manifestUrl, 'Blind-pilot manifest');
  const manifestBytes = await fetchBytes(descriptor.manifestUrl, 'blind-pilot manifest', fetcher);
  const actualManifestSha256 = await sha256Hex(manifestBytes);
  if (actualManifestSha256 !== descriptor.manifestSha256) {
    throw new Error('The blind-pilot manifest failed trusted SHA-256 verification.');
  }
  const manifest = decodeJson<PublishedBlindPilotManifest>(manifestBytes, 'blind-pilot manifest');
  assertManifestContract(descriptor, manifest);
  const assets = [
    { label: 'Source-only preview', sha256: manifest.preview.sha256, url: manifest.preview.url },
    ...manifest.artifacts,
  ];
  await Promise.all(
    assets.map(async ({ label, sha256, url }) => {
      if ((await sha256Hex(await fetchBytes(url, label, fetcher))) !== sha256) {
        throw new Error(`${label} failed SHA-256 verification.`);
      }
    }),
  );
  return {
    descriptor,
    integrity: {
      manifestSha256: actualManifestSha256,
      verified: true,
      verifiedAssetCount: assets.length,
    },
    manifest,
    protocolPassed: computeProtocolPassed(manifest),
  };
}

function computeProtocolPassed(manifest: PublishedBlindPilotManifest) {
  return (
    manifest.verdict.protocolStatus === 'passed' &&
    manifest.protocol.freshPlannerContext &&
    !manifest.protocol.targetAccessDuringGeneration &&
    !manifest.protocol.targetMountedDuringGeneration &&
    !manifest.musicHandoff.commercialAudioPublished &&
    manifest.preview.audioPolicy === 'commercial-music-absent'
  );
}

function assertManifestContract(
  descriptor: PublishedBlindPilotDescriptor,
  manifest: PublishedBlindPilotManifest,
) {
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  const artifactIds = artifacts.map(({ id }) => id);
  const baseUrl = `/media/${descriptor.id}`;
  const urls = [manifest.preview?.url, ...artifacts.map(({ url }) => url)];
  const anchors = manifest.musicHandoff?.anchors ?? [];
  const anchorsAligned = anchors.every(
    ({ referenceSeconds, videoSeconds }) =>
      videoSeconds >= 0 &&
      videoSeconds <= manifest.preview.durationSeconds + 0.001 &&
      Math.abs(referenceSeconds - manifest.musicHandoff.referenceStartSeconds - videoSeconds) <=
        0.02,
  );
  urls.forEach((url, index) => assertPublicUrl(url, `Blind-pilot asset ${index + 1}`));
  if (
    manifest.schemaVersion !== 'nodevideo.blind-source-only-pilot.v1' ||
    manifest.id !== descriptor.id ||
    manifest.protocol?.freshPlannerContext !== true ||
    manifest.protocol?.targetAccessDuringGeneration !== false ||
    manifest.protocol?.targetMountedDuringGeneration !== false ||
    manifest.protocol?.sourceInputSha256.length !== 2 ||
    manifest.protocol.sourceInputSha256.some((hash) => !isSha256(hash)) ||
    manifest.verdict?.protocolStatus !== 'passed' ||
    !['awaiting-blinded-human-evaluation', 'evaluated-blinded'].includes(
      manifest.verdict?.tasteStatus,
    ) ||
    (manifest.verdict.tasteStatus === 'evaluated-blinded' && !manifest.verdict.tasteEvidenceRef) ||
    manifest.preview?.mimeType !== 'video/mp4' ||
    !Number.isInteger(manifest.preview.width) ||
    !Number.isInteger(manifest.preview.height) ||
    manifest.preview.width <= 0 ||
    manifest.preview.height <= 0 ||
    Math.abs(manifest.preview.ratio - manifest.preview.width / manifest.preview.height) >
      0.000001 ||
    manifest.preview.ratio <= 0 ||
    manifest.preview.durationSeconds <= 0 ||
    !isSha256(manifest.preview.sha256) ||
    manifest.musicHandoff?.availabilityStatus !== 'confirm-in-instagram' ||
    manifest.musicHandoff?.commercialAudioPublished !== false ||
    manifest.musicHandoff.referenceDurationSeconds < manifest.musicHandoff.referenceEndSeconds ||
    manifest.musicHandoff.referenceEndSeconds <= manifest.musicHandoff.referenceStartSeconds ||
    anchors.length < 2 ||
    !anchorsAligned ||
    manifest.instagramHandoff?.userAddsAudioInInstagram !== true ||
    manifest.instagramHandoff.steps.length < 3 ||
    manifest.preview.url !== `${baseUrl}/source-only-preview.mp4` ||
    artifacts.length !== BLIND_PILOT_ARTIFACT_IDS.length ||
    new Set(artifactIds).size !== BLIND_PILOT_ARTIFACT_IDS.length ||
    new Set(urls).size !== urls.length ||
    BLIND_PILOT_ARTIFACT_IDS.some(
      (id) =>
        !artifacts.some(
          (artifact) =>
            artifact.id === id && artifact.url === `${baseUrl}/${BLIND_PILOT_ARTIFACT_FILES[id]}`,
        ),
    ) ||
    artifacts.some(({ label, mimeType, sha256 }) => !label || !mimeType || !isSha256(sha256))
  ) {
    throw new Error('The manifest failed the blind source-only proof contract.');
  }
  if (manifest.verdict.protocolStatus === 'passed' && !computeProtocolPassed(manifest)) {
    throw new Error('The blind pilot claims a pass while an isolation or audio gate is blocked.');
  }
}

function assertPublicUrl(url: string, label: string) {
  if (!url?.startsWith('/') || url.startsWith('//') || url.includes('..') || /[\\\r\n]/.test(url)) {
    throw new Error(`${label} must use a same-origin public path.`);
  }
}

function isSha256(value: string) {
  return /^[a-f0-9]{64}$/.test(value);
}

async function fetchBytes(url: string, label: string, fetcher: Fetcher) {
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

async function sha256Hex(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
