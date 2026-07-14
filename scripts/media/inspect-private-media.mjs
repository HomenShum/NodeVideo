#!/usr/bin/env node

import { basename, join, relative } from 'node:path';
import {
  PRIVATE_EVIDENCE_ROOT,
  REPO_ROOT,
  assertPrivateOutput,
  assertion,
  assertionsPass,
  ffmpegVersion,
  ffprobeVersion,
  fitBandMetrics,
  layoutMetrics,
  meanAbsoluteDifference,
  near,
  privacyAssertions,
  probeMedia,
  rationalNumber,
  readRgbFrames,
  regionLuma,
  requireFile,
  resolveInputPath,
  sanitizeProbe,
  scanDeployableMedia,
  sha256File,
  writeJson,
} from './media-proof-lib.mjs';

const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe';
const evidencePath = assertPrivateOutput(
  join(PRIVATE_EVIDENCE_ROOT, 'private-media-evidence.json'),
);

const inputs = [
  {
    alias: 'rawTakeA',
    path: requiredInputPath('NODEVIDEO_RAW_TAKE_A'),
    expected: { duration: 57.58, frames: 1727 },
  },
  {
    alias: 'rawTakeB',
    path: requiredInputPath('NODEVIDEO_RAW_TAKE_B'),
    expected: { duration: 68.216667, frames: 2046 },
  },
  {
    alias: 'referenceOutput',
    path: requiredInputPath('NODEVIDEO_REFERENCE_OUTPUT'),
    expected: { duration: 44.5, frames: 1335 },
  },
];

for (const input of inputs) {
  requireFile(input.path, input.alias);
}

const inspected = {};
for (const input of inputs) {
  inspected[input.alias] = {
    sha256: await sha256File(input.path),
    metadata: sanitizeProbe(probeMedia(input.path, ffprobe)),
  };
}

const metadataAssertions = [
  ...rawTakeAssertions('rawTakeA', inspected.rawTakeA.metadata, inputs[0].expected),
  ...rawTakeAssertions('rawTakeB', inspected.rawTakeB.metadata, inputs[1].expected),
  ...referenceAssertions(inspected.referenceOutput.metadata, inputs[2].expected),
];

const recipeFrames = [22, 200, 201, 481, 482, 588, 589, 752, 753, 900, 1200, 1220, 1230, 1290];
const decoded = readRgbFrames(inputs[2].path, recipeFrames, { ffmpeg });
const states = Object.fromEntries(
  recipeFrames.map((frameNumber) => [frameNumber, layoutMetrics(decoded.get(frameNumber))]),
);
const fitBand = fitBandMetrics(decoded.get(22));
const normalBandLuma = regionLuma(decoded.get(1200), 180, {
  xStart: 8,
  xEnd: 62,
  yStart: 112,
  yEnd: 208,
});
const dimBandLuma = regionLuma(decoded.get(1220), 180, {
  xStart: 8,
  xEnd: 62,
  yStart: 112,
  yEnd: 208,
});
const endCardMarkLuma = regionLuma(decoded.get(1230), 180, {
  xStart: 73,
  xEnd: 108,
  yStart: 142,
  yEnd: 180,
});
const frozenBackgroundDifference = regionDifference(decoded.get(1230), decoded.get(1290), 180, {
  xStart: 8,
  xEnd: 62,
  yStart: 112,
  yEnd: 208,
});

const expectedStates = new Map([
  [22, 'fit'],
  [200, 'fit'],
  [201, 'fill'],
  [481, 'fill'],
  [482, 'fit'],
  [588, 'fit'],
  [589, 'fill'],
  [752, 'fill'],
  [753, 'fit'],
  [900, 'fit'],
]);

const recipeAssertions = [
  ...[...expectedStates].map(([frameNumber, expected]) =>
    assertion(
      `frame ${frameNumber} composition`,
      states[frameNumber].state === expected,
      states[frameNumber],
      expected,
    ),
  ),
  assertion(
    'reference fit band begins near y=437',
    near(fitBand.top, 437, 10),
    fitBand.top,
    '437 +/- 10',
  ),
  assertion(
    'reference fit band ends near y=842',
    near(fitBand.bottom, 842, 10),
    fitBand.bottom,
    '842 +/- 10',
  ),
  ...[
    [200, 201, 201],
    [481, 482, 482],
    [588, 589, 589],
    [752, 753, 753],
  ].map(([before, after, cutFrame]) => {
    const difference = meanAbsoluteDifference(decoded.get(before), decoded.get(after));
    return assertion(`hard cut at frame ${cutFrame}`, difference > 8, round(difference), '> 8');
  }),
  assertion(
    'end card dims the fitted background',
    dimBandLuma < normalBandLuma * 0.7,
    {
      before: round(normalBandLuma),
      after: round(dimBandLuma),
      ratio: round(dimBandLuma / normalBandLuma),
    },
    'after/before < 0.7',
  ),
  assertion('end card mark is visible', endCardMarkLuma > 18, round(endCardMarkLuma), '> 18'),
  assertion(
    'end card background is frozen',
    frozenBackgroundDifference < 3,
    round(frozenBackgroundDifference),
    '< 3 mean RGB delta',
  ),
];

