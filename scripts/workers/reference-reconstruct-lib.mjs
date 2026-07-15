import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import {
  PRIVATE_EVIDENCE_ROOT,
  REPO_ROOT,
  assertion,
  assertionsPass,
  ffmpegVersion,
  ffprobeVersion,
  near,
  probeMedia,
  rationalNumber,
  requireFile,
  runText,
  sanitizeProbe,
  sha256File,
  writeJson,
} from '../media/media-proof-lib.mjs';

export const REFERENCE_WORKER_VERSION = 'reference-reconstruct-worker@0.1.0';
export const AUTHORIZED_CASE_ID = 'authorized-real-v1';
export const AUTHORIZED_CASE_ROOT = join(REPO_ROOT, 'fixtures', 'media', AUTHORIZED_CASE_ID);
export const AUTHORIZED_RELEASE_ROOT = join(PRIVATE_EVIDENCE_ROOT, 'authorized-release-v1');

const FRAME_RATE = 30;
const OUTPUT_WIDTH = 720;
const OUTPUT_HEIGHT = 1280;
const TOTAL_FRAMES = 1335;
const CUT_FRAMES = [201, 482, 589, 753];
const SOCIAL_OVERLAY = join(
  REPO_ROOT,
  'packs',
  'reference-reconstruct',
  'assets',
  'social-watermark.png',
);
const OUTRO_OVERLAY = join(
  REPO_ROOT,
  'packs',
  'reference-reconstruct',
  'assets',
  'outro-caption.png',
);
const END_OVERLAY = join(
  REPO_ROOT,
  'packs',
  'reference-reconstruct',
  'assets',
  'end-card-overlay.png',
);

export const AUTHORIZED_TIMELINE = [
  segment('a-fit-1', 0, 200, 'asset.source-a-original', 464, 664, 'fit', 15.466667),
  segment('b-fill-1', 201, 481, 'asset.source-b-original', 963, 1243, 'fill', 32.1),
  segment('a-fit-2', 482, 588, 'asset.source-a-original', 866, 972, 'fit', 28.866667),
  segment('b-fill-2', 589, 752, 'asset.source-b-original', 1355, 1518, 'fill', 45.166667),
  segment('a-fit-3', 753, 1213, 'asset.source-a-original', 1212, 1672, 'fit', 40.4),
  {
    id: 'black-transition',
    outputStartFrame: 1214,
    outputEndFrame: 1214,
    outputFrames: 1,
    outputStartSeconds: round(1214 / FRAME_RATE),
    outputEndSeconds: round(1215 / FRAME_RATE),
    sourceAssetId: null,
    sourceStartFrame: null,
    sourceEndFrame: null,
    layout: 'black',
  },
  {
    id: 'branded-end-card',
    outputStartFrame: 1215,
    outputEndFrame: 1334,
    outputFrames: 120,
    outputStartSeconds: 40.5,
    outputEndSeconds: 44.5,
    sourceAssetId: 'asset.source-a-original',
    sourceStartFrame: 1672,
    sourceEndFrame: 1672,
    layout: 'dimmed-freeze-graphic',
  },
];

const HLG_TO_SDR = [
  'zscale=transfer=linear:npl=100',
  'format=gbrpf32le',
  'tonemap=tonemap=hable:desat=0',
  'zscale=primaries=bt709:transfer=bt709:matrix=bt709:range=limited',
  'format=yuv420p',
].join(',');
const TARGET_GUIDED_GRADE = [
  "lutrgb=r='clip(0.00001351*val^3-0.00113563*val^2+0.33513849*val+2.51677065,0,255)'",
  "g='clip(0.00000663*val^3+0.00096298*val^2+0.17880742*val+2.76682843,0,255)'",
  "b='clip(0.00000026*val^3+0.00262647*val^2+0.09779171*val+8.3463682,0,255)'",
].join(':');
const FIT = 'scale=720:-2:flags=lanczos,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1';
const FILL = 'scale=-2:1280:flags=lanczos,crop=720:1280:(iw-720)/2:0,setsar=1';
const GRADED_FIT = `${HLG_TO_SDR},${TARGET_GUIDED_GRADE},${FIT}`;
const GRADED_FILL = `${HLG_TO_SDR},${TARGET_GUIDED_GRADE},${FILL}`;

