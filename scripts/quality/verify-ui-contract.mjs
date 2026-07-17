#!/usr/bin/env node
// Verifies the UI contract (.ui/contract.json) against the real production
// build. Every declared control must resolve through the accessibility tree,
// declared gates are exercised adversarially, and global invariants (charset,
// overflow at declared widths, theme mechanism) are asserted. Drift between
// the contract and the rendered UI — or between the contract and its public
// copy at fixtures/.well-known/agent-ui.json — fails the build.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..', '..');
const port = Number(process.env.NODEVIDEO_CONTRACT_PORT ?? 4327);
const contract = JSON.parse(readFileSync(join(root, '.ui', 'contract.json'), 'utf8'));
const publicCopy = readFileSync(join(root, 'fixtures', '.well-known', 'agent-ui.json'), 'utf8');
const failures = [];
const ok = (line) => console.log(`  ok  ${line}`);
const fail = (line) => {
  failures.push(line);
  console.error(`  FAIL ${line}`);
};

if (publicCopy !== readFileSync(join(root, '.ui', 'contract.json'), 'utf8')) {
  fail('fixtures/.well-known/agent-ui.json is not byte-identical to .ui/contract.json');
} else {
  ok('public contract copy is byte-identical to source');
}

function locate(page, control) {
  if (control.testid) return page.getByTestId(control.testid);
  if (control.role && control.name) return page.getByRole(control.role, { name: control.name });
  if (control.role && control.nameAnyOf) {
    return page.getByRole(control.role, {
      name: new RegExp(control.nameAnyOf.map((n) => `^${n}$`).join('|')),
    });
  }
  if (control.css) return page.locator(control.css.split(',')[0].trim());
  return null;
}

const preview = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port)],
  { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' },
);
const base = `http://127.0.0.1:${port}`;
await new Promise((resolveWait, reject) => {
  const started = Date.now();
  const poll = async () => {
    try {
      const response = await fetch(base);
      if (response.ok) return resolveWait();
    } catch {}
    if (Date.now() - started > 30_000) return reject(new Error('preview server did not start'));
    setTimeout(poll, 400);
  };
  poll();
});

// Build receipt: the served contract must be hash-bound to this build.
{
  const servedContract = await fetch(`${base}/.well-known/agent-ui.json`);
  const servedBytes = Buffer.from(await servedContract.arrayBuffer());
  const receiptResponse = await fetch(`${base}/.well-known/agent-ui.build.json`);
  if (!receiptResponse.ok) {
    fail('build receipt /.well-known/agent-ui.build.json is not served');
  } else {
    const receipt = await receiptResponse.json();
    const actual = createHash('sha256').update(servedBytes).digest('hex');
    receipt.contractSha256 === actual
      ? ok(
          `build receipt binds contract (${actual.slice(0, 12)}…, commit ${String(receipt.sourceCommit).slice(0, 8)})`,
        )
      : fail(
          `build receipt contractSha256 ${receipt.contractSha256?.slice(0, 12)}… != served contract ${actual.slice(0, 12)}…`,
        );
  }
}

// Mock sidecar: serves contract state fixtures so declared UI states are
// verified against rendered DOM without the Python worker.
const stateFixtures = new Map();
for (const surface of contract.surfaces) {
  for (const state of surface.states ?? []) {
    stateFixtures.set(state.id, JSON.parse(readFileSync(join(root, state.fixture), 'utf8')));
  }
}
const mockSidecar = createServer((request, response) => {
  const match = request.url?.match(/^\/v1\/jobs\/([a-z0-9-]+)$/);
  const job = match ? stateFixtures.get(match[1]) : undefined;
  response.writeHead(job ? 200 : 404, {
    'content-type': 'application/json',
    'access-control-allow-origin': request.headers.origin ?? '*',
    'access-control-allow-headers': 'authorization,content-type',
  });
  response.end(JSON.stringify(job ?? { error: 'job_not_found' }));
});
const mockPort = 4339;
await new Promise((resolveListen) => mockSidecar.listen(mockPort, '127.0.0.1', resolveListen));

