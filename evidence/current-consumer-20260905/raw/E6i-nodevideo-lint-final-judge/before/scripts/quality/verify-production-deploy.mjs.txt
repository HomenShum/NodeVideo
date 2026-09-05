#!/usr/bin/env node
// Post-deploy smoke check for the Vercel-hosted production site.
//
// Polls the production URL until the server-rendered landing shell carries
// the content signal from the real app source (index.html <title>), or times
// out. Readiness wait and content verification are the same loop: a deploy
// that never serves the signal within the budget is a failed deploy.
//
// Usage: node scripts/quality/verify-production-deploy.mjs <url> [signal]
// Env:   DEPLOY_VERIFY_TIMEOUT_MS  total budget (default 480000 = 8 min)
//        DEPLOY_VERIFY_INTERVAL_MS poll interval (default 15000)
//
// ponytail: the signal is version-independent, so a stale CDN copy of a
// previous healthy deploy passes. Per-commit verification needs a build
// stamp in the HTML (stamp-contract-build.mjs is the place to add one).

const url = process.argv[2];
const signal = process.argv[3] ?? 'NodeVideo — learn the dance you admire';
const timeoutMs = Number(process.env.DEPLOY_VERIFY_TIMEOUT_MS ?? 480_000);
const intervalMs = Number(process.env.DEPLOY_VERIFY_INTERVAL_MS ?? 15_000);
const MAX_BODY_BYTES = 1_048_576; // bound reads of the external body

if (!url || !/^https?:\/\//.test(url)) {
  console.error('usage: verify-production-deploy.mjs <http(s) url> [signal]');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchBody() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    const reader = res.body?.getReader();
    let bytes = 0;
    const chunks = [];
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      chunks.push(value);
      if (bytes >= MAX_BODY_BYTES) {
        await reader.cancel();
        break;
      }
    }
    const body = Buffer.concat(chunks).toString('utf8');
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

const deadline = Date.now() + timeoutMs;
let attempt = 0;
for (;;) {
  attempt += 1;
  try {
    const { status, body } = await fetchBody();
    if (status === 200 && body.includes(signal)) {
      console.log(`OK attempt ${attempt}: ${url} serves the content signal (${JSON.stringify(signal)})`);
      process.exit(0);
    }
    console.error(`attempt ${attempt}: HTTP ${status}, signal ${body.includes(signal) ? 'present' : 'absent'}`);
  } catch (err) {
    console.error(`attempt ${attempt}: ${err?.cause?.code ?? err?.name ?? 'error'}: ${err?.message ?? err}`);
  }
  if (Date.now() + intervalMs > deadline) break;
  await sleep(intervalMs);
}

console.error(
  `FAIL: ${url} never served HTTP 200 with the content signal within ${timeoutMs}ms. ` +
    'The deployment is not verified live.',
);
process.exit(1);