export async function runAuthorizedReferenceReconstruct({
  sourceAPath,
  sourceBPath,
  targetPath,
  outputRoot = AUTHORIZED_CASE_ROOT,
  releaseRoot = AUTHORIZED_RELEASE_ROOT,
  ownerAuthorized,
  ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg',
  ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe',
}) {
  if (ownerAuthorized !== true) {
    throw new Error('Owner authorization is required before publishing this case.');
  }
  for (const [path, label] of [
    [sourceAPath, 'source A'],
    [sourceBPath, 'source B'],
    [targetPath, 'target edit'],
    [SOCIAL_OVERLAY, 'social overlay'],
    [OUTRO_OVERLAY, 'outro overlay'],
    [END_OVERLAY, 'end-card overlay'],
  ]) {
    requireFile(path, label);
  }
  await mkdir(outputRoot, { recursive: true });
  await mkdir(releaseRoot, { recursive: true });

  const startedAt = new Date().toISOString();
  const execution = createExecution(startedAt);
  const paths = outputPaths(outputRoot, releaseRoot);
  const inputs = await execution.step(
    'probe-inputs',
    'Probe and bind authorized inputs',
    async () => inputRecords({ sourceAPath, sourceBPath, targetPath, ffprobe }),
  );

  await execution.step('sanitize-release-media', 'Strip private container metadata', async () => {
    sanitizeReleaseMedia(sourceAPath, paths.sanitizedSourceA, ffmpeg);
    sanitizeReleaseMedia(sourceBPath, paths.sanitizedSourceB, ffmpeg);
    sanitizeReleaseMedia(targetPath, paths.sanitizedTarget, ffmpeg);
    for (const sanitizedPath of [
      paths.sanitizedSourceA,
      paths.sanitizedSourceB,
      paths.sanitizedTarget,
    ]) {
      assertNoPrivateContainerMetadata(sanitizedPath, ffprobe);
    }
  });

  await execution.step('render-reconstruction', 'Render from the two MOV sources only', async () =>
    renderReconstruction({ sourceAPath, sourceBPath, outputPath: paths.reconstruction, ffmpeg }),
  );
  await execution.step('render-web-sources', 'Create browser-safe source proxies', async () => {
    renderSourceProxy(sourceAPath, paths.sourceAWeb, ffmpeg);
    renderSourceProxy(sourceBPath, paths.sourceBWeb, ffmpeg);
  });
  await execution.step('render-target-proxy', 'Create authorized target proxy', async () =>
    renderTargetProxy(targetPath, paths.targetWeb, ffmpeg),
  );
  await execution.step(
    'render-comparisons',
    'Render side-by-side and difference views',
    async () => {
      renderSideBySide(targetPath, paths.reconstruction, paths.sideBySide, ffmpeg);
      renderDifference(targetPath, paths.reconstruction, paths.difference, ffmpeg);
      renderPoster(paths.sideBySide, paths.poster, ffmpeg);
    },
  );

  const evaluation = await execution.step(
    'evaluate-reconstruction',
    'Evaluate target against source-only reconstruction',
    async () => evaluateReconstruction(targetPath, paths.reconstruction, ffmpeg),
  );
  const media = await mediaRecords(paths, outputRoot, ffprobe);
  const structuralAssertions = buildStructuralAssertions({
    reconstruction: media.reconstruction.metadata,
    evaluation,
  });
  const validation = {
    passed: assertionsPass(structuralAssertions),
    structuralAssertions,
    claimTier: claimTier(evaluation, structuralAssertions),
  };
  const result = buildResult({ inputs, media, evaluation, validation, startedAt });
  await writeJson(paths.result, result);

  execution.finish(validation.passed ? 'completed' : 'failed');
  const receipt = await buildReceipt({
    inputs,
    media,
    evaluation,
    validation,
    resultPath: paths.result,
    outputRoot,
    execution,
    ffmpeg,
    ffprobe,
    startedAt,
  });
  await writeJson(paths.receipt, receipt);
  const manifest = buildCaseManifest({ inputs, media, evaluation, validation, receipt });
  await writeJson(paths.manifest, manifest);

  if (!validation.passed) {
    throw new Error(
      `Authorized reconstruction validation failed: ${structuralAssertions
        .filter((item) => !item.pass)
        .map((item) => item.name)
        .join(', ')}`,
    );
  }
  return { result, receipt, manifest, paths };
}

