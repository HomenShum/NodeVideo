import { useEffect, useState } from 'react';

interface CalibrationArtifact {
  id: string;
  file: string;
  mimeType: string;
  sha256: string;
  url: string;
}

export interface SongCalibrationManifest {
  schemaVersion: 'nodevideo.song-conditioned-calibration-release.v1';
  id: 'song-conditioned-real-calibration-v1';
  publication: {
    commercialAudioIncluded: false;
    sourceContainersIncluded: false;
    previewPolicy: 'sanitized-derived-picture-only';
  };
  isolation: { passed: true; targetAudioOracleUsed: true };
  result: {
    cutBoundaries: { f1: number };
    phraseSourceAgreement: { agreementRatio: number };
  };
  tasteStatus: 'not-evaluated';
  artifacts: CalibrationArtifact[];
}

const REQUIRED_FILES = {
  analysis: 'analysis.json',
  'edit-plan': 'edit-plan.json',
  'generation-manifest': 'generation-manifest.json',
  'freeze-receipt': 'freeze-receipt.json',
  'post-freeze-evaluation': 'post-freeze-evaluation.json',
  'derivation-receipt': 'derivation-receipt.json',
  'picture-only-preview': 'picture-only-preview.mp4',
} as const;

export const PUBLISHED_SONG_CALIBRATION = {
  manifestSha256:
    import.meta.env.VITE_NODEVIDEO_REAL_CALIBRATION_MANIFEST_SHA256 ??
    '19ca10170089d4a2c7d9cec1809a00e832a8a9d8b65e17ac3cd12c2b9169b502',
  manifestUrl: '/media/song-conditioned-real-calibration-v1/manifest.json',
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function loadPublishedSongCalibration(
  descriptor = PUBLISHED_SONG_CALIBRATION,
  fetcher: Fetcher = fetch,
) {
  if (!isSha256(descriptor.manifestSha256)) {
    throw new Error('Calibration trust digest is not configured.');
  }
  const manifestBytes = await fetchBytes(descriptor.manifestUrl, fetcher);
  if ((await digest(manifestBytes)) !== descriptor.manifestSha256) {
    throw new Error('Calibration manifest failed trusted SHA-256 verification.');
  }
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as SongCalibrationManifest;
  validateManifest(manifest);
  const entries = await Promise.all(
    manifest.artifacts.map(async (artifact) => {
      const bytes = await fetchBytes(`/media/${manifest.id}/${artifact.file}`, fetcher);
      if ((await digest(bytes)) !== artifact.sha256) {
        throw new Error(`${artifact.id} failed SHA-256 verification.`);
      }
      return [artifact.id, bytes] as const;
    }),
  );
  validateChain(manifest, new Map(entries));
  return manifest;
}

export function usePublishedSongCalibration() {
  const [state, setState] = useState<{
    error?: string;
    manifest?: SongCalibrationManifest;
    status: 'checking' | 'verified' | 'blocked';
  }>({ status: 'checking' });
  useEffect(() => {
    let active = true;
    loadPublishedSongCalibration().then(
      (manifest) => active && setState({ manifest, status: 'verified' }),
      (error) =>
        active &&
        setState({
          error: error instanceof Error ? error.message : 'Calibration verification failed.',
          status: 'blocked',
        }),
    );
    return () => {
      active = false;
    };
  }, []);
  return state;
}

function validateManifest(manifest: SongCalibrationManifest) {
  const artifacts = new Map(manifest.artifacts?.map((artifact) => [artifact.id, artifact]));
  if (
    manifest.schemaVersion !== 'nodevideo.song-conditioned-calibration-release.v1' ||
    manifest.id !== 'song-conditioned-real-calibration-v1' ||
    manifest.publication?.commercialAudioIncluded !== false ||
    manifest.publication?.sourceContainersIncluded !== false ||
    manifest.publication?.previewPolicy !== 'sanitized-derived-picture-only' ||
    manifest.isolation?.passed !== true ||
    manifest.isolation?.targetAudioOracleUsed !== true ||
    manifest.result?.cutBoundaries?.f1 < 0.9 ||
    manifest.result?.phraseSourceAgreement?.agreementRatio !== 1 ||
    manifest.tasteStatus !== 'not-evaluated' ||
    artifacts.size !== Object.keys(REQUIRED_FILES).length ||
    Object.entries(REQUIRED_FILES).some(([id, file]) => artifacts.get(id)?.file !== file) ||
    manifest.artifacts.some(
      (artifact) =>
        !isSha256(artifact.sha256) ||
        artifact.url !== `/media/${manifest.id}/${artifact.file}` ||
        !/^[a-z0-9][a-z0-9.-]*$/u.test(artifact.file),
    )
  ) {
    throw new Error('Calibration manifest failed its release contract.');
  }
}

function validateChain(manifest: SongCalibrationManifest, bytesById: Map<string, ArrayBuffer>) {
  const artifactById = new Map(manifest.artifacts.map((artifact) => [artifact.id, artifact]));
  const freeze = asRecord(parseJson(bytesById, 'freeze-receipt'));
  const evaluation = asRecord(parseJson(bytesById, 'post-freeze-evaluation'));
  const generation = asRecord(parseJson(bytesById, 'generation-manifest'));
  const derivation = asRecord(parseJson(bytesById, 'derivation-receipt'));
  const frozenFiles = new Map(
    asArray(freeze.files).map((entry) => {
      const record = asRecord(entry);
      return [record.file, record.sha256];
    }),
  );
  const frozenRender = asArray(freeze.files)
    .map(asRecord)
    .find((record) => typeof record.file === 'string' && record.file.endsWith('.mp4'));
  const sha = (id: string) => artifactById.get(id)?.sha256;
  if (
    freeze.schemaVersion !== 'nodevideo.generation-freeze.v1' ||
    freeze.targetMountedDuringGeneration !== false ||
    freeze.targetReadDuringGeneration !== false ||
    freeze.targetPlanReadDuringGeneration !== false ||
    frozenFiles.size !== 4 ||
    frozenFiles.get('analysis.json') !== sha('analysis') ||
    frozenFiles.get('edit-plan.json') !== sha('edit-plan') ||
    frozenFiles.get('generation-manifest.json') !== sha('generation-manifest') ||
    !frozenRender ||
    asRecord(generation.render).sha256 !== frozenRender.sha256 ||
    asRecord(generation.render).hasAudio !== true ||
    asRecord(generation.decisions).cameraAudioMuted !== true ||
    asRecord(evaluation.artifactBindings).freezeReceiptSha256 !== sha('freeze-receipt') ||
    asRecord(evaluation.artifactBindings).generatedPlanSha256 !== sha('edit-plan') ||
    JSON.stringify(evaluation.isolation) !== JSON.stringify(manifest.isolation) ||
    JSON.stringify(evaluation.technicalComparison) !== JSON.stringify(manifest.result) ||
    derivation.schemaVersion !== 'nodevideo.picture-only-derivation.v1' ||
    derivation.sourceFreezeReceiptSha256 !== sha('freeze-receipt') ||
    derivation.sourceRenderSha256 !== frozenRender.sha256 ||
    derivation.publishedPreviewSha256 !== sha('picture-only-preview') ||
    derivation.transform !== 'copy-video-stream-remove-all-audio-faststart' ||
    derivation.audioRemoved !== true
  ) {
    throw new Error('Calibration artifacts failed frozen derivation-chain verification.');
  }
}

function parseJson(bytesById: Map<string, ArrayBuffer>, id: string): unknown {
  const bytes = bytesById.get(id);
  if (!bytes) throw new Error(`Calibration artifact ${id} is missing.`);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function asRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Calibration artifact is not an object.');
  }
  return value as Record<string, any>;
}

function asArray(value: unknown): any[] {
  if (!Array.isArray(value)) throw new Error('Calibration artifact field is not an array.');
  return value;
}

async function fetchBytes(url: string, fetcher: Fetcher) {
  const response = await fetcher(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Calibration artifact returned ${response.status}.`);
  return response.arrayBuffer();
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

async function digest(bytes: ArrayBuffer) {
  const value = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