const deployableMedia = await scanDeployableMedia();
const personalHashes = inputs.map((input) => inspected[input.alias].sha256);
const forbiddenBaseNames = inputs.map((input) => basename(input.path));
const privacyChecks = privacyAssertions(deployableMedia, personalHashes, forbiddenBaseNames);
const allAssertions = [...metadataAssertions, ...recipeAssertions, ...privacyChecks];

const report = {
  schema: 'nodevideo.private-media-evidence.v1',
  privacy: {
    classification: 'private-local-evidence',
    sourcePathsRecorded: false,
    mediaCopied: false,
    frameImagesWritten: false,
    evidenceDirectory: relative(REPO_ROOT, PRIVATE_EVIDENCE_ROOT).replaceAll('\\', '/'),
  },
  tools: {
    ffmpeg: ffmpegVersion(ffmpeg),
    ffprobe: ffprobeVersion(ffprobe),
  },
  inputs: inspected,
  verifiedRecipe: {
    canvas: { width: 720, height: 1280, frameRate: 30 },
    fitGeometry: {
      displayedSource: { width: 1916, height: 1078 },
      scaled: { width: 720, height: 406 },
      placement: { x: 0, y: 437 },
    },
    fillGeometry: {
      displayedSource: { width: 1916, height: 1078 },
      scaledHeight: 1280,
      sourceCropApproximation: {
        xStart: 654,
        xEnd: 1261,
        anchor: 'center',
      },
    },
    cutMap: [
      {
        output: { startSeconds: 0, endSeconds: 6.7 },
        sourceAlias: 'rawTakeA',
        source: { startSeconds: 15.5, endSeconds: 22.2 },
        layout: 'fit',
      },
      {
        output: { startSeconds: 6.7, endSeconds: 16.066667 },
        sourceAlias: 'rawTakeB',
        source: { startSeconds: 32.2, endSeconds: 41.566667 },
        layout: 'fill',
      },
      {
        output: { startSeconds: 16.066667, endSeconds: 19.633333 },
        sourceAlias: 'rawTakeA',
        source: { startSeconds: 28.566667, endSeconds: 32.133333 },
        layout: 'fit',
      },
      {
        output: { startSeconds: 19.633333, endSeconds: 25.1 },
        sourceAlias: 'rawTakeB',
        source: { startSeconds: 45.133333, endSeconds: 50.6 },
        layout: 'fill',
      },
      {
        output: { startSeconds: 25.1, endSeconds: 40.25 },
        sourceAlias: 'rawTakeA',
        source: { startSeconds: 40.6, endSeconds: 55.75 },
        layout: 'fit',
      },
      {
        output: { startSeconds: 40.25, endSeconds: 44.5 },
        sourceAlias: 'rawTakeA',
        source: { freezeAtSeconds: 55.75 },
        layout: 'dimmed-freeze-end-card',
      },
    ],
    visualMeasurements: {
      fitBand,
      frameStates: states,
      normalBandLuma: round(normalBandLuma),
      dimBandLuma: round(dimBandLuma),
      endCardMarkLuma: round(endCardMarkLuma),
      frozenBackgroundDifference: round(frozenBackgroundDifference),
    },
  },
  deployableMedia,
  verification: {
    passed: assertionsPass(allAssertions),
    assertions: allAssertions,
  },
};

await writeJson(evidencePath, report);

if (!report.verification.passed) {
  const failures = allAssertions
    .filter((item) => !item.pass)
    .map((item) => item.name)
    .join(', ');
  throw new Error(`Private media verification failed: ${failures}`);
}

console.log(`Private evidence verified at ${relative(REPO_ROOT, evidencePath)} (JSON only).`);

function requiredInputPath(environmentName) {
  const configuredPath = process.env[environmentName];
  if (!configuredPath) {
    throw new Error(`Set ${environmentName} to an explicit private media path before running.`);
  }
  return resolveInputPath(configuredPath);
}