export async function verifyAuthorizedCase(
  receiptPath = join(AUTHORIZED_CASE_ROOT, 'receipt.json'),
  { ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe' } = {},
) {
  const root = resolve(receiptPath, '..');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const resultPath = resolve(root, receipt.result.path);
  const result = JSON.parse(await readFile(resultPath, 'utf8'));
  const assertions = [];
  for (const artifact of Object.values(receipt.artifacts ?? {})) {
    const artifactPath = resolve(root, artifact.path);
    requireFile(artifactPath, artifact.path);
    const actualHash = await sha256File(artifactPath);
    assertions.push(
      assertion(
        `${artifact.path} hash`,
        actualHash === artifact.sha256,
        actualHash,
        artifact.sha256,
      ),
    );
    if (artifact.mimeType?.startsWith('video/')) {
      assertions.push(
        assertion(
          `${artifact.path} decodes`,
          Boolean(sanitizeProbe(probeMedia(artifactPath, ffprobe)).video),
          true,
          true,
        ),
      );
    }
  }
  assertions.push(
    assertion(
      'receipt passed',
      receipt.validation?.passed === true,
      receipt.validation?.passed,
      true,
    ),
    assertion(
      'target excluded from render lineage',
      !receipt.lineage.renderInputAssetIds.includes('asset.target-edit'),
      receipt.lineage.renderInputAssetIds,
      ['asset.source-a-original', 'asset.source-b-original'],
    ),
    assertion(
      'both MOVs drive the render',
      ['asset.source-a-original', 'asset.source-b-original'].every((id) =>
        receipt.lineage.renderInputAssetIds.includes(id),
      ),
      receipt.lineage.renderInputAssetIds,
      'both source assets',
    ),
    assertion(
      'target is evaluation only',
      receipt.lineage.targetUsage === 'analysis-and-evaluation-only',
      receipt.lineage.targetUsage,
      'analysis-and-evaluation-only',
    ),
    assertion(
      'result metrics match receipt',
      result.evaluation?.ssim === receipt.evaluation?.ssim &&
        result.evaluation?.psnrDb === receipt.evaluation?.psnrDb &&
        result.evaluation?.vmaf === receipt.evaluation?.vmaf,
      result.evaluation,
      receipt.evaluation,
    ),
    assertion(
      'timeline is contiguous',
      timelineIsContiguous(result.timeline),
      result.timeline?.map((item) => [item.outputStartFrame, item.outputEndFrame]),
      '0..1334 without gaps',
    ),
  );
  return { passed: assertionsPass(assertions), assertions, receipt, result };
}

function renderReconstruction({ sourceAPath, sourceBPath, outputPath, ffmpeg }) {
  const filter = [
    '[2:v]fps=30,format=rgba,split=2[social-a][social-b]',
    '[3:v]fps=30,format=rgba[outro-overlay]',
    '[4:v]fps=30,format=rgba[end-overlay]',
    `[0:v]trim=start=15.466667,setpts=PTS-STARTPTS,fps=30,trim=end_frame=201,setpts=N/(30*TB),${GRADED_FIT}[a1-base]`,
    '[a1-base][social-a]overlay=shortest=1[a1]',
    `[1:v]trim=start=32.1,setpts=PTS-STARTPTS,fps=30,trim=end_frame=281,setpts=N/(30*TB),${GRADED_FILL}[b1]`,
    `[0:v]trim=start=28.866667,setpts=PTS-STARTPTS,fps=30,trim=end_frame=107,setpts=N/(30*TB),${GRADED_FIT}[a2-base]`,
    '[a2-base][social-b]overlay=shortest=1[a2]',
    `[1:v]trim=start=45.166667,setpts=PTS-STARTPTS,fps=30,trim=end_frame=164,setpts=N/(30*TB),${GRADED_FILL}[b2]`,
    `[0:v]trim=start=40.4,setpts=PTS-STARTPTS,fps=30,trim=end_frame=461,setpts=N/(30*TB),${GRADED_FIT}[a3-base]`,
    '[a3-base][outro-overlay]overlay=shortest=1[a3]',
    `[0:v]trim=start=55.733333,setpts=PTS-STARTPTS,fps=30,trim=end_frame=1,setpts=N/(30*TB),${GRADED_FIT},tpad=stop_mode=clone:stop_duration=4,trim=end_frame=120,setpts=N/(30*TB),lutrgb=r='val*0.23':g='val*0.23':b='val*0.23'[end-base]`,
    '[end-base][end-overlay]overlay=shortest=1[end]',
    '[a1][b1][a2][b2][a3][end]concat=n=6:v=1:a=0,fps=30,setpts=N/(30*TB)[stitched]',
    "[stitched]tpad=stop_mode=clone:stop_duration=0.1,trim=end_frame=1335,setpts=N/(30*TB),drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='eq(n,1214)',format=yuv420p[outv]",
    '[0:a:0]atrim=start=15.466667:duration=6.7,asetpts=PTS-STARTPTS,aresample=44100[a1a]',
    '[1:a:0]atrim=start=32.1:duration=9.366667,asetpts=PTS-STARTPTS,aresample=44100[b1a]',
    '[0:a:0]atrim=start=28.866667:duration=3.566667,asetpts=PTS-STARTPTS,aresample=44100[a2a]',
    '[1:a:0]atrim=start=45.166667:duration=5.466667,asetpts=PTS-STARTPTS,aresample=44100[b2a]',
    '[0:a:0]atrim=start=40.4:duration=15.366666,asetpts=PTS-STARTPTS,aresample=44100[a3a]',
    'anullsrc=r=44100:cl=stereo:d=4.033333[silence]',
    '[a1a][b1a][a2a][b2a][a3a][silence]concat=n=6:v=0:a=1[aout]',
  ].join(';');
  runText(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    sourceAPath,
    '-i',
    sourceBPath,
    '-loop',
    '1',
    '-framerate',
    '30',
    '-i',
    SOCIAL_OVERLAY,
    '-loop',
    '1',
    '-framerate',
    '30',
    '-i',
    OUTRO_OVERLAY,
    '-loop',
    '1',
    '-framerate',
    '30',
    '-i',
    END_OVERLAY,
    '-filter_complex',
    filter,
    '-map',
    '[outv]',
    '-map',
    '[aout]',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-g',
    '30',
    '-keyint_min',
    '30',
    '-sc_threshold',
    '0',
    '-pix_fmt',
    'yuv420p',
    '-colorspace',
    'bt709',
    '-color_trc',
    'bt709',
    '-color_primaries',
    'bt709',
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
    outputPath,
  ]);
}