const browser = await chromium.launch();
try {
  for (const surface of contract.surfaces) {
    console.log(`SURFACE ${surface.id} (${surface.route})`);
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(base + surface.route, { waitUntil: 'networkidle' });

    const charset = await page.evaluate(() => document.characterSet);
    charset === contract.invariants.charset
      ? ok(`charset ${charset}`)
      : fail(`${surface.id}: charset ${charset} != ${contract.invariants.charset}`);

    const landmark = locate(page, surface.landmark);
    (await landmark?.count())
      ? ok(`landmark resolves`)
      : fail(`${surface.id}: landmark did not resolve`);

    const expanded = new Set();
    for (const control of surface.controls ?? []) {
      if (control.requiresExpand && !expanded.has(control.requiresExpand)) {
        const opener = surface.controls.find((c) => c.id === control.requiresExpand);
        await locate(page, opener)?.click();
        expanded.add(control.requiresExpand);
      }
      const found = locate(page, control);
      const count = found ? await found.count() : 0;
      count > 0
        ? ok(`control ${control.id}`)
        : fail(`${surface.id}: control ${control.id} did not resolve`);
    }

    for (const width of contract.invariants.noHorizontalOverflowAtWidths) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      overflow <= 1
        ? ok(`no overflow at ${width}px`)
        : fail(`${surface.id}: ${overflow}px horizontal overflow at ${width}px`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    if (surface.id === 'workspace') {
      const toggle = page.getByRole('button', { name: /Switch to (light|dark) theme/ });
      const before = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      await toggle.click();
      const after = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      before !== after
        ? ok('theme toggle flips dark class')
        : fail('workspace: theme toggle did not flip dark class');
    }

    if (surface.id === 'coach-sidepanel') {
      const scratch = await mkdtemp(join(tmpdir(), 'nodevideo-contract-'));
      const stub = join(scratch, 'attempt.mp4');
      writeFileSync(stub, Buffer.from('stub-not-a-real-video'));
      await page.locator('#attempt').setInputFiles(stub);
      const disclosure = page.getByRole('button', { name: 'Segment, team, and connection' });
      const tokenVisible = await page
        .locator('#token')
        .isVisible()
        .catch(() => false);
      if (!tokenVisible) await disclosure.click();
      await page.locator('#token').fill('contract-check-token');
      await page.getByRole('button', { name: 'Judge choreography' }).click();
      const gate = surface.gates.find((g) => g.id === 'consent-gate');
      const expected = gate.check.match(/'([^']+)'/)[1];
      const surfaced = await page
        .getByText(expected)
        .first()
        .isVisible()
        .catch(() => false);
      surfaced
        ? ok('consent-gate: unconsented submit surfaces the exact refusal text')
        : fail('coach-sidepanel: consent-gate refusal text did not appear on unconsented submit');
      await rm(scratch, { recursive: true, force: true });
    }

    for (const state of surface.states ?? []) {
      const statePage = await browser.newPage({ viewport: { width: 420, height: 900 } });
      await statePage.goto(
        `${base}${surface.route}?job=${state.id}&token=contract-state-check&endpoint=${encodeURIComponent(`http://127.0.0.1:${mockPort}`)}`,
        { waitUntil: 'networkidle' },
      );
      for (const text of state.requireTexts ?? []) {
        (await statePage
          .getByText(text)
          .first()
          .isVisible()
          .catch(() => false))
          ? ok(`state ${state.id}: shows "${text}"`)
          : fail(`${surface.id}/${state.id}: required text "${text}" not visible`);
      }
      for (const text of state.forbidTexts ?? []) {
        (await statePage.getByText(text).count()) === 0
          ? ok(`state ${state.id}: never shows "${text}"`)
          : fail(`${surface.id}/${state.id}: forbidden text "${text}" is present`);
      }
      const chip = (name) =>
        statePage.locator('strong + span', { hasText: new RegExp(`^${name}$`) });
      for (const name of state.requireScoreChips ?? []) {
        (await chip(name).count()) === 1
          ? ok(`state ${state.id}: score chip ${name}`)
          : fail(`${surface.id}/${state.id}: score chip ${name} missing or duplicated`);
      }
      for (const name of state.forbidScoreChips ?? []) {
        (await chip(name).count()) === 0
          ? ok(`state ${state.id}: no fabricated ${name} chip`)
          : fail(`${surface.id}/${state.id}: forbidden score chip ${name} rendered`);
      }
      await statePage.close();
    }

    await page.close();
  }
} finally {
  await browser.close();
  preview.kill('SIGKILL');
  mockSidecar.close();
}

if (failures.length > 0) {
  console.error(`\nUI contract verification FAILED (${failures.length}):`);
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log('\nUI contract verified: rendered UI matches .ui/contract.json');
