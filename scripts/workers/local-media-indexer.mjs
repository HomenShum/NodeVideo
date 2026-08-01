import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { REPO_ROOT, runText, writeJson } from '../media/media-proof-lib.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: 'string' },
    transcription: { type: 'string', default: 'none' },
    language: { type: 'string' },
    'asset-id': { type: 'string', default: 'asset.local-source' },
    verify: { type: 'boolean', default: false },
  },
});

if (values.verify) {
  const pythonModules = runText('python', [
    '-c',
    'import importlib.util,json; print(json.dumps({name: bool(importlib.util.find_spec(name)) for name in ["whisper","cv2","scenedetect"]}))',
  ]).trim();
  const modules = JSON.parse(pythonModules);
  const checks = {
    ffmpeg: Boolean(runText('ffmpeg', ['-version']).trim()),
    ffprobe: Boolean(runText('ffprobe', ['-version']).trim()),
    python: Boolean(runText('python', ['--version']).trim()),
    worker: existsSync(resolve(REPO_ROOT, 'scripts/analysis/build_media_index.py')),
    whisper: Boolean(modules.whisper),
    opencv: Boolean(modules.cv2),
    sceneDetect: Boolean(modules.scenedetect),
  };
  const result = {
    schemaVersion: 'nodevideo.local-media-doctor.v1',
    checks,
    pass: Object.values(checks).every(Boolean),
  };
  if (!result.pass) process.exitCode = 1;
  console.log(JSON.stringify(result, null, 2));
} else {
  const source = positionals[0];
  if (!source)
    throw new Error('Usage: node scripts/workers/local-media-indexer.mjs <source> [--output path]');
  const outputPath = resolve(values.output ?? '.qa/evidence/local-media/index.json');
  const args = [
    resolve(source),
    '--output',
    outputPath,
    '--asset-id',
    values['asset-id'],
    '--transcription',
    values.transcription,
  ];
  if (values.language) args.push('--language', values.language);
  runText('python', [resolve(REPO_ROOT, 'scripts/analysis/build_media_index.py'), ...args], {
    timeout: 60 * 60 * 1_000,
  });
  await writeJson(`${outputPath}.receipt.json`, {
    schemaVersion: 'nodevideo.local-media-index-run.v1',
    source: resolve(source),
    output: outputPath,
    transcription: values.transcription,
    completedAt: new Date().toISOString(),
    mediaEgress: false,
  });
  console.log(outputPath);
}