function rawTakeAssertions(alias, metadata, expected) {
  return [
    assertion(`${alias} codec`, metadata.video.codec === 'hevc', metadata.video.codec, 'hevc'),
    assertion(
      `${alias} profile`,
      metadata.video.profile === 'Main 10',
      metadata.video.profile,
      'Main 10',
    ),
    assertion(
      `${alias} coded width`,
      metadata.video.codedWidth === 1078,
      metadata.video.codedWidth,
      1078,
    ),
    assertion(
      `${alias} coded height`,
      metadata.video.codedHeight === 1916,
      metadata.video.codedHeight,
      1916,
    ),
    assertion(
      `${alias} rotation`,
      metadata.video.rotationDegrees === -90,
      metadata.video.rotationDegrees,
      -90,
    ),
    assertion(
      `${alias} pixel format`,
      metadata.video.pixelFormat === 'yuv420p10le',
      metadata.video.pixelFormat,
      'yuv420p10le',
    ),
    assertion(
      `${alias} colorspace`,
      metadata.video.colorSpace === 'bt2020nc',
      metadata.video.colorSpace,
      'bt2020nc',
    ),
    assertion(
      `${alias} transfer`,
      metadata.video.colorTransfer === 'arib-std-b67',
      metadata.video.colorTransfer,
      'arib-std-b67',
    ),
    assertion(
      `${alias} primaries`,
      metadata.video.colorPrimaries === 'bt2020',
      metadata.video.colorPrimaries,
      'bt2020',
    ),
    assertion(
      `${alias} nominal frame rate`,
      near(rationalNumber(metadata.video.nominalFrameRate), 30, 0.0001),
      rationalNumber(metadata.video.nominalFrameRate),
      30,
    ),
    assertion(
      `${alias} frame count`,
      metadata.video.frameCount === expected.frames,
      metadata.video.frameCount,
      expected.frames,
    ),
    assertion(
      `${alias} duration`,
      near(metadata.video.durationSeconds, expected.duration, 0.02),
      metadata.video.durationSeconds,
      expected.duration,
    ),
    assertion(
      `${alias} audio sample rate`,
      metadata.audio.sampleRate === 48000,
      metadata.audio.sampleRate,
      48000,
    ),
    assertion(`${alias} stereo audio`, metadata.audio.channels === 2, metadata.audio.channels, 2),
  ];
}

function referenceAssertions(metadata, expected) {
  const audioTail = metadata.video.durationSeconds - metadata.audio.durationSeconds;
  return [
    assertion('reference codec', metadata.video.codec === 'hevc', metadata.video.codec, 'hevc'),
    assertion('reference width', metadata.video.codedWidth === 720, metadata.video.codedWidth, 720),
    assertion(
      'reference height',
      metadata.video.codedHeight === 1280,
      metadata.video.codedHeight,
      1280,
    ),
    assertion(
      'reference has no rotation tag',
      metadata.video.rotationDegrees === null,
      metadata.video.rotationDegrees,
      null,
    ),
    assertion(
      'reference pixel format',
      metadata.video.pixelFormat === 'yuv420p',
      metadata.video.pixelFormat,
      'yuv420p',
    ),
    assertion(
      'reference colorspace',
      metadata.video.colorSpace === 'bt709',
      metadata.video.colorSpace,
      'bt709',
    ),
    assertion(
      'reference transfer',
      metadata.video.colorTransfer === 'bt709',
      metadata.video.colorTransfer,
      'bt709',
    ),
    assertion(
      'reference primaries',
      metadata.video.colorPrimaries === 'bt709',
      metadata.video.colorPrimaries,
      'bt709',
    ),
    assertion(
      'reference frame rate',
      near(rationalNumber(metadata.video.averageFrameRate), 30, 0.0001),
      rationalNumber(metadata.video.averageFrameRate),
      30,
    ),
    assertion(
      'reference frame count',
      metadata.video.frameCount === expected.frames,
      metadata.video.frameCount,
      expected.frames,
    ),
    assertion(
      'reference duration',
      near(metadata.video.durationSeconds, expected.duration, 0.02),
      metadata.video.durationSeconds,
      expected.duration,
    ),
    assertion(
      'reference audio sample rate',
      metadata.audio.sampleRate === 44100,
      metadata.audio.sampleRate,
      44100,
    ),
    assertion(
      'reference silent video tail',
      near(audioTail, 1.823, 0.08),
      round(audioTail),
      '1.823 +/- 0.08 seconds',
    ),
  ];
}

function regionDifference(left, right, width, region) {
  let total = 0;
  let count = 0;
  for (let y = region.yStart; y < region.yEnd; y += 1) {
    for (let x = region.xStart; x < region.xEnd; x += 1) {
      const index = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        total += Math.abs(left[index + channel] - right[index + channel]);
        count += 1;
      }
    }
  }
  return total / count;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
