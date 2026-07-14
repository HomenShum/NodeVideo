import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PRIVATE_EVIDENCE_ROOT = join(REPO_ROOT, '.qa', 'evidence', 'private');

const MEDIA_EXTENSIONS = new Set([
  '.avi',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.webm',
]);
const SCAN_SKIP_DIRECTORIES = new Set(['.git', '.qa', 'node_modules']);

export function resolveInputPath(value) {
  return isAbsolute(value) ? resolve(value) : resolve(REPO_ROOT, value);
}

export function requireFile(path, alias = 'media input') {
  if (!existsSync(path)) {
    throw new Error(`${alias} is missing. Configure its environment variable.`);
  }
}

export function runBinary(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: options.encoding ?? null,
    maxBuffer: options.maxBuffer ?? 128 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`${command} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8')
      : String(result.stderr ?? '');
    throw new Error(`${command} failed with exit code ${result.status}: ${stderr.trim()}`);
  }

  return result.stdout;
}

export function runText(command, args, options = {}) {
  return runBinary(command, args, {
    ...options,
    encoding: 'utf8',
  });
}

export function ffmpegVersion(command = 'ffmpeg') {
  return runText(command, ['-version']).split(/\r?\n/u)[0].trim();
}

export function ffprobeVersion(command = 'ffprobe') {
  return runText(command, ['-version']).split(/\r?\n/u)[0].trim();
}

export function probeMedia(path, ffprobe = 'ffprobe') {
  return JSON.parse(
    runText(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path]),
  );
}

function rotationFor(stream) {
  const rotationEntry = stream?.side_data_list?.find((entry) => typeof entry.rotation === 'number');
  if (rotationEntry) {
    return rotationEntry.rotation;
  }
  const tagRotation = Number(stream?.tags?.rotate);
  return Number.isFinite(tagRotation) ? tagRotation : null;
}

export function sanitizeProbe(probe) {
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams?.find((stream) => stream.codec_type === 'audio');

  return {
    format: {
      formatName: probe.format?.format_name ?? null,
      durationSeconds: numberOrNull(probe.format?.duration),
      sizeBytes: numberOrNull(probe.format?.size),
      bitRate: numberOrNull(probe.format?.bit_rate),
    },
    video: video
      ? {
          codec: video.codec_name ?? null,
          profile: video.profile ?? null,
          codedWidth: numberOrNull(video.width),
          codedHeight: numberOrNull(video.height),
          pixelFormat: video.pix_fmt ?? null,
          colorRange: video.color_range ?? null,
          colorSpace: video.color_space ?? null,
          colorTransfer: video.color_transfer ?? null,
          colorPrimaries: video.color_primaries ?? null,
          nominalFrameRate: video.r_frame_rate ?? null,
          averageFrameRate: video.avg_frame_rate ?? null,
          timeBase: video.time_base ?? null,
          durationSeconds: numberOrNull(video.duration),
          frameCount: numberOrNull(video.nb_frames),
          rotationDegrees: rotationFor(video),
        }
      : null,
    audio: audio
      ? {
          codec: audio.codec_name ?? null,
          sampleRate: numberOrNull(audio.sample_rate),
          channels: numberOrNull(audio.channels),
          channelLayout: audio.channel_layout ?? null,
          durationSeconds: numberOrNull(audio.duration),
          bitRate: numberOrNull(audio.bit_rate),
        }
      : null,
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function rationalNumber(value) {
  if (typeof value !== 'string') {
    return Number(value);
  }
  const [numerator, denominator = '1'] = value.split('/');
  const result = Number(numerator) / Number(denominator);
  return Number.isFinite(result) ? result : null;
}

export async function sha256File(path) {
  const hash = createHash('sha256');
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', rejectPromise);
    stream.on('end', resolvePromise);
  });
  return hash.digest('hex');
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, path);
}

export function assertPrivateOutput(path) {
  const candidate = resolve(path);
  const inside = relative(PRIVATE_EVIDENCE_ROOT, candidate);
  if (inside === '' || (!inside.startsWith(`..${sep}`) && inside !== '..')) {
    return candidate;
  }
  throw new Error(`Private output must stay under ${relative(REPO_ROOT, PRIVATE_EVIDENCE_ROOT)}.`);
}

export function assertion(name, pass, actual, expected) {
  return {
    name,
    pass: Boolean(pass),
    actual,
    expected,
  };
}

export function near(actual, expected, tolerance) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

export function assertionsPass(assertions) {
  return assertions.every((item) => item.pass);
}

export function readRgbFrames(
  path,
  frameNumbers,
  { ffmpeg = 'ffmpeg', width = 180, height = 320 } = {},
) {
  const selection = frameNumbers.map((frameNumber) => `eq(n\\,${frameNumber})`).join('+');
  const frameSize = width * height * 3;
  const output = runBinary(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      path,
      '-map',
      '0:v:0',
      '-vf',
      `select=${selection},scale=${width}:${height}:flags=neighbor,format=rgb24`,
      '-fps_mode',
      'passthrough',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { maxBuffer: frameSize * (frameNumbers.length + 2) },
  );

  if (output.length !== frameSize * frameNumbers.length) {
    throw new Error(
      `Expected ${frameNumbers.length} decoded frames, received ${output.length / frameSize}.`,
    );
  }

  return new Map(
    frameNumbers.map((frameNumber, index) => [
      frameNumber,
      output.subarray(index * frameSize, (index + 1) * frameSize),
    ]),
  );
}

export function regionLuma(frame, width, { xStart, xEnd, yStart, yEnd }) {
  let total = 0;
  let count = 0;
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const index = (y * width + x) * 3;
      const red = frame[index];
      const green = frame[index + 1];
      const blue = frame[index + 2];
      total += 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      count += 1;
    }
  }
  return total / count;
}

export function layoutMetrics(frame, width = 180, height = 320) {
  const xStart = Math.round(width * 0.12);
  const xEnd = Math.round(width * 0.88);
  const top = regionLuma(frame, width, {
    xStart,
    xEnd,
    yStart: Math.round(height * 0.08),
    yEnd: Math.round(height * 0.25),
  });
  const middle = regionLuma(frame, width, {
    xStart,
    xEnd,
    yStart: Math.round(height * 0.39),
    yEnd: Math.round(height * 0.61),
  });
  const bottom = regionLuma(frame, width, {
    xStart,
    xEnd,
    yStart: Math.round(height * 0.75),
    yEnd: Math.round(height * 0.92),
  });
  const state = top < 16 && bottom < 16 && middle > 20 ? 'fit' : 'fill';
  return {
    state,
    topLuma: round(top),
    middleLuma: round(middle),
    bottomLuma: round(bottom),
  };
}

export function fitBandMetrics(frame, width = 180, height = 320) {
  const xStart = Math.round(width * 0.12);
  const xEnd = Math.round(width * 0.88);
  const activeRows = [];
  for (let y = 0; y < height; y += 1) {
    const luma = regionLuma(frame, width, {
      xStart,
      xEnd,
      yStart: y,
      yEnd: y + 1,
    });
    if (luma > 15) {
      activeRows.push(y);
    }
  }

  const groups = [];
  for (const row of activeRows) {
    const current = groups.at(-1);
    if (!current || row - current.at(-1) > 5) {
      groups.push([row]);
    } else {
      current.push(row);
    }
  }
  const largest = groups.sort((left, right) => right.length - left.length)[0] ?? [];
  const scale = 1280 / height;
  return {
    top: largest.length ? Math.round(largest[0] * scale) : null,
    bottom: largest.length ? Math.round(largest.at(-1) * scale) : null,
    activeRows: largest.length,
  };
}

export function meanAbsoluteDifference(left, right) {
  if (left.length !== right.length) {
    throw new Error('Frame buffers must have the same length.');
  }
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += Math.abs(left[index] - right[index]);
  }
  return total / left.length;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

export async function scanDeployableMedia() {
  const results = [];

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && SCAN_SKIP_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && MEDIA_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        const details = await stat(absolutePath);
        results.push({
          path: relative(REPO_ROOT, absolutePath).replaceAll('\\', '/'),
          baseName: basename(absolutePath),
          sizeBytes: details.size,
          sha256: await sha256File(absolutePath),
        });
      }
    }
  }

  await visit(REPO_ROOT);
  return results.sort((left, right) => left.path.localeCompare(right.path));
}

export function privacyAssertions(deployableMedia, privateHashes, forbiddenBaseNames) {
  const hashSet = new Set(privateHashes);
  const baseNameSet = new Set(forbiddenBaseNames.map((value) => value.toLowerCase()));
  const hashMatches = deployableMedia
    .filter((item) => hashSet.has(item.sha256))
    .map((item) => item.path);
  const nameMatches = deployableMedia
    .filter((item) => baseNameSet.has(item.baseName.toLowerCase()))
    .map((item) => item.path);

  return [
    assertion(
      'no private input hash appears in deployable directories',
      hashMatches.length === 0,
      hashMatches,
      [],
    ),
    assertion(
      'no private input filename appears in deployable directories',
      nameMatches.length === 0,
      nameMatches,
      [],
    ),
  ];
}