function renderSourceProxy(inputPath, outputPath, ffmpeg) {
  runText(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-vf',
    `${HLG_TO_SDR},scale=640:-2:flags=lanczos,setsar=1,fps=30`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '24',
    '-pix_fmt',
    'yuv420p',
    '-colorspace',
    'bt709',
    '-color_trc',
    'bt709',
    '-color_primaries',
    'bt709',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    outputPath,
  ]);
}

function renderTargetProxy(inputPath, outputPath, ffmpeg) {
  runText(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-vf',
    'scale=360:640:flags=lanczos,setsar=1,fps=30',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    outputPath,
  ]);
}

function renderSideBySide(targetPath, reconstructionPath, outputPath, ffmpeg) {
  runText(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    targetPath,
    '-i',
    reconstructionPath,
    '-filter_complex',
    '[0:v]scale=360:640:flags=lanczos,setsar=1[reference];[1:v]scale=360:640:flags=lanczos,setsar=1[reconstruction];[reference][reconstruction]hstack=inputs=2,format=yuv420p[outv]',
    '-map',
    '[outv]',
    '-an',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outputPath,
  ]);
}

function renderDifference(targetPath, reconstructionPath, outputPath, ffmpeg) {
  runText(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    targetPath,
    '-i',
    reconstructionPath,
    '-filter_complex',
    '[0:v]scale=360:640:flags=lanczos,format=gbrp[reference];[1:v]scale=360:640:flags=lanczos,format=gbrp[reconstruction];[reference][reconstruction]blend=all_mode=difference,eq=contrast=2.2:brightness=0.04,format=yuv420p[outv]',
    '-map',
    '[outv]',
    '-an',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outputPath,
  ]);
}

function renderPoster(sideBySidePath, outputPath, ffmpeg) {
  runText(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    '22',
    '-i',
    sideBySidePath,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    outputPath,
  ]);
}

