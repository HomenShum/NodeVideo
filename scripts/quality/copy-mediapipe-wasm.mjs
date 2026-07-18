#!/usr/bin/env node
// Copy MediaPipe's WASM runtime from the npm package into dist so the
// practice room loads it same-origin (the production CSP blocks CDNs).
// Sourced from node_modules at build time — no binaries in the repo.

import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const source = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const target = join(root, 'dist', 'mediapipe-wasm');

if (!existsSync(source)) {
  console.error('copy-mediapipe-wasm: @mediapipe/tasks-vision is not installed');
  process.exit(1);
}
mkdirSync(target, { recursive: true });
for (const entry of readdirSync(source)) {
  cpSync(join(source, entry), join(target, entry));
}
console.log(
  `copied ${readdirSync(target).length} MediaPipe runtime files into dist/mediapipe-wasm`,
);
