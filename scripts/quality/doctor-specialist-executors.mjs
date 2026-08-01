import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const command = (name, args = ['--version']) => {
  const run = spawnSync(name, args, { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  return {
    available: run.status === 0,
    version: (run.stdout || run.stderr || '').trim().split(/\r?\n/u)[0] ?? '',
  };
};
const python = spawnSync(
  'python',
  [
    '-c',
    'import importlib.util,json; print(json.dumps({name: bool(importlib.util.find_spec(name)) for name in ["torch","whisper","cv2","scenedetect","faster_whisper","openstoryline","trellis","vggt"]}))',
  ],
  { encoding: 'utf8', windowsHide: true, timeout: 10_000 },
);
const modules = python.status === 0 ? JSON.parse(python.stdout.trim()) : {};
const result = {
  schemaVersion: 'nodevideo.specialist-executor-doctor.v1',
  generatedAt: new Date().toISOString(),
  commands: {
    ffmpeg: command('ffmpeg', ['-version']),
    ffprobe: command('ffprobe', ['-version']),
    higgsfield:
      process.platform === 'win32'
        ? command(process.execPath, [
            resolve(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js'),
            '-y',
            '-p',
            '@higgsfield/cli@1.1.19',
            'higgsfield',
            '--help',
          ])
        : command('npx', ['-y', '-p', '@higgsfield/cli@1.1.19', 'higgsfield', '--help']),
    autoEditor: command('auto-editor'),
  },
  pythonModules: modules,
  policy: {
    enabledNow: ['ffmpeg', 'ffprobe', 'whisper', 'opencv', 'scenedetect'],
    optionalAfterInstallAndLicenseReview: ['auto-editor', 'openstoryline', 'trellis', 'vggt'],
  },
};
const destination = resolve(process.argv[2] ?? '.qa/evidence/executors/doctor.json');
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(result, null, 2));
