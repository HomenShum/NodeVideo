#!/usr/bin/env node

import { basename, extname, join, relative } from 'node:path';
import {
  PRIVATE_EVIDENCE_ROOT,
  REPO_ROOT,
  assertPrivateOutput,
  assertion,
  assertionsPass,
  ffmpegVersion,
  ffprobeVersion,
  layoutMetrics,
  near,
  probeMedia,
  rationalNumber,
  readRgbFrames,
  regionLuma,
  requireFile,
  resolveInputPath,
  runText,
  sanitizeProbe,
  sha256File,
  writeJson,
} from './media-proof-lib.mjs';

const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe';
const rawTakeA = requiredInputPath('NODEVIDEO_RAW_TAKE_A');
const rawTakeB = requiredInputPath('NODEVIDEO_RAW_TAKE_B');
const referenceOutput = requiredInputPath('NODEVIDEO_REFERENCE_OUTPUT');
const output = assertPrivateOutput(
  process.env.NODEVIDEO_PRIVATE_RECONSTRUCTION_OUTPUT ??
    join(PRIVATE_EVIDENCE_ROOT, 'reconstruction-candidate.mp4'),
);
const proofPath = assertPrivateOutput(`${output.slice(0, -extname(output).length)}.proof.json`);

requireFile(rawTakeA, 'rawTakeA');
requireFile(rawTakeB, 'rawTakeB');
requireFile(referenceOutput, 'referenceOutput');

const toneMap = [
  'zscale=transfer=linear:npl=100',
  'format=gbrpf32le',
  'tonemap=tonemap=mobius:param=0.3:desat=0',
  'zscale=primaries=bt709:transfer=bt709:matrix=bt709:range=limited',
  'format=yuv420p',
].join(',');
const fit = 'scale=720:-2:flags=lanczos,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1';
const fill = 'scale=-2:1280:flags=lanczos,crop=720:1280:(iw-720)/2:0,setsar=1';
const endCard = [
  'eq=brightness=-0.45',
  'drawbox=x=292:y=572:w=136:h=136:color=white:t=10',
  "drawbox=x=326:y=606:w=68:h=68:color=0x4fe1c1:t=fill:enable='lt(mod(t,0.5),0.25)'",
  "drawbox=x=326:y=606:w=68:h=68:color=0xff4fd8:t=fill:enable='gte(mod(t,0.5),0.25)'",
].join(',');

const filter = [
  `[0:v]trim=start=15.5,setpts=PTS-STARTPTS,fps=30,trim=end_frame=201,setpts=N/(30*TB),${toneMap},${fit}[segment_a]`,
  `[1:v]trim=start=32.2,setpts=PTS-STARTPTS,fps=30,trim=end_frame=281,setpts=N/(30*TB),${toneMap},${fill}[segment_b]`,
  `[0:v]trim=start=28.566667,setpts=PTS-STARTPTS,fps=30,trim=end_frame=107,setpts=N/(30*TB),${toneMap},${fit}[segment_c]`,
  `[1:v]trim=start=45.133333,setpts=PTS-STARTPTS,fps=30,trim=end_frame=164,setpts=N/(30*TB),${toneMap},${fill}[segment_d]`,
  `[0:v]trim=start=40.6,setpts=PTS-STARTPTS,fps=30,trim=end_frame=455,setpts=N/(30*TB),${toneMap},${fit}[segment_e]`,
  `[0:v]trim=start=55.75:end=55.79,setpts=PTS-STARTPTS,fps=30,trim=end_frame=1,setpts=N/(30*TB),${toneMap},${fit},tpad=stop_mode=clone:stop_duration=4.2,trim=end_frame=127,setpts=N/(30*TB),${endCard}[segment_end]`,
  '[segment_a][segment_b][segment_c][segment_d][segment_e][segment_end]concat=n=6:v=1:a=0,fps=30,trim=end_frame=1335,setpts=N/(30*TB),format=yuv420p[outv]',
  '[2:a:0]atrim=start=0:end=42.676875,asetpts=PTS-STARTPTS[aout]',
].join(';');

runText(ffmpeg, [
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-i',
  rawTakeA,
  '-i',
  rawTakeB,
  '-i',
  referenceOutput,
  '-filter_complex',
  filter,
  '-map',
  '[outv]',
  '-map',
  '[aout]',
  '-map_metadata',
  '-1',
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '22',
  '-g',
  '30',
  '-keyint_min',
  '30',
  '-sc_threshold',
  '0',
  '-pix_fmt',
  'yuv420p',
  '-color_range',
  'tv',
  '-colorspace',
  'bt709',
  '-color_trc',
  'bt709',
  '-color_primaries',
  'bt709',
  '-video_track_timescale',
  '600',
  '-c:a',
  'aac',
  '-b:a',
  '128k',
  '-ar',
  '44100',
  '-ac',
  '2',
  '-movflags',
  '+faststart',
  output,
]);

