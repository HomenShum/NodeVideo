#!/usr/bin/env node

import { mkdir } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import {
  REPO_ROOT,
  assertion,
  assertionsPass,
  ffmpegVersion,
  ffprobeVersion,
  fitBandMetrics,
  layoutMetrics,
  meanAbsoluteDifference,
  near,
  probeMedia,
  rationalNumber,
  readRgbFrames,
  regionLuma,
  runText,
  sanitizeProbe,
  sha256File,
  writeJson,
} from './media-proof-lib.mjs';

const FIXTURE_ROOT = join(REPO_ROOT, 'fixtures', 'media');
const DEFAULT_OUTPUT = join(FIXTURE_ROOT, 'nodevideo-proof-v1.mp4');
const CUT_FRAMES = [45, 90, 135];
const FRAME_RATE = 30;
const VIDEO_FRAMES = 180;
const VIDEO_DURATION = 6;
const AUDIO_DURATION = 5;

const output = publicFixturePath(argumentValue('--output') ?? DEFAULT_OUTPUT);
const proofPath = `${output.slice(0, -extname(output).length)}.proof.json`;
const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe';

await mkdir(dirname(output), { recursive: true });

const filter = [
  '[0:v]format=yuv420p,split=4[fit_a_source][fill_source][fit_b_source][end_source]',
  '[fit_a_source]trim=start_frame=0:end_frame=45,setpts=N/(30*TB),scale=720:-2:flags=lanczos,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[fit_a]',
  '[fill_source]trim=start_frame=45:end_frame=90,setpts=N/(30*TB),scale=-2:1280:flags=lanczos,crop=720:1280:(iw-720)/2:0,hue=h=45,setsar=1[fill]',
  '[fit_b_source]trim=start_frame=90:end_frame=135,setpts=N/(30*TB),scale=720:-2:flags=lanczos,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black,hue=h=90,setsar=1[fit_b]',
  "[end_source]trim=start_frame=134:end_frame=135,setpts=N/(30*TB),scale=720:-2:flags=lanczos,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black,tpad=stop_mode=clone:stop_duration=1.466667,eq=brightness=-0.45,drawbox=x=292:y=572:w=136:h=136:color=white:t=10,drawbox=x=326:y=606:w=68:h=68:color=0x4fe1c1:t=fill:enable='lt(mod(t,0.5),0.25)',drawbox=x=326:y=606:w=68:h=68:color=0xff4fd8:t=fill:enable='gte(mod(t,0.5),0.25)',setsar=1[end_card]",
  '[fit_a][fill][fit_b][end_card]concat=n=4:v=1:a=0,fps=30,trim=end_frame=180,setpts=N/(30*TB),format=yuv420p[outv]',
].join(';');

runText(ffmpeg, [
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=1916x1078:rate=30:duration=4.5',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=523.25:sample_rate=48000:duration=5,volume=0.12',
  '-filter_complex',
  filter,
  '-map',
  '[outv]',
  '-map',
  '1:a:0',
  '-map_metadata',
  '-1',
  '-c:v',
  'libx264',
  '-preset',
  'medium',
  '-crf',
  '25',
  '-threads',
  '1',
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
  '96k',
  '-ar',
  '48000',
  '-movflags',
  '+faststart',
  output,
]);

const metadata = sanitizeProbe(probeMedia(output, ffprobe));
const frames = readRgbFrames(output, [22, 44, 45, 67, 89, 90, 112, 134, 135, 157], { ffmpeg });
const fitA = layoutMetrics(frames.get(22));
const fill = layoutMetrics(frames.get(67));
const fitB = layoutMetrics(frames.get(112));
const band = fitBandMetrics(frames.get(22));
const endCardLuma = regionLuma(frames.get(157), 180, {
  xStart: 72,
  xEnd: 108,
  yStart: 142,
  yEnd: 178,
});
const audioTail = metadata.video.durationSeconds - metadata.audio.durationSeconds;

