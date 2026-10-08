#!/usr/bin/env node
// Finite Linux GitHub-CI proof; never installs, imports project modules or weakens
// the UI checker. The PR base and actual checkout must share exact package/lock.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  opendirSync,
  readSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const MAX_BYTES = 1024 * 1024;
const LOG_BYTES = 256 * 1024;
const PROCESS_LIMIT = 256;
const deadline = Date.now() + 7 * 60_000;
// Settlement/owned cleanup and one restoration build retain their own bounded
// windows; the unchanged outer job timeout still limits the whole CI job.
const restoreBudget = 120_000;
const actors = new Set();
const report = {
  schema: 'nodevideo.contract-resources.v1',
  status: 'NOT_RUN',
  sources: [],
  cases: [],
};
let work;
let output;
let original;
let originalTree;
let originalBuildReady = true;
let failed = false;

function bounded(path, maximum = MAX_BYTES) {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(maximum + 1);
    let count = 0;
    while (count < buffer.length) {
      const read = readSync(fd, buffer, count, buffer.length - count, null);
      if (read === 0) break;
      count += read;
    }
    if (count > maximum) throw new Error('Read admission exceeded its byte limit');
    return buffer.subarray(0, count);
  } finally {
    closeSync(fd);
  }
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function git(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: MAX_BYTES,
  }).trim();
}
function sourceGuard(commit, tree) {
  if (
    git(['rev-parse', 'HEAD']) !== commit ||
    git(['rev-parse', 'HEAD^{tree}']) !== tree ||
    git(['status', '--porcelain=v1', '--untracked-files=no']) !== ''
  ) {
    throw new Error('Tracked source checkout is not the admitted clean commit/tree');
  }
}
function table() {
  const rows = execFileSync('ps', ['-e', '-o', 'pid=,ppid=,pgid=,stat='], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: MAX_BYTES,
  })
    .trim()
    .split('\n');
  if (rows.length > 4096) throw new Error('Process inventory exceeded its admission limit');
  const result = new Map();
  for (const line of rows) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([A-Za-z<+]{1,16})$/u);
    if (!match) throw new Error('Process inventory contains an unreadable identity row');
    const [, pid, ppid, pgid, state] = match;
    result.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), state });
  }
  return result;
}
function identity(row) {
  try {
    // Discard the kernel comm field; retain only numeric birth ticks.
    const fields = bounded(`/proc/${row.pid}/stat`, 4096).toString('utf8');
    const values = fields.slice(fields.lastIndexOf(')') + 2).split(/\s+/u);
    const birth = values[19];
    if (!/^\d+$/u.test(birth ?? '')) throw new Error('Invalid process birth identity');
    return {
      pid: row.pid,
      state: values[0],
      ppid: Number(values[1]),
      pgid: Number(values[2]),
      birth,
    };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return null;
    throw error;
  }
}
function admit(actor, current, rootProcess = false) {
  if (!current) throw new Error('Numeric process birth identity is unavailable at admission');
  if (actor.groups.size === PROCESS_LIMIT && !actor.groups.has(current.pgid)) {
    throw new Error('Owned process-group admission limit exceeded');
  }
  const prior = actor.owned.get(current.pid);
  if (prior) {
    if (prior.birth !== current.birth) throw new Error('Owned PID was reused');
    actor.owned.set(current.pid, current);
    actor.groups.add(current.pgid);
    return false;
  }
  if (actor.owned.size === PROCESS_LIMIT) throw new Error('Owned process admission limit exceeded');
  const parent = actor.owned.get(current.ppid);
  const actualParent = parent && identity(parent);
  const groupOwned = [...actor.owned.values()].some((owned) => {
    const actual = identity(owned);
    return actual && actual.birth === owned.birth && actual.pgid === current.pgid;
  });
  if (rootProcess) {
    if (current.pid !== actor.pid || current.ppid !== process.pid || current.pgid !== actor.pid) {
      throw new Error('Detached root process identity is not owned by this supervisor');
    }
  } else if (!(actualParent && actualParent.birth === parent.birth) && !groupOwned) {
    throw new Error('Process identity has neither a verified owned parent nor an owned group');
  }
  actor.owned.set(current.pid, current);
  actor.groups.add(current.pgid);
  return true;
}
function sample(actor) {
  const rows = table();
  const supervisor = rows.get(process.pid);
  if (!supervisor) throw new Error('Supervisor process identity unavailable');
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows.values()) {
      if (row.pid === process.pid) continue;
      if (
        row.pid !== actor.pid &&
        !actor.owned.has(row.pid) &&
        !actor.owned.has(row.ppid) &&
        !actor.groups.has(row.pgid)
      )
        continue;
      const current = identity(row);
      if (!current) continue;
      if (current.pgid === supervisor.pgid)
        throw new Error('Owned child shares the supervisor group');
      if (admit(actor, current)) changed = true;
    }
  }
  return [...actor.owned.values()].flatMap((owned) => {
    const row = rows.get(owned.pid);
    const current = row && identity(row);
    return current && current.birth === owned.birth ? [current] : [];
  });
}
function listeners(live) {
  const inodes = new Set();
  for (const row of live) {
    let directory;
    try {
      directory = opendirSync(`/proc/${row.pid}/fd`);
      let count = 0;
      while (true) {
        const entry = directory.readSync();
        if (!entry) break;
        if (++count > 512) throw new Error('Owned descriptor admission limit exceeded');
        if (!/^\d+$/u.test(entry.name)) continue;
        try {
          const link = readlinkSync(`/proc/${row.pid}/fd/${entry.name}`);
          const inode = link.match(/^socket:\[(\d+)\]$/u)?.[1];
          if (inode) {
            if (inodes.size === 4096 && !inodes.has(inode)) {
              throw new Error('Owned socket admission limit exceeded');
            }
            inodes.add(inode);
          }
        } catch (error) {
          if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;
    } finally {
      directory?.closeSync();
    }
  }
  if (inodes.size > 4096) throw new Error('Owned socket admission limit exceeded');
  const ports = new Set();
  for (const name of ['tcp', 'tcp6']) {
    const rows = bounded(`/proc/net/${name}`).toString('utf8').trim().split('\n');
    if (rows.length > 4096) throw new Error('Socket table admission limit exceeded');
    for (const line of rows.slice(1)) {
      const fields = line.trim().split(/\s+/u);
      if (fields[3] !== '0A' || !inodes.has(fields[9])) continue;
      const [address, port] = fields[1].split(':');
      if (address !== '0100007F' && address !== '00000000000000000000000001000000') {
        throw new Error('Owned listener is outside the loopback proof boundary');
      }
      const number = Number.parseInt(port, 16);
      if (ports.size === 64 && !ports.has(number))
        throw new Error('Owned port admission limit exceeded');
      ports.add(number);
    }
  }
  return [...ports].sort((a, b) => a - b);
}
function entries(path) {
  const directory = opendirSync(path);
  const names = [];
  try {
    while (true) {
      const entry = directory.readSync();
      if (!entry) break;
      if (names.length === 64) throw new Error('Scratch inventory admission limit exceeded');
      names.push(entry.name);
    }
  } finally {
    directory.closeSync();
  }
  return names.sort();
}
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
function freePort(port) {
  return new Promise((done) => {
    const probe = createServer();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(value);
    };
    const timer = setTimeout(() => {
      try {
        probe.close();
      } catch {
        /* The failed probe is not product evidence. */
      }
      finish('unknown');
    }, 1000);
    probe.once('error', (error) => finish(error.code === 'EADDRINUSE' ? 'occupied' : 'unknown'));
    probe.listen(port, '127.0.0.1', () => probe.close(() => finish('free')));
  });
}
async function snapshot(actor) {
  const live = sample(actor);
  const ports = listeners(live);
  for (const set of [actor.ports, actor.kernelPorts]) {
    for (const port of ports) {
      if (set.size === 64 && !set.has(port)) throw new Error('Owned port admission limit exceeded');
      set.add(port);
    }
  }
  const availability = [];
  for (const port of [...actor.ports].sort((a, b) => a - b)) {
    availability.push({ port, state: await freePort(port) });
  }
  return { live, listeners: ports, availability, scratch: entries(actor.scratch) };
}
async function cleanup(actor) {
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    const live = sample(actor);
    const rows = table();
    for (const group of new Set(live.map((row) => row.pgid))) {
      const members = [...rows.values()].filter((row) => row.pgid === group);
      if (
        !members.every((row) => {
          const current = identity(row);
          return current && actor.owned.get(row.pid)?.birth === current.birth;
        })
      )
        throw new Error('Cleanup group contains an unowned process');
      if (members.length > 0) {
        try {
          process.kill(-group, signal);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
    }
    await delay(250);
  }
  if (sample(actor).some((row) => !row.state.startsWith('Z'))) {
    throw new Error('Owned process cleanup did not complete');
  }
  if (!actor.scratch.startsWith(`${work}/`)) throw new Error('Scratch cleanup containment failed');
  rmSync(actor.scratch, { recursive: true, force: true });
  actors.delete(actor);
}
function launch(label, command, args, env, observe) {
  if (Date.now() >= deadline && label !== 'restore-build') {
    throw new Error('Finite proof budget exhausted; no further scenario is admitted');
  }
  const caseRoot = join(work, label);
  mkdirSync(caseRoot);
  const scratch = join(caseRoot, 'tmp');
  mkdirSync(scratch);
  const child = spawn(command, args, {
    cwd: root,
    env: { ...env, TMPDIR: scratch },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!Number.isSafeInteger(child.pid)) throw new Error('Proof child did not spawn');
  const actor = {
    pid: child.pid,
    scratch,
    owned: new Map(),
    groups: new Set(),
    ports: new Set(),
    kernelPorts: new Set(),
    observer: null,
    invalid: false,
    outputTruncated: false,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    pending: '',
    exit: null,
    snapshots: [],
    label,
    observe,
    startedAt: Date.now(),
    endedAt: null,
  };
  actors.add(actor);
  admit(actor, identity({ pid: child.pid }), true);
  for (const stream of ['stdout', 'stderr']) {
    child[stream].on('data', (chunk) => {
      const capacity = LOG_BYTES - actor[stream].length;
      if (chunk.length > capacity) {
        actor.invalid = true;
        actor.outputTruncated = true;
      }
      actor[stream] = Buffer.concat([actor[stream], chunk.subarray(0, Math.max(0, capacity))]);
      if (stream !== 'stdout' || !observe) return;
      actor.pending += chunk.toString('utf8');
      if (actor.pending.length > LOG_BYTES) {
        actor.pending = '';
        actor.invalid = true;
        actor.outputTruncated = true;
        return;
      }
      while (true) {
        const newline = actor.pending.indexOf('\n');
        if (newline === -1) break;
        const line = actor.pending.slice(0, newline);
        actor.pending = actor.pending.slice(newline + 1);
        const match = line.match(/^NODEVIDEO_RESOURCE_(CHILD|LISTENER|EXIT) (.+)$/u);
        if (!match) continue;
        try {
          if (Buffer.byteLength(line) > 16384) throw new Error('Observer line exceeds cap');
          const value = JSON.parse(match[2]);
          if (match[1] === 'CHILD') {
            if (!Number.isSafeInteger(value.pid) || value.pid < 1) {
              throw new Error('Invalid child observation');
            }
            // Numeric hints never grant ownership: bind birth and parent/group now.
            admit(actor, identity({ pid: value.pid }));
          } else if (match[1] === 'LISTENER') {
            if (
              !Number.isInteger(value.port) ||
              value.port < 1 ||
              value.port > 65535 ||
              (actor.ports.size === 64 && !actor.ports.has(value.port))
            ) {
              throw new Error('Invalid listener observation');
            }
            actor.ports.add(value.port);
          } else {
            if (actor.observer) throw new Error('Duplicate exit receipt');
            actor.observer = value;
          }
        } catch {
          actor.invalid = true;
        }
      }
    });
  }
  child.once('error', () => {
    actor.invalid = true;
  });
  child.once('exit', (code, signal) => {
    actor.exit = { code, signal };
    actor.endedAt = Date.now();
  });
  return actor;
}
async function settle(actor, budget, restoring = false) {
  const stop = restoring ? Date.now() + budget : Math.min(deadline, Date.now() + budget);
  try {
    while (!actor.exit && Date.now() < stop) {
      const live = sample(actor);
      if (actor.observe && actor.kernelPorts.size < 2) {
        for (const port of listeners(live)) {
          if (actor.kernelPorts.size === 64 && !actor.kernelPorts.has(port)) {
            throw new Error('Owned port admission limit exceeded');
          }
          actor.kernelPorts.add(port);
        }
      }
      await delay(200);
    }
    actor.timedOut = !actor.exit;
    if (!actor.timedOut) {
      for (const wait of [0, 500, 1500, 3000]) {
        if (wait) await delay(wait);
        actor.snapshots.push(await snapshot(actor));
      }
    } else actor.snapshots.push(await snapshot(actor));
    // Drain already-produced pipe bytes without adding work to the verifier.
    await delay(50);
  } finally {
    writeFileSync(join(output, `${actor.label}.stdout.log`), actor.stdout);
    writeFileSync(join(output, `${actor.label}.stderr.log`), actor.stderr);
  }
  return actor;
}
function result(actor, source, negative) {
  const receipt = actor.observer;
  const last = actor.snapshots.at(-1);
  const observationValid =
    !actor.invalid &&
    actor.portEvidenceValid === true &&
    receipt?.pid === actor.pid &&
    /^22\./u.test(receipt?.node ?? '') &&
    receipt.invalid === false &&
    Array.isArray(receipt.servers) &&
    receipt.servers.length > 0 &&
    receipt.servers.length <= 64 &&
    Array.isArray(receipt.children) &&
    receipt.children.length <= 64 &&
    (negative && negative !== 'wrong-hash' ? true : receipt.children.length > 0);
  const closure =
    !actor.timedOut &&
    last &&
    last.live.length === 0 &&
    last.listeners.length === 0 &&
    last.availability.every((row) => row.state === 'free') &&
    last.scratch.length === 0 &&
    receipt?.servers.every((server) => server.listening === false);
  const expectedExit =
    !actor.exit?.signal &&
    (negative
      ? actor.exit?.code === 1 &&
        (negative === 'wrong-hash'
          ? receipt?.uncaught === false &&
            receipt?.beforeExit === false &&
            actor.stderr.toString('utf8').includes('build receipt contractSha256') &&
            actor.stderr.toString('utf8').includes('UI contract verification FAILED')
          : receipt?.uncaught === true && actor.causeBound === true)
      : actor.exit?.code === 0 && receipt?.beforeExit === true && receipt?.uncaught === false);
  return {
    source,
    case: actor.label,
    exit: actor.exit,
    timedOut: actor.timedOut,
    outputTruncated: actor.outputTruncated,
    observationValid,
    expectedExit,
    closure,
    causeBound: actor.causeBound ?? null,
    input: actor.input ?? null,
    listenerEvidence: actor.listenerEvidence ?? null,
    startedAt: actor.startedAt,
    endedAt: actor.endedAt,
    passed: Boolean(observationValid && expectedExit && closure),
    observer: receipt,
    snapshots: actor.snapshots,
  };
}
async function prove(commit, phase, preload) {
  for (const port of [4327, 4339]) {
    if ((await freePort(port)) !== 'free')
      throw new Error('Proof boundary contains an occupied preferred port');
  }
  const receiptPath = join(root, 'dist/.well-known/agent-ui.build.json');
  const receiptBytes = bounded(receiptPath, 65536);
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  const contractBytes = bounded(join(root, 'dist/.well-known/agent-ui.json'));
  if (receipt.sourceCommit !== commit || receipt.contractSha256 !== hash(contractBytes)) {
    throw new Error('Build source/contract identity does not match the selected source');
  }
  const env = { ...process.env, NODEVIDEO_CONTRACT_PORT: '4327' };
  const sourceLines = bounded(join(root, 'scripts/quality/verify-ui-contract.mjs'))
    .toString('utf8')
    .split('\n');
  const callerLine = (text) => {
    const lines = sourceLines.flatMap((line, index) => (line.includes(text) ? [index + 1] : []));
    if (lines.length !== 1) throw new Error('Negative-input caller is not uniquely source-bound');
    return lines[0];
  };
  const receiptLine = callerLine('await receiptResponse.json()');
  const browserLine = callerLine('await chromium.launch()');
  const source = sourceLines.join('\n');
  const legacy =
    source.includes('const preview = spawn(') && source.includes('const mockPort = 4339;');
  const ownedPreview =
    source.includes('previewServer = await preview(') &&
    source.includes("mockSidecar.listen(0, '127.0.0.1'");
  if (legacy === ownedPreview) throw new Error('Verifier acquisition profile is not admitted');
  const run = (name, failure = null) =>
    launch(
      `${phase}-${name}`,
      process.execPath,
      ['--require', preload, join(root, 'scripts/quality/verify-ui-contract.mjs')],
      failure === 'missing-browser'
        ? { ...env, PLAYWRIGHT_BROWSERS_PATH: join(work, 'empty-browsers') }
        : env,
      true,
    );
  const observe = async (actor, failure) => {
    await settle(actor, 60_000);
    const stderr = actor.stderr.toString('utf8');
    if (failure === 'malformed-receipt') {
      actor.causeBound =
        stderr.includes('SyntaxError:') &&
        stderr.includes('JSON.parse') &&
        stderr.includes(`verify-ui-contract.mjs:${receiptLine}:`);
    }
    if (failure === 'missing-browser') {
      actor.causeBound =
        stderr.includes("browserType.launch: Executable doesn't exist") &&
        stderr.includes(join(work, 'empty-browsers')) &&
        stderr.includes(`verify-ui-contract.mjs:${browserLine}:`);
    }
    const observed = actor.observer?.servers ?? [];
    const ports = observed.flatMap((server) =>
      Number.isInteger(server.port) ? [server.port] : [],
    );
    const stdout = actor.stdout.toString('utf8');
    const previews = [
      ...stdout.matchAll(/^Verifying build at http:\/\/127\.0\.0\.1:(\d+)$/gmu),
    ].map((match) => Number(match[1]));
    const fixtures = [
      ...stdout.matchAll(/^Serving contract fixtures at http:\/\/127\.0\.0\.1:(\d+)$/gmu),
    ].map((match) => Number(match[1]));
    if (ownedPreview) {
      actor.portEvidenceValid =
        previews.length === 1 &&
        ports.includes(previews[0]) &&
        (failure === 'malformed-receipt' || (fixtures.length === 1 && ports.includes(fixtures[0])));
      actor.actualPorts = [...previews, ...fixtures];
    } else {
      // The legacy probe is not the spawned Vite listener. Observe that
      // descendant's real kernel-owned port, including fallback/collision.
      actor.portEvidenceValid =
        ports.some((port) => port !== 4339) && [...actor.kernelPorts].some((port) => port !== 4339);
      actor.actualPorts = [...actor.kernelPorts, ...ports.filter((port) => port === 4339)];
    }
    actor.listenerEvidence = {
      profile: legacy ? 'legacy-child' : 'owned-preview',
      tracedPorts: ports,
      kernelOwnedPorts: [...actor.kernelPorts].sort((a, b) => a - b),
      declaredPreviewPorts: previews,
      declaredFixturePorts: fixtures,
    };
    const actual = result(actor, commit, failure);
    report.cases.push(actual);
    if (!actual.observationValid) failed = true;
    if (phase === 'after' && !actual.passed) failed = true;
  };
  const finish = async (actor, failure) => {
    try {
      await observe(actor, failure);
    } finally {
      await cleanup(actor);
    }
  };
  for (const name of ['normal', 'repeat']) await finish(run(name), null);
  const pair = [run('concurrent-1'), run('concurrent-2')];
  let acquiredTogether = null;
  const sharedObservation = async () => {
    while (pair.every((actor) => !actor.exit) && Date.now() < deadline) {
      const startedAt = Date.now();
      const inventories = pair.map((actor) => {
        const live = sample(actor);
        return { pid: actor.pid, birth: actor.owned.get(actor.pid).birth, ports: listeners(live) };
      });
      const disjoint = !inventories[0].ports.some((port) => inventories[1].ports.includes(port));
      if (
        inventories.every((inventory) => inventory.ports.length >= 2) &&
        disjoint &&
        pair.every((actor) => !actor.exit)
      ) {
        acquiredTogether = { startedAt, endedAt: Date.now(), inventories };
        return;
      }
      await delay(200);
    }
  };
  let outcomes;
  try {
    outcomes = await Promise.allSettled([
      ...pair.map((actor) => observe(actor, null)),
      sharedObservation(),
    ]);
    const overlap =
      pair.every((actor) => actor.endedAt !== null) &&
      Math.max(...pair.map((actor) => actor.startedAt)) <
        Math.min(...pair.map((actor) => actor.endedAt));
    const sharedPorts = (pair[0].actualPorts ?? []).filter((port) =>
      pair[1].actualPorts?.includes(port),
    );
    report.concurrent ??= [];
    report.concurrent.push({ source: commit, overlap, sharedPorts, acquiredTogether });
    if (!overlap || (phase === 'after' && (sharedPorts.length !== 0 || !acquiredTogether))) {
      failed = true;
    }
  } finally {
    // Preserve both concurrent observations before any deliberate cleanup.
    for (const actor of pair) await cleanup(actor);
  }
  if (outcomes.some((outcome) => outcome.status === 'rejected')) {
    throw new Error('Concurrent proof observation or owned cleanup failed');
  }
  for (const failure of ['missing-browser', 'malformed-receipt', 'wrong-hash']) {
    let operationError = null;
    try {
      if (failure === 'malformed-receipt') writeFileSync(receiptPath, '{invalid-json');
      if (failure === 'wrong-hash') {
        writeFileSync(receiptPath, JSON.stringify({ ...receipt, contractSha256: '0'.repeat(64) }));
      }
      const actor = run(failure, failure);
      actor.input = {
        failure,
        receiptOriginalSha256: hash(receiptBytes),
        receiptPresentedSha256: hash(bounded(receiptPath, 65536)),
        callerLine: failure === 'missing-browser' ? browserLine : receiptLine,
      };
      await finish(actor, failure);
    } catch (error) {
      operationError = error;
    }
    let restorationError = null;
    try {
      writeFileSync(receiptPath, receiptBytes);
      if (hash(bounded(receiptPath, 65536)) !== hash(receiptBytes)) {
        throw new Error('Negative receipt restoration failed');
      }
    } catch (error) {
      restorationError = error;
    }
    if (restorationError) {
      report.negativeRestorationFailure = {
        case: failure,
        operationError: operationError?.message ?? null,
        restorationError: restorationError.message,
      };
      throw new AggregateError(
        [operationError, restorationError].filter(Boolean),
        'Negative receipt restoration failed; no later case admitted',
      );
    }
    if (operationError) throw operationError;
  }
}
async function build(commit, phase) {
  const actor = launch(
    `${phase}-build`,
    'npm',
    ['run', 'build'],
    {
      ...process.env,
      GITHUB_SHA: commit,
      VERCEL_GIT_COMMIT_SHA: commit,
    },
    false,
  );
  try {
    await settle(actor, restoreBudget, phase === 'restore');
    if (actor.invalid || actor.timedOut || actor.exit?.code !== 0 || actor.exit?.signal) {
      throw new Error('Selected source normal build failed or exceeded the proof budget');
    }
  } finally {
    await cleanup(actor);
  }
}
async function restoreOriginal() {
  if (git(['rev-parse', 'HEAD']) !== original) git(['checkout', '--detach', original]);
  sourceGuard(original, originalTree);
  if (!originalBuildReady && work && output) {
    await build(original, 'restore');
    originalBuildReady = true;
  }
  for (const entry of report.packageGraph ?? []) {
    if (hash(bounded(join(root, entry.path))) !== entry.sha256) {
      throw new Error('Final package/lock guard changed');
    }
  }
  for (const entry of report.installedGraph ?? []) {
    if (hash(bounded(join(root, entry.path))) !== entry.sha256) {
      throw new Error('Installed graph metadata changed during the comparison');
    }
  }
  const receipt = JSON.parse(bounded(join(root, 'dist/.well-known/agent-ui.build.json'), 65536));
  if (
    !originalBuildReady ||
    receipt.sourceCommit !== original ||
    receipt.contractSha256 !== hash(bounded(join(root, 'dist/.well-known/agent-ui.json')))
  ) {
    throw new Error('Original normal build identity was not restored');
  }
  report.restoration = { source: true, packageGraph: true, build: true };
}
try {
  if (
    process.platform !== 'linux' ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    !/^22\./u.test(process.versions.node)
  ) {
    throw new Error('This proof is admitted only in the normal Linux Node 22 GitHub job');
  }
  const args = process.argv.slice(2);
  let baseline = null;
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--baseline' || !/^[a-f0-9]{40}$/u.test(args[1])) {
      throw new Error('Expected only optional --baseline with a complete commit SHA');
    }
    baseline = args[1];
  }
  original = git(['rev-parse', 'HEAD']);
  originalTree = git(['rev-parse', 'HEAD^{tree}']);
  sourceGuard(original, originalTree);
  report.node = process.versions.node;
  report.original = { commit: original, tree: originalTree };
  report.baseline = baseline;
  report.limits = [
    'consent-scratch exception',
    'rejected close',
    'interruption',
    'sustained accumulation',
  ];
  const proposedOutput = join(root, '.qa/evidence/contract-resources');
  if (existsSync(proposedOutput))
    throw new Error('Proof output already exists; preserve it rather than overwrite');
  mkdirSync(proposedOutput, { recursive: true });
  if (!realpathSync(proposedOutput).startsWith(`${realpathSync(root)}/`)) {
    throw new Error('Proof output containment failed');
  }
  output = proposedOutput;
  const graph = ['package.json', 'package-lock.json'].map((path) => {
    const current = bounded(join(root, path));
    if (baseline) {
      const before = execFileSync('git', ['show', `${baseline}:${path}`], {
        cwd: root,
        timeout: 10_000,
        maxBuffer: MAX_BYTES,
      });
      if (!current.equals(before))
        throw new Error('Baseline package/lock differs: comparison is incomparable');
    }
    return { path, sha256: hash(current) };
  });
  report.packageGraph = graph;
  const installedPaths = [
    'node_modules/.package-lock.json',
    'node_modules/vite/package.json',
    'node_modules/playwright/package.json',
  ];
  if (realpathSync(join(root, 'node_modules')) !== join(realpathSync(root), 'node_modules')) {
    throw new Error('Installed graph is not owned at this job source root');
  }
  report.installedGraph = installedPaths.map((path) => ({
    path,
    sha256: hash(bounded(join(root, path))),
  }));
  const locked = JSON.parse(bounded(join(root, 'package-lock.json')));
  for (const name of ['vite', 'playwright']) {
    const installed = JSON.parse(bounded(join(root, `node_modules/${name}/package.json`)));
    if (installed.version !== locked.packages[`node_modules/${name}`]?.version) {
      throw new Error('Installed Vite/Playwright version does not match the locked graph');
    }
  }
  work = mkdtempSync(join(tmpdir(), 'nodevideo-resource-proof-'));
  mkdirSync(join(work, 'empty-browsers'));
  const preload = join(work, 'observer.cjs');
  copyFileSync(join(root, 'scripts/quality/observe-ui-contract-resources.cjs'), preload);
  report.preloadSha256 = hash(bounded(preload, 65536));
  if (baseline) {
    const tree = git(['rev-parse', `${baseline}^{tree}`]);
    git(['checkout', '--detach', baseline]);
    originalBuildReady = false;
    sourceGuard(baseline, tree);
    report.sources.push({ phase: 'before', commit: baseline, tree });
    await build(baseline, 'before');
    await prove(baseline, 'before', preload);
    git(['checkout', '--detach', original]);
    sourceGuard(original, originalTree);
    await build(original, 'after');
    originalBuildReady = true;
  }
  report.sources.push({ phase: 'after', commit: original, tree: originalTree });
  await prove(original, 'after', preload);
} catch (error) {
  failed = true;
  report.error = error.message;
} finally {
  for (const actor of actors) {
    try {
      await cleanup(actor);
    } catch (error) {
      failed = true;
      report.cleanupError = error.message;
    }
  }
  if (original) {
    try {
      await restoreOriginal();
    } catch (error) {
      failed = true;
      report.restorationError = error.message;
    }
  }
  report.status = failed ? 'FAIL' : 'PASS';
  if (output) {
    const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
    if (bytes.length > 4 * MAX_BYTES) {
      failed = true;
      report.status = 'FAIL';
      writeFileSync(
        join(output, 'result.json'),
        JSON.stringify({
          schema: report.schema,
          status: 'FAIL',
          error: 'Result exceeded its four-MiB admission limit',
          observedCases: report.cases.length,
        }),
      );
    } else writeFileSync(join(output, 'result.json'), bytes);
  }
  if (work && actors.size === 0) rmSync(work, { recursive: true, force: true });
}
console.log(`UI contract resource proof: ${report.status}; ${report.cases.length} observed cases`);
if (report.error) console.error(report.error);
process.exitCode = failed ? 1 : 0;