const metadata = sanitizeProbe(probeMedia(output, ffprobe));
const frames = readRgbFrames(output, [22, 225, 500, 650, 900, 1230], {
  ffmpeg,
});
const layouts = {
  22: layoutMetrics(frames.get(22)),
  225: layoutMetrics(frames.get(225)),
  500: layoutMetrics(frames.get(500)),
  650: layoutMetrics(frames.get(650)),
  900: layoutMetrics(frames.get(900)),
};
const endCardMarkLuma = regionLuma(frames.get(1230), 180, {
  xStart: 73,
  xEnd: 108,
  yStart: 142,
  yEnd: 180,
});
const audioTail = metadata.video.durationSeconds - metadata.audio.durationSeconds;
const assertions = [
  assertion('candidate width', metadata.video.codedWidth === 720, metadata.video.codedWidth, 720),
  assertion(
    'candidate height',
    metadata.video.codedHeight === 1280,
    metadata.video.codedHeight,
    1280,
  ),
  assertion(
    'candidate frame rate',
    near(rationalNumber(metadata.video.averageFrameRate), 30, 0.0001),
    rationalNumber(metadata.video.averageFrameRate),
    30,
  ),
  assertion(
    'candidate frame count',
    metadata.video.frameCount === 1335,
    metadata.video.frameCount,
    1335,
  ),
  assertion(
    'candidate duration',
    near(metadata.video.durationSeconds, 44.5, 0.02),
    metadata.video.durationSeconds,
    44.5,
  ),
  assertion(
    'candidate has no rotation tag',
    metadata.video.rotationDegrees === null,
    metadata.video.rotationDegrees,
    null,
  ),
  assertion(
    'candidate colorspace',
    metadata.video.colorSpace === 'bt709',
    metadata.video.colorSpace,
    'bt709',
  ),
  assertion(
    'candidate transfer',
    metadata.video.colorTransfer === 'bt709',
    metadata.video.colorTransfer,
    'bt709',
  ),
  assertion(
    'candidate primaries',
    metadata.video.colorPrimaries === 'bt709',
    metadata.video.colorPrimaries,
    'bt709',
  ),
  assertion('segment A is fit', layouts[22].state === 'fit', layouts[22], 'fit'),
  assertion('segment B is fill', layouts[225].state === 'fill', layouts[225], 'fill'),
  assertion('segment C is fit', layouts[500].state === 'fit', layouts[500], 'fit'),
  assertion('segment D is fill', layouts[650].state === 'fill', layouts[650], 'fill'),
  assertion('segment E is fit', layouts[900].state === 'fit', layouts[900], 'fit'),
  assertion(
    'candidate silent video tail',
    near(audioTail, 1.823, 0.1),
    round(audioTail),
    '1.823 +/- 0.1 seconds',
  ),
  assertion(
    'candidate end-card mark is visible',
    endCardMarkLuma > 35,
    round(endCardMarkLuma),
    '> 35',
  ),
];

const proof = {
  schema: 'nodevideo.private-reconstruction-proof.v1',
  privacy: {
    classification: 'private-local-derivative',
    deployable: false,
    sourcePathsRecorded: false,
    outputDirectory: relative(REPO_ROOT, PRIVATE_EVIDENCE_ROOT).replaceAll('\\', '/'),
  },
  tools: {
    ffmpeg: ffmpegVersion(ffmpeg),
    ffprobe: ffprobeVersion(ffprobe),
  },
  inputs: {
    rawTakeA: { sha256: await sha256File(rawTakeA) },
    rawTakeB: { sha256: await sha256File(rawTakeB) },
    referenceOutput: { sha256: await sha256File(referenceOutput) },
  },
  output: {
    fileName: basename(output),
    sha256: await sha256File(output),
    metadata,
  },
  recipe: {
    cutFrames: [201, 482, 589, 753, 1208],
    frameCount: 1335,
    toneMap: 'HLG BT.2020 to BT.709 SDR using zscale + Mobius',
    layouts: ['fit', 'fill', 'fit', 'fill', 'fit', 'end-card'],
    sourceAudioMuted: true,
    continuousReferenceAudioUsed: true,
  },
  verification: {
    passed: assertionsPass(assertions),
    assertions,
  },
};

await writeJson(proofPath, proof);

if (!proof.verification.passed) {
  const failures = assertions
    .filter((item) => !item.pass)
    .map((item) => item.name)
    .join(', ');
  throw new Error(`Private reconstruction verification failed: ${failures}`);
}

console.log(`Private reconstruction verified at ${relative(REPO_ROOT, output)}.`);

function requiredInputPath(environmentName) {
  const configuredPath = process.env[environmentName];
  if (!configuredPath) {
    throw new Error(`Set ${environmentName} to an explicit private media path before running.`);
  }
  return resolveInputPath(configuredPath);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
