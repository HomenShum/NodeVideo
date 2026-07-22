import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { benchmarkRoot, evidenceRoot, readJson, writeJson } from './creatorbench-io.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(benchmarkRoot, '../..');
const workflow = 'smart-reframe';
const executorVersion = 'local-ffmpeg-center-reframe-v1';
const renderRoot = resolve(evidenceRoot, 'renders/public-smart-reframe');
const posterRoot = resolve(root, 'fixtures/media/creatorbench-v1/public');
const selectedSplits = new Set(['development', 'public-test', 'adversarial']);
const variants = [
  { id: '16x9', label: '16:9', width: 640, height: 360 },
  { id: '9x16', label: '9:16', width: 360, height: 640 },
  { id: '1x1', label: '1:1', width: 480, height: 480 },
];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const percentile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
};
const run = async (command, args) => {
  const result = await execFileAsync(command, args, { maxBuffer: 4_000_000, windowsHide: true });
  return result.stdout;
};

await mkdir(renderRoot, { recursive: true });
await mkdir(posterRoot, { recursive: true });
for (const directory of [renderRoot, posterRoot]) {
  for (const name of await readdir(directory)) {
    if (/\.(?:jpg|mp4)$/iu.test(name)) await unlink(resolve(directory, name));
  }
}

const vault = await readJson(resolve(evidenceRoot, 'acquisition-vault.json'));
const manifest = await readJson(resolve(benchmarkRoot, 'catalog/public-instances.json'));
const sources = await readJson(resolve(benchmarkRoot, 'catalog/public-sources.json'));
const vaultById = new Map(vault.records.map((record) => [record.id, record]));
const sourceById = new Map(sources.records.map((record) => [record.id, record]));
const instances = manifest.instances.filter(
  (instance) => instance.workflow === workflow && selectedSplits.has(instance.split),
);
const results = [];

for (const instance of instances) {
  const sourceId = instance.sourceIds[0];
  const vaultRecord = vaultById.get(sourceId);
  const sourceRecord = sourceById.get(sourceId);
  if (!vaultRecord || !sourceRecord) throw new Error(`Missing public source ${sourceId}.`);
  const sourcePath = resolve(evidenceRoot, 'media', vaultRecord.localCacheKey);
  const key = sha256(instance.id).slice(0, 16);
  const sourcePosterPath = resolve(posterRoot, `${key}-source.jpg`);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const outputArtifacts = [];
  for (const variant of variants) {
    const outputPath = resolve(renderRoot, `${key}-${variant.id}.mp4`);
    const outputPosterPath = resolve(posterRoot, `${key}-${variant.id}.jpg`);
    await run('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      sourcePath,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-vf',
      `scale=${variant.width}:${variant.height}:force_original_aspect_ratio=increase,crop=${variant.width}:${variant.height}`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '24',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-movflags',
      '+faststart',
      outputPath,
    ]);
    const probe = JSON.parse(
      await run('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration,size:stream=codec_type,codec_name,width,height',
        '-of',
        'json',
        outputPath,
      ]),
    );
    const video = probe.streams.find((stream) => stream.codec_type === 'video');
    if (
      !video ||
      video.width !== variant.width ||
      video.height !== variant.height ||
      Number(probe.format.duration) <= 0
    ) {
      throw new Error(
        `Rendered artifact ${key}-${variant.id} failed reopen or geometry verification.`,
      );
    }
    await run('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      '1',
      '-i',
      outputPath,
      '-frames:v',
      '1',
      '-vf',
      `scale=${variant.width}:${variant.height}`,
      '-q:v',
      '4',
      outputPosterPath,
    ]);
    const outputBytes = await readFile(outputPath);
    outputArtifacts.push({
      id: `artifact:sha256:${sha256(outputBytes)}`,
      sha256: `sha256:${sha256(outputBytes)}`,
      aspectRatio: variant.label,
      width: variant.width,
      height: variant.height,
      poster: `/media/creatorbench-v1/public/${key}-${variant.id}.jpg`,
      exportDecodesAndReopens: true,
    });
  }
  await run('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    '1',
    '-i',
    sourcePath,
    '-frames:v',
    '1',
    '-vf',
    'scale=640:-2:force_original_aspect_ratio=decrease',
    '-q:v',
    '4',
    sourcePosterPath,
  ]);
  const completedAt = new Date().toISOString();
  results.push({
    schemaVersion: 'nodevideo.creatorbench-render-pilot-result/v1',
    id: `render-pilot:${key}`,
    instanceId: instance.id,
    resultId: `result:${instance.id}`,
    split: instance.split,
    workflow,
    executorVersion,
    outputArtifacts,
    startedAt,
    completedAt,
    latencyMs: Math.round(performance.now() - started),
    costUsd: 0,
    exportDecodesAndReopens: true,
    rightsPassed: sourceRecord.rights.permittedBenchmarkUses.includes('derivatives'),
    privacyPassed: sourceRecord.privacy === 'public',
    sourcePoster: `/media/creatorbench-v1/public/${key}-source.jpg`,
    outputPoster: outputArtifacts.find((artifact) => artifact.aspectRatio === '9:16')?.poster,
    outputs: outputArtifacts
      .filter((artifact) => artifact.aspectRatio !== '9:16')
      .map((artifact) => ({
        id: artifact.aspectRatio,
        label: artifact.aspectRatio,
        poster: artifact.poster,
      })),
    request: instance.request.intent.instruction,
    publicSourceLabel: `${sourceRecord.rights.licenseName} · ${sourceRecord.title}`,
    route: executorVersion,
    machineFindings: [
      'Deterministic center-crop baseline; no subject detector was used.',
      'All 16:9, 9:16, and 1:1 outputs decoded, reopened, and matched requested geometry.',
      'Human review is required before any usability claim.',
    ],
  });
  process.stdout.write(`\rRendered ${results.length}/${instances.length}`);
}
process.stdout.write('\n');

