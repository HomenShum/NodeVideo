#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { locateAnythingOnImage } from './locate-anything-space.mjs';

const run = promisify(execFile);
const host = process.env.NODEVIDEO_LOCATEANYTHING_HOST ?? '127.0.0.1';
const port = Number(process.env.NODEVIDEO_LOCATEANYTHING_PORT ?? 8000);
const accepted = process.env.NODEVIDEO_LOCATEANYTHING_LICENSE_ACCEPTED === 'true';
const registryPath = process.env.NODEVIDEO_LOCATEANYTHING_ASSET_REGISTRY;
const registry = registryPath
  ? JSON.parse(await readFile(resolve(registryPath), 'utf8'))
  : { assets: {} };

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/health') {
      return json(response, accepted ? 200 : 503, {
        provider: 'nvidia/LocateAnything-3B',
        backend: 'official-hugging-face-space',
        licenseAccepted: accepted,
        configuredAssets: Object.keys(registry.assets ?? {}).length,
      });
    }
    if (request.method !== 'POST' || request.url !== '/locate')
      return json(response, 404, { error: 'not_found' });
    if (!accepted) return json(response, 403, { error: 'license_not_accepted' });
    const body = await readJson(request);
    const asset = registry.assets?.[body.assetId];
    if (!asset?.path) return json(response, 404, { error: 'asset_not_registered' });
    const source = resolve(asset.path);
    const temporary = await mkdtemp(join(tmpdir(), 'nodevideo-locate-'));
    try {
      const imagePath = await materializeFrame(source, body.frameNumber, temporary);
      const inference = await locateAnythingOnImage({
        imagePath,
        query: body.query,
        task: body.task,
        output: body.output,
      });
      return json(response, 200, { answer: inference.rawText });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  } catch (error) {
    return json(response, 400, { error: error instanceof Error ? error.message : 'sidecar_error' });
  }
});

server.listen(port, host, () =>
  console.log(`LocateAnything sidecar listening at http://${host}:${port}`),
);

async function materializeFrame(source, frameNumber, temporary) {
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(extname(source).toLowerCase())) return source;
  if (!Number.isSafeInteger(frameNumber) || frameNumber < 0)
    throw new Error('video assets require frameNumber');
  const destination = join(temporary, 'frame.jpg');
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    source,
    '-vf',
    `select=eq(n\\,${frameNumber})`,
    '-frames:v',
    '1',
    destination,
  ]);
  return destination;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}
