import { useEffect, useState } from 'react';
import {
  validateChoreographyAnalysis,
  validateChoreographyFreeze,
  validateSongConditionedPlan,
} from './choreography-contracts';
import { validateEditPlan } from './edit-contracts';
import { validateLocateResult } from './visual-grounding';

export interface SongReplayArtifact {
  id: string;
  file: string;
  sha256: string;
}

export interface SongReplayManifest {
  schemaVersion: 'nodevideo.song-conditioned-replay.v1';
  id: 'song-conditioned-auto-edit-v1';
  protocol: {
    targetMountedDuringGeneration: false;
    targetReadDuringGeneration: false;
    freezeBeforeEvaluation: true;
  };
  inputs: {
    originalChoreographyReference: true;
    creatorTakeCount: 2;
    chosenSongSegment: true;
    timedLyrics: true;
    sha256: {
      reference: string;
      takeA: string;
      takeB: string;
      music: string;
      timedText: string;
    };
  };
  audio: { sourceAudioMuted: true; previewContainsChosenSong: true };
  grounding: { provider: 'replay'; locateAnythingOptional: true; confidenceInvented: false };
  selection: { phraseCount: number; selectedTakeIds: string[]; takeSwitchCount: number };
  evaluation: { passed: true; tasteStatus: 'not-evaluated' };
  artifacts: SongReplayArtifact[];
}

const REQUIRED_ARTIFACT_FILES = {
  'original-choreography-reference': 'original-choreography-reference.mp4',
  'creator-take-a': 'creator-take-a.mp4',
  'creator-take-b': 'creator-take-b.mp4',
  'chosen-song': 'chosen-song.m4a',
  'timed-text': 'timed-text.json',
  understanding: 'understanding.json',
  'grounding-receipt': 'grounding-receipt.json',
  'song-conditioned-plan': 'song-conditioned-plan.json',
  'edit-plan': 'edit-plan.json',
  'generation-read-log': 'generation-read-log.json',
  'choreography-freeze': 'choreography-freeze.json',
  preview: 'preview.mp4',
  'freeze-receipt': 'freeze-receipt.json',
  'evaluator-report': 'evaluator-report.json',
} as const;

export interface SongReplayDescriptor {
  manifestSha256: string;
  manifestUrl: string;
}