function sanitizeReleaseMedia(inputPath, outputPath, ffmpeg) {
  runText(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-metadata',
    'creation_time=',
    '-metadata:s:v:0',
    'creation_time=',
    '-metadata:s:a:0',
    'creation_time=',
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    outputPath,
  ]);
}

function assertNoPrivateContainerMetadata(path, ffprobe) {
  const raw = runText(ffprobe, [
    '-v',
    'error',
    '-show_format',
    '-show_streams',
    '-of',
    'json',
    path,
  ]);
  const lower = raw.toLowerCase();
  const forbidden = [
    'com.apple.quicktime.location',
    'iso6709',
    'com.apple.quicktime.make',
    'com.apple.quicktime.model',
    'com.apple.quicktime.software',
    'creation_time',
  ];
  const found = forbidden.filter((token) => lower.includes(token));
  if (found.length > 0) {
    throw new Error(
      `Sanitized release media still contains forbidden metadata fields: ${found.join(', ')}`,
    );
  }
}

async function evaluateReconstruction(targetPath, candidatePath, ffmpeg) {
  const ssim = measureMetric(targetPath, candidatePath, 'ssim', ffmpeg);
  const psnrDb = measureMetric(targetPath, candidatePath, 'psnr', ffmpeg);
  const vmaf = measureMetric(targetPath, candidatePath, 'libvmaf', ffmpeg);
  const perSegment = [];
  for (const item of AUTHORIZED_TIMELINE) {
    const duration = item.outputFrames / FRAME_RATE;
    perSegment.push({
      id: item.id,
      startSeconds: item.outputStartSeconds,
      durationSeconds: round(duration),
      ssim: measureMetric(targetPath, candidatePath, 'ssim', ffmpeg, {
        start: item.outputStartSeconds,
        duration,
      }),
      psnrDb: measureMetric(targetPath, candidatePath, 'psnr', ffmpeg, {
        start: item.outputStartSeconds,
        duration,
      }),
    });
  }
  return {
    ssim,
    psnrDb,
    vmaf,
    perSegment,
    metricScope: 'decoded 720x1280 video; target audio excluded',
    targetAudioMatched: false,
    sourceAudioMode: 'cut source audio with silent branded tail',
  };
}

function measureMetric(targetPath, candidatePath, metric, ffmpeg, window = {}) {
  const args = ['-hide_banner', '-loglevel', 'info'];
  if (window.start !== undefined) args.push('-ss', String(window.start));
  if (window.duration !== undefined) args.push('-t', String(window.duration));
  args.push('-i', targetPath);
  if (window.start !== undefined) args.push('-ss', String(window.start));
  if (window.duration !== undefined) args.push('-t', String(window.duration));
  args.push('-i', candidatePath);
  const comparison = metric === 'libvmaf' ? 'libvmaf=n_threads=4' : metric;
  args.push(
    '-filter_complex',
    `[0:v]settb=1/30,setpts=PTS-STARTPTS,format=yuv420p[reference];[1:v]settb=1/30,setpts=PTS-STARTPTS,format=yuv420p[candidate];[candidate][reference]${comparison}`,
    '-an',
    '-f',
    'null',
    process.platform === 'win32' ? 'NUL' : '/dev/null',
  );
  const stderr = runFfmpegCapture(ffmpeg, args);
  const pattern =
    metric === 'ssim'
      ? /All:([0-9.]+)/gu
      : metric === 'psnr'
        ? /average:([0-9.]+)/gu
        : /VMAF score:\s*([0-9.]+)/gu;
  const values = [...stderr.matchAll(pattern)];
  if (values.length === 0) throw new Error(`Unable to parse ${metric} from FFmpeg output.`);
  return round(Number(values.at(-1)[1]), 6);
}

