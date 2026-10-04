#!/usr/bin/env node
// Post-deploy smoke check for the Vercel-hosted production site.
//
// Polls the landing shell and existing build/contract receipts until both
// the content signal and this workflow's exact source commit are served.
//
// Usage: node scripts/quality/verify-production-deploy.mjs <url> [signal]
// Env:   GITHUB_SHA                required expected source commit
//        DEPLOY_VERIFY_TIMEOUT_MS  total budget (default 480000 = 8 min)
//        DEPLOY_VERIFY_INTERVAL_MS poll interval (default 15000)

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const MAX_BODY_BYTES = 1_048_576; // bound reads of the external body
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchBody(url, deadline) {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new Error('verification deadline reached');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(10_000, remainingMs));
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'error' });
    if (res.status !== 200) {
      await res.body?.cancel();
      throw new Error(`HTTP ${res.status} at ${url.pathname}`);
    }
    const reader = res.body?.getReader();
    let bytes = 0;
    const body = Buffer.allocUnsafe(MAX_BODY_BYTES);
    try {
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        if (bytes + value.byteLength > MAX_BODY_BYTES) {
          await reader.cancel();
          throw new Error(`response exceeds ${MAX_BODY_BYTES} bytes at ${url.pathname}`);
        }
        body.set(value, bytes);
        bytes += value.byteLength;
      }
    } finally {
      reader?.releaseLock();
    }
    return body.subarray(0, bytes);
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(bytes, name) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`invalid JSON in ${name}`);
  }
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const signal = args[1] ?? 'NodeVideo — learn the dance you admire';
  const expectedCommit = env.GITHUB_SHA;
  const timeoutMs = Number(env.DEPLOY_VERIFY_TIMEOUT_MS ?? 480_000);
  const intervalMs = Number(env.DEPLOY_VERIFY_INTERVAL_MS ?? 15_000);
  let url;
  try {
    url = new URL(args[0]);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('a credential-free HTTP(S) production URL is required');
    }
    if (!/^[a-f0-9]{40}$/.test(expectedCommit ?? '')) {
      throw new Error('GITHUB_SHA must be the complete expected source commit');
    }
    if (
      !signal ||
      ![timeoutMs, intervalMs].every((ms) => Number.isInteger(ms) && ms > 0 && ms <= 2_147_483_647)
    ) {
      throw new Error('a nonempty signal and positive integer timing budgets are required');
    }
  } catch (err) {
    console.error(`Invalid verification input: ${err.message}`);
    return 2;
  }

  const receiptUrl = new URL('/.well-known/agent-ui.build.json', url);
  const contractUrl = new URL('/.well-known/agent-ui.json', url);
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const html = await fetchBody(url, deadline);
      if (!html.toString('utf8').includes(signal)) throw new Error('content signal absent');
      const receipt = parseJson(await fetchBody(receiptUrl, deadline), 'build receipt');
      if (receipt?.schemaVersion !== 'nodevideo.agent-ui-build.v1') {
        throw new Error('invalid build receipt schema');
      }
      if (receipt.sourceCommit !== expectedCommit) {
        const observed = /^[a-f0-9]{40}$/.test(receipt.sourceCommit ?? '')
          ? receipt.sourceCommit
          : 'invalid';
        throw new Error(`source commit ${observed}, expected ${expectedCommit}`);
      }
      if (!/^[a-f0-9]{64}$/.test(receipt.contractSha256 ?? '')) {
        throw new Error('invalid contract hash in build receipt');
      }
      const contract = await fetchBody(contractUrl, deadline);
      parseJson(contract, 'UI contract');
      const contractHash = createHash('sha256').update(contract).digest('hex');
      if (contractHash !== receipt.contractSha256) throw new Error('contract byte hash mismatch');
      if (Date.now() >= deadline) throw new Error('verification deadline reached');
      console.log(
        `OK attempt ${attempt}: source ${expectedCommit}, contract ${contractHash}, content signal ${JSON.stringify(signal)}`,
      );
      return 0;
    } catch (err) {
      console.error(
        `attempt ${attempt}: ${err?.name ?? 'error'}: ${err?.message ?? 'fetch failed'}`,
      );
    }
    if (Date.now() + intervalMs >= deadline) break;
    await sleep(intervalMs);
  }

  console.error(
    `FAIL: source ${expectedCommit}, matching contract bytes and content signal were not verified within ${timeoutMs}ms. The deployment is not verified live.`,
  );
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