const assertions = [
  assertion('fixture width', metadata.video.codedWidth === 720, metadata.video.codedWidth, 720),
  assertion(
    'fixture height',
    metadata.video.codedHeight === 1280,
    metadata.video.codedHeight,
    1280,
  ),
  assertion(
    'fixture frame rate',
    near(rationalNumber(metadata.video.averageFrameRate), FRAME_RATE, 0.0001),
    rationalNumber(metadata.video.averageFrameRate),
    FRAME_RATE,
  ),
  assertion(
    'fixture frame count',
    metadata.video.frameCount === VIDEO_FRAMES,
    metadata.video.frameCount,
    VIDEO_FRAMES,
  ),
  assertion(
    'fixture duration',
    near(metadata.video.durationSeconds, VIDEO_DURATION, 0.02),
    metadata.video.durationSeconds,
    VIDEO_DURATION,
  ),
  assertion(
    'fixture has no rotation tag',
    metadata.video.rotationDegrees === null,
    metadata.video.rotationDegrees,
    null,
  ),
  assertion(
    'fixture is 8-bit 4:2:0',
    metadata.video.pixelFormat === 'yuv420p',
    metadata.video.pixelFormat,
    'yuv420p',
  ),
  assertion(
    'fixture colorspace',
    metadata.video.colorSpace === 'bt709',
    metadata.video.colorSpace,
    'bt709',
  ),
  assertion(
    'fixture transfer',
    metadata.video.colorTransfer === 'bt709',
    metadata.video.colorTransfer,
    'bt709',
  ),
  assertion(
    'fixture primaries',
    metadata.video.colorPrimaries === 'bt709',
    metadata.video.colorPrimaries,
    'bt709',
  ),
  assertion(
    'fixture audio duration',
    near(metadata.audio.durationSeconds, AUDIO_DURATION, 0.08),
    metadata.audio.durationSeconds,
    AUDIO_DURATION,
  ),
  assertion('fixture silent video tail', near(audioTail, 1, 0.08), audioTail, 1),
  assertion('frame 22 uses fit geometry', fitA.state === 'fit', fitA, 'fit'),
  assertion('frame 67 uses fill geometry', fill.state === 'fill', fill, 'fill'),
  assertion('frame 112 returns to fit geometry', fitB.state === 'fit', fitB, 'fit'),
  assertion('fit band starts near y=437', near(band.top, 437, 8), band.top, '437 +/- 8'),
  assertion('fit band ends near y=842', near(band.bottom, 842, 8), band.bottom, '842 +/- 8'),
  assertion(
    'cut at frame 45 is visible',
    meanAbsoluteDifference(frames.get(44), frames.get(45)) > 10,
    meanAbsoluteDifference(frames.get(44), frames.get(45)),
    '> 10',
  ),
  assertion(
    'cut at frame 90 is visible',
    meanAbsoluteDifference(frames.get(89), frames.get(90)) > 10,
    meanAbsoluteDifference(frames.get(89), frames.get(90)),
    '> 10',
  ),
  assertion(
    'end-card cut at frame 135 is visible',
    meanAbsoluteDifference(frames.get(134), frames.get(135)) > 5,
    meanAbsoluteDifference(frames.get(134), frames.get(135)),
    '> 5',
  ),
  assertion(
    'end-card mark is visible',
    endCardLuma > 35,
    Math.round(endCardLuma * 100) / 100,
    '> 35',
  ),
];

const proof = {
  schema: 'nodevideo.synthetic-media-proof.v1',
  privacy: {
    classification: 'public-synthetic',
    containsPersonalMedia: false,
    source: 'FFmpeg lavfi testsrc2 and sine only',
  },
  recipe: {
    canvas: { width: 720, height: 1280, frameRate: 30 },
    durationSeconds: VIDEO_DURATION,
    audioDurationSeconds: AUDIO_DURATION,
    silentTailSeconds: VIDEO_DURATION - AUDIO_DURATION,
    cutFrames: {
      fitToFill: CUT_FRAMES[0],
      fillToFit: CUT_FRAMES[1],
      fitToEndCard: CUT_FRAMES[2],
    },
    segments: [
      { startFrame: 0, endFrameExclusive: 45, layout: 'fit' },
      { startFrame: 45, endFrameExclusive: 90, layout: 'fill' },
      { startFrame: 90, endFrameExclusive: 135, layout: 'fit' },
      { startFrame: 135, endFrameExclusive: 180, layout: 'end-card' },
    ],
    fit: {
      source: { width: 1916, height: 1078 },
      scaled: { width: 720, height: 406 },
      placement: { x: 0, y: 437 },
    },
    fill: {
      source: { width: 1916, height: 1078 },
      scaledHeight: 1280,
      crop: { width: 720, height: 1280, anchor: 'center' },
    },
  },
  tools: {
    ffmpeg: ffmpegVersion(ffmpeg),
    ffprobe: ffprobeVersion(ffprobe),
  },
  media: {
    path: relative(REPO_ROOT, output).replaceAll('\\', '/'),
    sha256: await sha256File(output),
    metadata,
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
  throw new Error(`Synthetic fixture verification failed: ${failures}`);
}

console.log(`Generated ${relative(REPO_ROOT, output)}`);
console.log(`Verified ${relative(REPO_ROOT, proofPath)}`);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function publicFixturePath(value) {
  const candidate = resolve(value);
  const inside = relative(FIXTURE_ROOT, candidate);
  if (inside === '' || (!inside.startsWith(`..${sep}`) && inside !== '..')) {
    return candidate;
  }
  throw new Error('Synthetic public fixtures must stay under fixtures/media.');
}
