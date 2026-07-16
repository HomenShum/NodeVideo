export interface InspectorAsset {
  id: string;
  url: string;
  mimeType: string;
  sha256: string;
}

export interface PoseTrack {
  sourceSha256: string;
  sampleCadenceHz: number;
  times: number[];
  poses: Array<Array<[number | null, number | null, number | null]>>;
}

export interface PoseInspectorArtifact {
  schemaVersion: 'nodevideo.pose-inspector.v1';
  coordinateSpace: string;
  landmarkModel: string;
  displayPolicy: string;
  tracks: Record<'reference' | 'take-a' | 'take-b' | 'target', PoseTrack>;
}

export interface IntegratedInspectorManifest {
  schemaVersion: 'nodevideo.integrated-inspector-manifest.v1';
  id: 'integrated-source-only-v1';
  reference: { label: string; url: string; outputStartSeconds: number; role: string };
  media: { generated: string; target: string; takeA: string; takeB: string };
  synchronization: {
    outputFps: 30;
    durationSeconds: number;
    choreographyDurationSeconds: number;
    referenceOffsetSeconds: number;
    takeOffsetsSeconds: Record<'asset.take-a' | 'asset.take-b', number>;
    generatedCutsSeconds: number[];
    selectedTakeAssetIds: string[];
    framingTemplates: Array<'fit' | 'fill'>;
  };
  result: {
    targetIsolation: {
      passed: boolean;
      targetMountedDuringGeneration: boolean;
      targetReadDuringGeneration: boolean;
      targetOpenedOnlyAfterFreezeVerification: boolean;
      targetAudioOracleUsed: boolean;
    };
    cutComparison: {
      f1: number;
      meanNearestNeighborErrorSeconds: number;
      maxNearestNeighborErrorSeconds: number;
    };
    phraseSourceAgreement: { agreementRatio: number };
    soundtrack: {
      title: string;
      artist: string;
      releasedMasterOffsetMs: number;
      independentOfficialSource: boolean;
      privateAudioCorrelation: number;
      bestLagMs: number;
      publicPreviewIsSilent: boolean;
      handoff: string;
    };
  };
  grounding: {
    pose: string;
    poseModel: string;
    locateAnything: string;
  };
  assets: InspectorAsset[];
}

export interface LoadedIntegratedInspector {
  manifest: IntegratedInspectorManifest;
  pose: PoseInspectorArtifact;
  verifiedAssetCount: number;
}

export const INTEGRATED_INSPECTOR = {
  manifestUrl: '/media/integrated-source-only-v1/manifest.json',
  manifestSha256: '1698c4f7134e8a66335497ccad33a0a75db11620c4ac273ca7c2e8fe5ede9131',
} as const;

export async function loadIntegratedInspector(): Promise<LoadedIntegratedInspector> {
  const manifestBytes = await fetchBytes(INTEGRATED_INSPECTOR.manifestUrl, 'inspector manifest');
  if ((await sha256Hex(manifestBytes)) !== INTEGRATED_INSPECTOR.manifestSha256) {
    throw new Error('The integrated inspector manifest failed trusted SHA-256 verification.');
  }
  const manifest = decode<IntegratedInspectorManifest>(manifestBytes, 'inspector manifest');
  validateManifest(manifest);
  const verified = await Promise.all(
    manifest.assets.map(async (asset) => {
      const bytes = await fetchBytes(asset.url, asset.id);
      if ((await sha256Hex(bytes)) !== asset.sha256) {
        throw new Error(`${asset.id} failed SHA-256 verification.`);
      }
      return { asset, bytes };
    }),
  );
  const poseRecord = verified.find(({ asset }) => asset.id === 'pose-tracks');
  if (!poseRecord) throw new Error('The inspector does not declare pose tracks.');
  const pose = decode<PoseInspectorArtifact>(poseRecord.bytes, 'pose tracks');
  if (
    pose.schemaVersion !== 'nodevideo.pose-inspector.v1' ||
    !pose.tracks.reference ||
    !pose.tracks['take-a'] ||
    !pose.tracks['take-b'] ||
    !pose.tracks.target
  ) {
    throw new Error('The pose artifact failed its contract.');
  }
  return { manifest, pose, verifiedAssetCount: verified.length };
}

function validateManifest(manifest: IntegratedInspectorManifest) {
  const ids = new Set(manifest.assets?.map(({ id }) => id));
  if (
    manifest.schemaVersion !== 'nodevideo.integrated-inspector-manifest.v1' ||
    manifest.id !== 'integrated-source-only-v1' ||
    manifest.synchronization?.outputFps !== 30 ||
    manifest.assets?.length !== 7 ||
    ids.size !== 7 ||
    !ids.has('pose-tracks') ||
    !ids.has('preview-silent') ||
    !manifest.result?.targetIsolation?.passed ||
    manifest.result.targetIsolation.targetAudioOracleUsed
  ) {
    throw new Error('The integrated inspector manifest failed its proof contract.');
  }
  for (const asset of manifest.assets) {
    if (!asset.url.startsWith('/media/') || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new Error('The integrated inspector manifest contains an invalid asset.');
    }
  }
}

async function fetchBytes(url: string, label: string) {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Could not load ${label}.`);
  return response.arrayBuffer();
}

function decode<T>(bytes: ArrayBuffer, label: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function sha256Hex(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