const latencies = results.map((result) => result.latencyMs);
const sourceCommitSha = (await run('git', ['rev-parse', 'HEAD'])).trim();
const evidence = {
  schemaVersion: 'nodevideo.creatorbench-render-pilot/v1',
  benchmarkVersion: manifest.benchmarkVersion,
  generatedAt: new Date().toISOString(),
  sourceCommitSha,
  scope: {
    workflow,
    executorVersion,
    splitClasses: [...selectedSplits],
    sourceCount: new Set(results.map((result) => result.instanceId.split(':')[1])).size,
    outputCount: results.length,
    artifactCount: results.length * variants.length,
  },
  metrics: {
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    costUsd: { total: 0, perOutput: 0 },
    exportReopen: {
      numerator: results.length * variants.length,
      denominator: results.length * variants.length,
      rate: 1,
    },
  },
  limitations: [
    'This is a deterministic center-crop baseline for one workflow, not a subject-aware reframe claim.',
    'The public review queue is blind to machine findings until a judgment is recorded.',
    'No pilot result is counted as usable before human review.',
  ],
  reviewCases: results.map((result) => ({
    id: result.instanceId,
    resultId: result.resultId,
    split: result.split,
    visibility: 'public',
    request: result.request,
    sourcePoster: result.sourcePoster,
    outputPoster: result.outputPoster,
    outputs: result.outputs,
    publicSourceLabel: result.publicSourceLabel,
    route: result.route,
    machineFindings: result.machineFindings,
  })),
  results,
};
await writeJson(resolve(benchmarkRoot, 'results/public-render-pilot.json'), evidence);
await writeJson(resolve(evidenceRoot, 'results/public-render-pilot-private-receipt.json'), {
  ...evidence,
  results: results.map((result) => ({
    ...result,
    localOutputClass: '.qa/evidence/creatorbench-v1/renders/public-smart-reframe',
  })),
});
console.log(JSON.stringify({ scope: evidence.scope, metrics: evidence.metrics }, null, 2));
