#!/usr/bin/env node
// Copy the pinned ffmpeg.wasm cores and the renderer's tracked Geist font into
// dist. Browser export loads only these same-origin, versioned files.

import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const version = '0.12.10';
const targetRoot = join(root, 'dist', 'ffmpeg', version);
const files = [
  {
    source: join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm', 'ffmpeg-core.js'),
    target: join(targetRoot, 'st', 'ffmpeg-core.js'),
  },
  {
    source: join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm', 'ffmpeg-core.wasm'),
    target: join(targetRoot, 'st', 'ffmpeg-core.wasm'),
  },
  {
    source: join(root, 'node_modules', '@ffmpeg', 'core-mt', 'dist', 'esm', 'ffmpeg-core.js'),
    target: join(targetRoot, 'mt', 'ffmpeg-core.js'),
  },
  {
    source: join(root, 'node_modules', '@ffmpeg', 'core-mt', 'dist', 'esm', 'ffmpeg-core.wasm'),
    target: join(targetRoot, 'mt', 'ffmpeg-core.wasm'),
  },
  {
    source: join(
      root,
      'node_modules',
      '@ffmpeg',
      'core-mt',
      'dist',
      'esm',
      'ffmpeg-core.worker.js',
    ),
    target: join(targetRoot, 'mt', 'ffmpeg-core.worker.js'),
  },
  {
    source: join(root, 'packs', 'edit-plan-renderer', 'assets', 'Geist-Variable-Latin.ttf'),
    target: join(targetRoot, 'Geist-Variable-Latin.ttf'),
  },
];

for (const file of files) {
  if (!existsSync(file.source) || statSync(file.source).size === 0) {
    console.error(`copy-ffmpeg-wasm: missing required input ${file.source}`);
    process.exit(1);
  }
}

for (const file of files) {
  mkdirSync(dirname(file.target), { recursive: true });
  cpSync(file.source, file.target);
  if (statSync(file.target).size !== statSync(file.source).size) {
    console.error(`copy-ffmpeg-wasm: incomplete copy ${file.target}`);
    process.exit(1);
  }
}

console.log(`copied ${files.length} FFmpeg runtime files into dist/ffmpeg/${version}`);