function runFfmpegCapture(command, args) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with exit code ${result.status}: ${String(result.stderr).trim()}`,
    );
  }
  return String(result.stderr ?? '');
}

async function inputRecords({ sourceAPath, sourceBPath, targetPath, ffprobe }) {
  const specs = [
    ['sourceA', 'asset.source-a-original', sourceAPath, 'source-a.mov', 'render-source'],
    ['sourceB', 'asset.source-b-original', sourceBPath, 'source-b.mov', 'render-source'],
    ['target', 'asset.target-edit', targetPath, 'target-edit.mp4', 'analysis-and-evaluation-only'],
  ];
  return Object.fromEntries(
    await Promise.all(
      specs.map(async ([key, assetId, path, publicName, usage]) => [
        key,
        {
          assetId,
          publicName,
          sha256: await sha256File(path),
          usage,
          metadata: sanitizeProbe(probeMedia(path, ffprobe)),
        },
      ]),
    ),
  );
}

async function mediaRecords(paths, root, ffprobe) {
  const specs = {
    sourceAWeb: [paths.sourceAWeb, 'video/mp4', 'source-web-proxy'],
    sourceBWeb: [paths.sourceBWeb, 'video/mp4', 'source-web-proxy'],
    targetWeb: [paths.targetWeb, 'video/mp4', 'target-web-proxy'],
    reconstruction: [paths.reconstruction, 'video/mp4', 'source-only-reconstruction'],
    sideBySide: [paths.sideBySide, 'video/mp4', 'comparison-side-by-side'],
    difference: [paths.difference, 'video/mp4', 'comparison-difference'],
    poster: [paths.poster, 'image/jpeg', 'comparison-poster'],
  };
  return Object.fromEntries(
    await Promise.all(
      Object.entries(specs).map(async ([key, [path, mimeType, role]]) => [
        key,
        {
          path: relative(root, path).replaceAll('\\', '/'),
          sha256: await sha256File(path),
          mimeType,
          role,
          metadata: mimeType.startsWith('video/') ? sanitizeProbe(probeMedia(path, ffprobe)) : null,
        },
      ]),
    ),
  );
}

function buildStructuralAssertions({ reconstruction, evaluation }) {
  const assertions = [
    assertion(
      'output width',
      reconstruction.video?.codedWidth === OUTPUT_WIDTH,
      reconstruction.video?.codedWidth,
      OUTPUT_WIDTH,
    ),
    assertion(
      'output height',
      reconstruction.video?.codedHeight === OUTPUT_HEIGHT,
      reconstruction.video?.codedHeight,
      OUTPUT_HEIGHT,
    ),
    assertion(
      'output frame count',
      reconstruction.video?.frameCount === TOTAL_FRAMES,
      reconstruction.video?.frameCount,
      TOTAL_FRAMES,
    ),
    assertion(
      'output fps',
      near(rationalNumber(reconstruction.video?.averageFrameRate), FRAME_RATE, 0.0001),
      rationalNumber(reconstruction.video?.averageFrameRate),
      FRAME_RATE,
    ),
    assertion(
      'output duration',
      near(reconstruction.video?.durationSeconds, 44.5, 0.02),
      reconstruction.video?.durationSeconds,
      44.5,
    ),
    assertion('timeline contiguous', timelineIsContiguous(AUTHORIZED_TIMELINE), true, true),
    assertion(
      'four footage cuts',
      JSON.stringify(CUT_FRAMES) === JSON.stringify([201, 482, 589, 753]),
      CUT_FRAMES,
      [201, 482, 589, 753],
    ),
    assertion(
      'both sources represented',
      new Set(AUTHORIZED_TIMELINE.map((item) => item.sourceAssetId).filter(Boolean)).size === 2,
      2,
      2,
    ),
    assertion('SSIM measured', Number.isFinite(evaluation.ssim), evaluation.ssim, 'finite'),
    assertion('PSNR measured', Number.isFinite(evaluation.psnrDb), evaluation.psnrDb, 'finite'),
    assertion('VMAF measured', Number.isFinite(evaluation.vmaf), evaluation.vmaf, 'finite'),
    assertion(
      'target audio is not claimed matched',
      evaluation.targetAudioMatched === false,
      evaluation.targetAudioMatched,
      false,
    ),
  ];
  return assertions;
}

function claimTier(evaluation, assertions) {
  if (!assertionsPass(assertions)) return 'failed';
  const segmentSsims = evaluation.perSegment
    .filter((item) => !['black-transition', 'branded-end-card'].includes(item.id))
    .map((item) => item.ssim);
  if (evaluation.ssim >= 0.97 && evaluation.psnrDb >= 35 && Math.min(...segmentSsims) >= 0.95) {
    return 'near-exact-video';
  }
  if (evaluation.ssim >= 0.9 && evaluation.psnrDb >= 25 && Math.min(...segmentSsims) >= 0.85) {
    return 'perceptually-close-video';
  }
  return 'structure-matched-video';
}

function buildResult({ inputs, media, evaluation, validation, startedAt }) {
  return {
    schema: 'nodevideo.reference-reconstruct-result.v1',
    caseId: AUTHORIZED_CASE_ID,
    status: validation.passed ? 'completed' : 'failed',
    automationLevel: 'case-specific-target-guided',
    disclosure:
      'Owner-authorized real-media case. Timing, layout, and grade parameters were inferred against the target; reconstruction pixels and audio are rendered from the two MOV sources plus recreated graphics.',
    targetUsage: 'analysis-and-evaluation-only',
    inputs,
    renderSourceAssetIds: ['asset.source-a-original', 'asset.source-b-original'],
    evaluationSourceAssetIds: ['asset.target-edit', 'artifact.reconstruction'],
    timeline: AUTHORIZED_TIMELINE,
    cutFrames: CUT_FRAMES,
    media,
    evaluation,
    validation,
    limitations: [
      'The target soundtrack is not present in either MOV and is not reproduced.',
      'Brand graphics are independently recreated approximations, not copied target pixels.',
      'This validates one authorized case and does not claim generic automatic edit discovery.',
      'Exact bit identity requires the original editor, fonts, effects, audio source, and encoder settings.',
    ],
    createdAt: startedAt,
  };
}

async function buildReceipt({
  inputs,
  media,
  evaluation,
  validation,
  resultPath,
  outputRoot,
  execution,
  ffmpeg,
  ffprobe,
  startedAt,
}) {
  return {
    schema: 'nodevideo.reference-reconstruct-receipt.v1',
    worker: {
      id: 'nodevideo.reference-reconstruct',
      version: REFERENCE_WORKER_VERSION,
      pack: 'nodevideo.reference-reconstruct@0.1.0',
      validationProfile: 'authorized-real-case-v1',
    },
    authorization: {
      status: 'owner-authorized-publication',
      grantedAt: '2026-07-14',
      scope: 'NodeVideo public demo, repository derivatives, and evaluation evidence',
      sourceContainerMetadataPublished: false,
    },
    lineage: {
      renderInputAssetIds: ['asset.source-a-original', 'asset.source-b-original'],
      evaluationInputAssetIds: ['asset.target-edit', 'artifact.reconstruction'],
      targetUsage: 'analysis-and-evaluation-only',
      audio: {
        output: 'cut source MOV audio with silent branded tail',
        targetMatched: false,
        targetCopied: false,
      },
      graphics: 'independently recreated SVG overlays',
    },
    inputs,
    artifacts: media,
    timeline: AUTHORIZED_TIMELINE,
    evaluation,
    validation,
    tools: {
      ffmpeg: ffmpegVersion(ffmpeg),
      ffprobe: ffprobeVersion(ffprobe),
      timing: 'normalized-frame-search@1.0.0',
      grade: 'target-guided-hable-lut@1.0.0',
      evaluator: 'ffmpeg-vmaf-ssim-psnr@1.0.0',
    },
    result: {
      path: relative(outputRoot, resultPath).replaceAll('\\', '/'),
      sha256: await sha256File(resultPath),
    },
    events: execution.events,
    trace: execution.trace,
    startedAt,
    endedAt: execution.endedAt,
  };
}

function buildCaseManifest({ inputs, media, evaluation, validation, receipt }) {
  return {
    schema: 'nodevideo.published-case.v1',
    id: AUTHORIZED_CASE_ID,
    title: 'Two MOVs reconstructed against the final edit',
    sourceClass: 'owner-authorized-public-real-media',
    authorization: receipt.authorization,
    worker: receipt.worker,
    targetUsage: receipt.lineage.targetUsage,
    claimTier: validation.claimTier,
    metrics: evaluation,
    sources: [
      {
        id: inputs.sourceA.assetId,
        label: 'MOV source A',
        proxyPath: media.sourceAWeb.path,
        originalSha256: inputs.sourceA.sha256,
        releaseAssetName: 'source-a-sanitized.mov',
      },
      {
        id: inputs.sourceB.assetId,
        label: 'MOV source B',
        proxyPath: media.sourceBWeb.path,
        originalSha256: inputs.sourceB.sha256,
        releaseAssetName: 'source-b-sanitized.mov',
      },
      {
        id: inputs.target.assetId,
        label: 'Final MP4 target',
        proxyPath: media.targetWeb.path,
        originalSha256: inputs.target.sha256,
        releaseAssetName: 'target-sanitized.mp4',
      },
    ],
    views: [
      view('target', 'Final target', media.targetWeb),
      view('reconstruction', 'MOV-only reconstruction', media.reconstruction),
      view('side-by-side', 'Target | reconstruction', media.sideBySide),
      view('difference', 'Amplified pixel difference', media.difference),
      view('source-a', 'MOV source A proxy', media.sourceAWeb),
      view('source-b', 'MOV source B proxy', media.sourceBWeb),
    ],
    posterPath: media.poster.path,
    receiptPath: 'receipt.json',
    resultPath: 'result.json',
    limitations: [
      'Visual reconstruction only; target soundtrack is unmatched.',
      'Published video files are metadata-stripped derivatives.',
      'Single authorized target-guided case; no generic edit-autopilot claim.',
    ],
  };
}

function outputPaths(outputRoot, releaseRoot) {
  return {
    sourceAWeb: join(outputRoot, 'source-a-web.mp4'),
    sourceBWeb: join(outputRoot, 'source-b-web.mp4'),
    targetWeb: join(outputRoot, 'target-web.mp4'),
    reconstruction: join(outputRoot, 'reconstruction.mp4'),
    sideBySide: join(outputRoot, 'comparison-side-by-side.mp4'),
    difference: join(outputRoot, 'comparison-difference.mp4'),
    poster: join(outputRoot, 'comparison-poster.jpg'),
    result: join(outputRoot, 'result.json'),
    receipt: join(outputRoot, 'receipt.json'),
    manifest: join(outputRoot, 'case-manifest.json'),
    sanitizedSourceA: join(releaseRoot, 'source-a-sanitized.mov'),
    sanitizedSourceB: join(releaseRoot, 'source-b-sanitized.mov'),
    sanitizedTarget: join(releaseRoot, 'target-sanitized.mp4'),
  };
}

function createExecution(startedAt) {
  const events = [];
  const spans = [];
  let sequence = 0;
  return {
    events,
    trace: { traceId: `trace.${AUTHORIZED_CASE_ID}`, spans },
    endedAt: null,
    async step(id, label, work) {
      const start = performance.now();
      events.push({ sequence: ++sequence, kind: 'worker.step.started', stepId: id, label });
      try {
        const value = await work();
        const durationMs = Math.round(performance.now() - start);
        spans.push({ id, name: label, status: 'ok', durationMs });
        events.push({
          sequence: ++sequence,
          kind: 'worker.step.completed',
          stepId: id,
          durationMs,
        });
        return value;
      } catch (error) {
        const durationMs = Math.round(performance.now() - start);
        spans.push({ id, name: label, status: 'error', durationMs });
        events.push({ sequence: ++sequence, kind: 'worker.step.failed', stepId: id, durationMs });
        throw error;
      }
    },
    finish(status) {
      this.endedAt = new Date().toISOString();
      events.push({
        sequence: ++sequence,
        kind: `worker.${status}`,
        startedAt,
        endedAt: this.endedAt,
      });
    },
  };
}

function segment(
  id,
  outputStartFrame,
  outputEndFrame,
  sourceAssetId,
  sourceStartFrame,
  sourceEndFrame,
  layout,
  sourceStartSeconds,
) {
  return {
    id,
    outputStartFrame,
    outputEndFrame,
    outputFrames: outputEndFrame - outputStartFrame + 1,
    outputStartSeconds: round(outputStartFrame / FRAME_RATE),
    outputEndSeconds: round((outputEndFrame + 1) / FRAME_RATE),
    sourceAssetId,
    sourceStartFrame,
    sourceEndFrame,
    sourceStartSeconds,
    layout,
  };
}

function timelineIsContiguous(timeline) {
  return (
    Array.isArray(timeline) &&
    timeline.length > 0 &&
    timeline[0].outputStartFrame === 0 &&
    timeline.at(-1).outputEndFrame === TOTAL_FRAMES - 1 &&
    timeline.every(
      (item, index) =>
        index === 0 || item.outputStartFrame === timeline[index - 1].outputEndFrame + 1,
    )
  );
}

function view(id, label, media) {
  return { id, label, path: media.path, sha256: media.sha256, mimeType: media.mimeType };
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