export const PUBLISHED_SONG_REPLAY: SongReplayDescriptor = {
  manifestSha256:
    import.meta.env.VITE_NODEVIDEO_SONG_MANIFEST_SHA256 ??
    'ae91d3f427b016f6cd15a08ff5e20c9028150b3545eddc90e9dcf0a35b09047c',
  manifestUrl: '/media/song-conditioned-auto-edit-v1/manifest.json',
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function loadPublishedSongReplay(
  descriptor: SongReplayDescriptor = PUBLISHED_SONG_REPLAY,
  fetcher: Fetcher = fetch,
) {
  if (!isSha256(descriptor.manifestSha256))
    throw new Error('Replay trust digest is not configured.');
  const manifestBytes = await fetchBytes(descriptor.manifestUrl, fetcher);
  if ((await digest(manifestBytes)) !== descriptor.manifestSha256) {
    throw new Error('Replay manifest failed trusted SHA-256 verification.');
  }
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as SongReplayManifest;
  validateManifest(manifest);
  const artifactEntries = await Promise.all(
    manifest.artifacts.map(async (artifact) => {
      const url = `/media/${manifest.id}/${artifact.file}`;
      const bytes = await fetchBytes(url, fetcher);
      if ((await digest(bytes)) !== artifact.sha256) {
        throw new Error(`${artifact.id} failed SHA-256 verification.`);
      }
      return [artifact.id, bytes] as const;
    }),
  );
  validateArtifactChain(manifest, new Map(artifactEntries));
  return manifest;
}

export function usePublishedSongReplay() {
  const [state, setState] = useState<{
    error?: string;
    manifest?: SongReplayManifest;
    status: 'checking' | 'verified' | 'blocked';
  }>({ status: 'checking' });
  useEffect(() => {
    let active = true;
    loadPublishedSongReplay().then(
      (manifest) => active && setState({ manifest, status: 'verified' }),
      (error) =>
        active &&
        setState({
          error: error instanceof Error ? error.message : 'Replay verification failed.',
          status: 'blocked',
        }),
    );
    return () => {
      active = false;
    };
  }, []);
  return state;
}

function validateManifest(manifest: SongReplayManifest) {
  const ids = manifest.artifacts?.map((artifact) => artifact.id) ?? [];
  const artifactsById = new Map(
    manifest.artifacts?.map((artifact) => [artifact.id, artifact]) ?? [],
  );
  const requiredArtifacts = Object.entries(REQUIRED_ARTIFACT_FILES);
  const inputHashes = manifest.inputs?.sha256;
  if (
    manifest.schemaVersion !== 'nodevideo.song-conditioned-replay.v1' ||
    manifest.id !== 'song-conditioned-auto-edit-v1' ||
    manifest.protocol?.targetMountedDuringGeneration !== false ||
    manifest.protocol?.targetReadDuringGeneration !== false ||
    manifest.protocol?.freezeBeforeEvaluation !== true ||
    manifest.inputs?.originalChoreographyReference !== true ||
    manifest.inputs?.creatorTakeCount !== 2 ||
    manifest.inputs?.chosenSongSegment !== true ||
    manifest.inputs?.timedLyrics !== true ||
    !inputHashes ||
    ![
      inputHashes.reference,
      inputHashes.takeA,
      inputHashes.takeB,
      inputHashes.music,
      inputHashes.timedText,
    ].every(isSha256) ||
    manifest.audio?.sourceAudioMuted !== true ||
    manifest.audio?.previewContainsChosenSong !== true ||
    manifest.grounding?.provider !== 'replay' ||
    manifest.grounding?.locateAnythingOptional !== true ||
    manifest.grounding?.confidenceInvented !== false ||
    manifest.selection?.phraseCount !== 3 ||
    manifest.selection?.selectedTakeIds.join(',') !== 'asset.take-a,asset.take-b,asset.take-a' ||
    manifest.selection?.takeSwitchCount !== 2 ||
    manifest.evaluation?.passed !== true ||
    manifest.evaluation?.tasteStatus !== 'not-evaluated' ||
    ids.length !== new Set(ids).size ||
    ids.length !== requiredArtifacts.length ||
    requiredArtifacts.some(([id, file]) => artifactsById.get(id)?.file !== file) ||
    manifest.artifacts.some(
      (artifact) => !/^[a-z0-9][a-z0-9.-]*$/u.test(artifact.file) || !isSha256(artifact.sha256),
    )
  ) {
    throw new Error('Replay manifest failed the song-conditioned proof contract.');
  }
}

function validateArtifactChain(manifest: SongReplayManifest, bytesById: Map<string, ArrayBuffer>) {
  const artifactById = new Map(manifest.artifacts.map((artifact) => [artifact.id, artifact]));
  const expectedInputs = {
    'original-choreography-reference': manifest.inputs.sha256.reference,
    'creator-take-a': manifest.inputs.sha256.takeA,
    'creator-take-b': manifest.inputs.sha256.takeB,
    'chosen-song': manifest.inputs.sha256.music,
    'timed-text': manifest.inputs.sha256.timedText,
  };
  if (
    Object.entries(expectedInputs).some(([id, sha256]) => artifactById.get(id)?.sha256 !== sha256)
  ) {
    throw new Error('Replay input bindings do not match the trusted artifact set.');
  }

  const understanding = parseJsonArtifact(bytesById, 'understanding');
  const grounding = parseJsonArtifact(bytesById, 'grounding-receipt');
  const songPlan = parseJsonArtifact(bytesById, 'song-conditioned-plan');
  const editPlan = parseJsonArtifact(bytesById, 'edit-plan');
  const readLog = asRecord(parseJsonArtifact(bytesById, 'generation-read-log'));
  const choreographyFreeze = parseJsonArtifact(bytesById, 'choreography-freeze');
  const freezeReceipt = asRecord(parseJsonArtifact(bytesById, 'freeze-receipt'));
  const evaluator = asRecord(parseJsonArtifact(bytesById, 'evaluator-report'));
  const timedText = asRecord(parseJsonArtifact(bytesById, 'timed-text'));

  validateChoreographyAnalysis(understanding);
  validateLocateResult(grounding);
  validateSongConditionedPlan(songPlan, understanding);
  validateEditPlan(editPlan);
  validateChoreographyFreeze(choreographyFreeze, understanding);

  const sha = (id: string) => artifactById.get(id)?.sha256;
  const frozenFiles = new Map(
    asArray(freezeReceipt.files).map((entry) => {
      const record = asRecord(entry);
      return [record.file, record.sha256];
    }),
  );
  const expectedFrozenFiles = [
    'understanding',
    'grounding-receipt',
    'edit-plan',
    'song-conditioned-plan',
    'generation-read-log',
    'choreography-freeze',
    'preview',
  ];
  const readBindings = new Map(
    asArray(readLog.reads).map((entry) => {
      const record = asRecord(entry);
      return [record.assetId, record.sha256];
    }),
  );
  const expectedReadBindings = {
    'asset.choreography-reference': `sha256:${manifest.inputs.sha256.reference}`,
    'asset.take-a': `sha256:${manifest.inputs.sha256.takeA}`,
    'asset.take-b': `sha256:${manifest.inputs.sha256.takeB}`,
    'asset.music': `sha256:${manifest.inputs.sha256.music}`,
    'asset.timed-text': `sha256:${manifest.inputs.sha256.timedText}`,
  };
  const cues = asArray(timedText.cues).map(asRecord);
  const subject = grounding.observations.find(
    (observation) => observation.id === 'grounding.primary-dancer',
  );
  const subjectBox = subject?.geometry.kind === 'box' ? subject.geometry.box : undefined;
  const captionsMatchTimedInput =
    cues.length === understanding.captionLayouts.length &&
    cues.every((cue, index) => {
      const caption = understanding.captionLayouts[index];
      return (
        caption.text === cue.text &&
        caption.timelineRange.startMs === cue.startMs &&
        caption.timelineRange.endMs === cue.endMs
      );
    });
  const captionsMatchGrounding =
    subjectBox !== undefined &&
    understanding.captionLayouts.every(
      (caption) =>
        caption.groundingResultId === subject?.id &&
        caption.bodyOverlapRatio === normalizedOverlapRatio(caption.box, subjectBox),
    );
  if (
    freezeReceipt.schemaVersion !== 'nodevideo.generation-freeze.v1' ||
    freezeReceipt.targetMountedDuringGeneration !== false ||
    freezeReceipt.targetReadDuringGeneration !== false ||
    frozenFiles.size !== expectedFrozenFiles.length ||
    expectedFrozenFiles.some(
      (id) =>
        frozenFiles.get(REQUIRED_ARTIFACT_FILES[id as keyof typeof REQUIRED_ARTIFACT_FILES]) !==
        sha(id),
    ) ||
    choreographyFreeze.digests.analysis !== `sha256:${sha('understanding')}` ||
    choreographyFreeze.digests.plan !== `sha256:${sha('song-conditioned-plan')}` ||
    choreographyFreeze.digests.render !== `sha256:${sha('preview')}` ||
    choreographyFreeze.digests.generationReadLog !== `sha256:${sha('generation-read-log')}` ||
    songPlan.editPlanSha256 !== `sha256:${sha('edit-plan')}` ||
    evaluator.freezeReceiptSha256 !== sha('freeze-receipt') ||
    evaluator.passed !== true ||
    evaluator.tasteStatus !== 'not-evaluated' ||
    readLog.networkAccess !== false ||
    readLog.targetAccess !== 'denied' ||
    readBindings.size !== Object.keys(expectedReadBindings).length ||
    Object.entries(expectedReadBindings).some(
      ([assetId, sha256]) => readBindings.get(assetId) !== sha256,
    ) ||
    timedText.schemaVersion !== 'nodevideo.timed-text-input.v1' ||
    timedText.license !== 'public-domain-generated-fixture' ||
    cues.length !== 3 ||
    !captionsMatchTimedInput ||
    !captionsMatchGrounding
  ) {
    throw new Error('Replay artifacts failed frozen-chain semantic verification.');
  }
}

function parseJsonArtifact(bytesById: Map<string, ArrayBuffer>, id: string): unknown {
  const bytes = bytesById.get(id);
  if (!bytes) throw new Error(`Replay artifact ${id} is missing.`);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function asRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Replay artifact is not an object.');
  }
  return value as Record<string, any>;
}

function asArray(value: unknown): any[] {
  if (!Array.isArray(value)) throw new Error('Replay artifact field is not an array.');
  return value;
}

function normalizedOverlapRatio(
  subject: { x: number; y: number; width: number; height: number },
  occupied: { x: number; y: number; width: number; height: number },
) {
  const left = Math.max(subject.x, occupied.x);
  const top = Math.max(subject.y, occupied.y);
  const right = Math.min(subject.x + subject.width, occupied.x + occupied.width);
  const bottom = Math.min(subject.y + subject.height, occupied.y + occupied.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  return Math.round((intersection / (subject.width * subject.height)) * 1_000_000) / 1_000_000;
}

async function fetchBytes(url: string, fetcher: Fetcher) {
  const response = await fetcher(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Replay artifact returned ${response.status}.`);
  return response.arrayBuffer();
}

function isSha256(value: string) {
  return /^[a-f0-9]{64}$/u.test(value);
}

async function digest(bytes: ArrayBuffer) {
  const value = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
