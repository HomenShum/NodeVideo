#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sha256File, writeJson } from '../media/media-proof-lib.mjs';

const root = resolve('.qa/evidence/private/integrated-inspector-v1');
const generation = join(root, 'frozen-generation-v5');
const output = resolve('fixtures/media/integrated-source-only-v1');
await mkdir(output, { recursive: true });

const files = {
  analysis: join(generation, 'analysis.json'),
  evaluation: join(root, 'post-freeze-evaluation-v5.json'),
  freeze: join(generation, 'freeze-receipt.json'),
  plan: join(generation, 'edit-plan.json'),
  preview: join(generation, 'source-only-song-preview.mp4'),
  selection: join(root, 'reference-performer-selection.json'),
};

const copies = [
  ['analysis.json', files.analysis],
  ['edit-plan.json', files.plan],
  ['freeze-receipt.json', files.freeze],
  ['post-freeze-evaluation.json', files.evaluation],
  ['reference-performer-selection.json', files.selection],
];
await Promise.all(
  copies.map(async ([name, source]) => {
    const artifact = JSON.parse(await readFile(source, 'utf8'));
    await writeJson(join(output, name), artifact);
  }),
);

execFileSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    files.preview,
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '27',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    join(output, 'preview-silent.mp4'),
  ],
  { stdio: 'inherit' },
);

const analysis = JSON.parse(await readFile(files.analysis, 'utf8'));
const evaluation = JSON.parse(await readFile(files.evaluation, 'utf8'));
const selection = JSON.parse(await readFile(files.selection, 'utf8'));
const publicFiles = [
  ['analysis', 'analysis.json', 'application/json'],
  ['edit-plan', 'edit-plan.json', 'application/json'],
  ['freeze', 'freeze-receipt.json', 'application/json'],
  ['evaluation', 'post-freeze-evaluation.json', 'application/json'],
  ['selection', 'reference-performer-selection.json', 'application/json'],
  ['pose-tracks', 'pose-tracks.json', 'application/json'],
  ['preview-silent', 'preview-silent.mp4', 'video/mp4'],
];
const assets = await Promise.all(
  publicFiles.map(async ([id, name, mimeType]) => ({
    id,
    url: `/media/integrated-source-only-v1/${name}`,
    mimeType,
    sha256: await sha256File(join(output, name)),
  })),
);
const manifest = {
  schemaVersion: 'nodevideo.integrated-inspector-manifest.v1',
  id: 'integrated-source-only-v1',
  reference: {
    label: "82MAJOR 'Sign' LIVE Dance Practice",
    url: 'https://www.youtube.com/watch?v=ssA5AJdQtlc',
    outputStartSeconds: analysis.reference.choreographyStartSeconds,
    role: analysis.reference.role,
  },
  media: {
    generated: '/media/integrated-source-only-v1/preview-silent.mp4',
    target: '/media/authorized-real-v1/target-web.mp4',
    takeA: '/media/authorized-real-v1/source-a-web.mp4',
    takeB: '/media/authorized-real-v1/source-b-web.mp4',
  },
  synchronization: {
    outputFps: 30,
    durationSeconds: 44.5,
    choreographyDurationSeconds: 40.4,
    referenceOffsetSeconds: analysis.reference.choreographyStartSeconds,
    takeOffsetsSeconds: Object.fromEntries(
      selection.alignments
        ? Object.entries(selection.alignments).map(([id, value]) => [
            id,
            value.choreographyStartSeconds,
          ])
        : analysis.alignments.map((value) => [value.takeAssetId, value.choreographyStartSeconds]),
    ),
    generatedCutsSeconds: analysis.phrases.slice(0, -1).map((phrase) => phrase.timelineEndSeconds),
    selectedTakeAssetIds: analysis.phrases.map((phrase) => phrase.selectedTakeAssetId),
    framingTemplates: analysis.phrases.map((phrase) => phrase.framingTemplate),
  },
  result: {
    targetIsolation: evaluation.isolation,
    cutComparison: evaluation.technicalComparison.cutBoundaries,
    phraseSourceAgreement: evaluation.technicalComparison.phraseSourceAgreement,
    soundtrack: {
      title: 'Sign',
      artist: '82MAJOR',
      releasedMasterOffsetMs: 29157,
      independentOfficialSource: true,
      privateAudioCorrelation: 0.979986,
      bestLagMs: 0.75,
      publicPreviewIsSilent: true,
      handoff:
        'Search “Sign · 82MAJOR” in Instagram and start near 00:29.16 of the released master.',
    },
  },
  grounding: {
    pose: 'live-analysis-artifact',
    poseModel: 'MediaPipe Pose Landmarker',
    locateAnything: 'not-executed-no-configured-sidecar',
  },
  assets,
};
await writeJson(join(output, 'manifest.json'), manifest);
console.log(`Published ${assets.length} inspector assets to ${output}`);
