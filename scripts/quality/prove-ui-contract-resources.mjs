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
let firstObservationError = null;

// Only fixed owners, admitted identities and this source's numeric locations enter
// the two failure records. Native messages, paths, arguments and environment do not.
function rememberResourceFailure(error, owner, context, cleanup = false) {
  const key = cleanup ? 'cleanupFailure' : 'observationFailure';
  if (report[key]) return;
  if (!cleanup) firstObservationError = error;
  const frames = [];
  const stack =
    typeof error?.stack === 'string'
      ? Buffer.from(error.stack.slice(0, 4096)).subarray(0, 4096).toString('utf8')
      : '';
  for (const line of stack.split('\n')) {
    if (!/^\s+at /u.test(line)) continue;
    const location = line.match(
      /\/scripts\/quality\/prove-ui-contract-resources\.mjs:(\d+):(\d+)\)?$/u,
    );
    if (!location) continue;
    const lineNumber = Number(location[1]);
    const column = Number(location[2]);
    if (!Number.isSafeInteger(lineNumber) || !Number.isSafeInteger(column)) continue;
    if (lineNumber < 1 || column < 1) continue;
    frames.push({ line: lineNumber, column });
    if (frames.length === 8) break;
  }
  const caseLabel =
    typeof context.case === 'string' &&
    /^(?:(?:before|after)-(?:normal|repeat|concurrent-[12]|missing-browser|malformed-receipt|wrong-hash|build)|restore-build)$/u.test(
      context.case,
    )
      ? context.case
      : null;
  const pid = Number.isSafeInteger(context.pid) && context.pid > 0 ? context.pid : null;
  const birth =
    typeof context.birth === 'string' && /^\d{1,64}$/u.test(context.birth) ? context.birth : null;
  const sampledIdentity =
    owner === 'proc-fd-inventory'
      ? {
          state:
            typeof context.state === 'string' && /^[RSDZTtXxKWPI]$/u.test(context.state)
              ? context.state
              : null,
          numThreads:
            Number.isSafeInteger(context.numThreads) && context.numThreads > 0
              ? context.numThreads
              : null,
        }
      : null;
  let identityReadback = null;
  if (
    !cleanup &&
    owner === 'proc-fd-inventory' &&
    error?.code === 'EACCES' &&
    pid !== null &&
    birth !== null
  ) {
    try {
      // One bounded same-PID stat read. It diagnoses this denial, never admits
      // ownership, retries fd access or replaces the original operation error.
      const current = identity({ pid });
      identityReadback = {
        status:
          current === null ? 'gone' : current.birth === birth ? 'same-birth' : 'changed-identity',
        state:
          typeof current?.state === 'string' && /^[RSDZTtXxKWPI]$/u.test(current.state)
            ? current.state
            : null,
        numThreads: current?.numThreads ?? null,
      };
    } catch {
      identityReadback = { status: 'unreadable', state: null, numThreads: null };
    }
  }
  report[key] = {
    owner,
    code:
      typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/u.test(error.code)
        ? error.code
        : null,
    syscall: [
      'opendir',
      'readdir',
      'closedir',
      'readlink',
      'open',
      'write',
      'close',
      'scandir',
      'unlink',
      'rmdir',
      'lstat',
      'kill',
    ].includes(error?.syscall)
      ? error.syscall
      : null,
    errno: Number.isSafeInteger(error?.errno) ? error.errno : null,
    pid,
    birth,
    case: caseLabel,
    sampledIdentity,
    taskIdentity:
      owner === 'proc-fd-inventory' && Number.isSafeInteger(context.tid) && context.tid > 0
        ? {
            tid: context.tid,
            birth:
              typeof context.taskBirth === 'string' && /^\d{1,64}$/u.test(context.taskBirth)
                ? context.taskBirth
                : null,
            state:
              typeof context.taskState === 'string' && /^[RSDZTtXxKWPI]$/u.test(context.taskState)
                ? context.taskState
                : null,
          }
        : null,
    identityReadback,
    frames,
  };
}
function readOwnedDirectory(path, owner, context, consume) {
  let directory;
  let value;
  let operationError = null;
  try {
    directory = opendirSync(path);
    value = consume(directory);
  } catch (error) {
    // Retain the existing proc-disappearance races; no permission failure is absent.
    if (owner !== 'proc-fd-inventory' || (error.code !== 'ENOENT' && error.code !== 'ESRCH')) {
      rememberResourceFailure(error, owner, context);
      operationError = error;
    }
  }
  let closeError = null;
  try {
    directory?.closeSync();
  } catch (error) {
    rememberResourceFailure(error, owner, context, true);
    closeError = error;
  }
  if (operationError) throw operationError;
  if (closeError) throw closeError;
  return value;
}

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
    const threads = /^\d{1,16}$/u.test(values[17] ?? '') ? Number(values[17]) : null;
    if (!/^\d+$/u.test(birth ?? '')) throw new Error('Invalid process birth identity');
    return {
      pid: row.pid,
      state: values[0],
      ppid: Number(values[1]),
      pgid: Number(values[2]),
      birth,
      numThreads: Number.isSafeInteger(threads) && threads > 0 ? threads : null,
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
function listeners(live, caseLabel) {
  if (
    !/^(?:(?:before|after)-(?:normal|repeat|concurrent-[12]|missing-browser|malformed-receipt|wrong-hash|build)|restore-build)$/u.test(
      caseLabel,
    )
  ) {
    throw new Error('Task inventory has no admitted case label');
  }
  report.taskInventories ??= [];
  let counters = report.taskInventories.find((entry) => entry.case === caseLabel);
  if (!counters) {
    if (report.taskInventories.length === 17) throw new Error('Task inventory case limit exceeded');
    counters = {
      case: caseLabel,
      callsStarted: 0,
      callsCompleted: 0,
      taskStatsRead: 0,
      liveFdViews: 0,
      terminalTasks: 0,
      vanishedTasks: 0,
      vanishedGroups: 0,
    };
    report.taskInventories.push(counters);
  }
  function count(field) {
    if (!Number.isSafeInteger(counters[field]) || counters[field] === Number.MAX_SAFE_INTEGER) {
      throw new Error('Task inventory counter limit exceeded');
    }
    counters[field] += 1;
  }
  count('callsStarted');
  const inodes = new Set();
  let taskRows = 0;
  for (const row of live) {
    const context = { ...row, case: caseLabel };
    function leader() {
      const current = identity(row);
      if (current && (current.birth !== row.birth || current.pgid !== row.pgid)) {
        throw new Error('Owned group identity changed during task inventory');
      }
      return current;
    }
    function task(tid, prior = null) {
      try {
        const fields = bounded(`/proc/${row.pid}/task/${tid}/stat`, 4096).toString('utf8');
        const pid = fields.match(/^([1-9]\d{0,15}) \(/u)?.[1];
        const values = fields.slice(fields.lastIndexOf(')') + 2).split(/\s+/u);
        const pgid = Number(values[2]);
        if (
          Number(pid) !== tid ||
          !/^[RSDZTtXxKWPI]$/u.test(values[0] ?? '') ||
          !Number.isSafeInteger(pgid) ||
          pgid < 1 ||
          pgid !== row.pgid ||
          !/^\d{1,64}$/u.test(values[19] ?? '')
        ) {
          throw new Error('Owned task stat has an invalid path, state, group or birth');
        }
        count('taskStatsRead');
        return { tid, state: values[0], birth: values[19] };
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ESRCH') return null;
        rememberResourceFailure(error, 'proc-fd-inventory', {
          ...context,
          tid,
          taskBirth: prior?.birth,
          taskState: prior?.state,
        });
        throw error;
      }
    }
    try {
      if (!leader()) {
        count('vanishedGroups');
        continue;
      }
      const tids = readOwnedDirectory(
        `/proc/${row.pid}/task`,
        'proc-fd-inventory',
        context,
        (directory) => {
          const rows = [];
          const seen = new Set();
          while (true) {
            const entry = directory.readSync();
            if (!entry) break;
            taskRows += 1;
            if (taskRows > PROCESS_LIMIT) throw new Error('Owned task admission limit exceeded');
            const tid = Number(entry.name);
            if (
              !/^[1-9]\d{0,15}$/u.test(entry.name) ||
              !Number.isSafeInteger(tid) ||
              seen.has(tid)
            ) {
              throw new Error('Owned task directory has an invalid numeric identity');
            }
            seen.add(tid);
            rows.push(tid);
          }
          return rows.sort((a, b) => a - b);
        },
      );
      if (!leader()) {
        count('vanishedGroups');
        continue;
      }
      if (!tids || tids.length === 0)
        throw new Error('Present owned group has no readable task inventory');
      for (const tid of tids) {
        const current = task(tid);
        if (!current) {
          leader();
          count('vanishedTasks');
          continue;
        }
        if (current.state === 'Z') {
          // A terminal task released its own file-table reference before Z.
          // Its group and all remaining PID records still require observation.
          count('terminalTasks');
          continue;
        }
        const taskContext = { ...context, tid, taskBirth: current.birth, taskState: current.state };
        const complete = readOwnedDirectory(
          `/proc/${row.pid}/task/${tid}/fd`,
          'proc-fd-inventory',
          taskContext,
          (directory) => {
            let descriptors = 0;
            while (true) {
              const entry = directory.readSync();
              if (!entry) break;
              descriptors += 1;
              if (descriptors > 512) throw new Error('Owned descriptor admission limit exceeded');
              if (!/^\d+$/u.test(entry.name)) continue;
              try {
                const link = readlinkSync(`/proc/${row.pid}/task/${tid}/fd/${entry.name}`);
                const inode = link.match(/^socket:\[(\d+)\]$/u)?.[1];
                if (inode) {
                  if (inodes.size === 4096 && !inodes.has(inode))
                    throw new Error('Owned socket admission limit exceeded');
                  inodes.add(inode);
                }
              } catch (error) {
                if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;
              }
            }
            return true;
          },
        );
        const after = task(tid, current);
        leader();
        if (!after) {
          count('vanishedTasks');
          continue;
        }
        if (after.birth !== current.birth || !complete) {
          const error = new Error(
            after.birth !== current.birth
              ? 'Owned task birth changed during descriptor inventory'
              : 'Present owned task has no readable descriptor inventory',
          );
          rememberResourceFailure(error, 'proc-fd-inventory', taskContext);
          throw error;
        }
        count('liveFdViews');
      }
      leader();
    } catch (error) {
      rememberResourceFailure(error, 'proc-fd-inventory', context);
      throw error;
    }
  }
  if (inodes.size > 4096) throw new Error('Owned socket admission limit exceeded');
  const endpoints = new Map();
  for (const name of ['tcp', 'tcp6']) {
    const rows = bounded(`/proc/net/${name}`).toString('utf8').trim().split('\n');
    if (rows.length > 4096) throw new Error('Socket table admission limit exceeded');
    for (const line of rows.slice(1)) {
      const fields = line.trim().split(/\s+/u);
      if (fields[3] !== '0A' || !inodes.has(fields[9])) continue;
      const [address, port] = fields[1].split(':');
      const family = name === 'tcp' ? 'IPv4' : 'IPv6';
      const nativeAddress =
        name === 'tcp'
          ? { '0100007F': '127.0.0.1', '00000000': '0.0.0.0' }[address]
          : {
              '00000000000000000000000001000000': '::1',
              '00000000000000000000000000000000': '::',
            }[address];
      const number = Number.parseInt(port, 16);
      const endpoint = {
        address: nativeAddress,
        family,
        port: number,
        kind: nativeAddress === '127.0.0.1' || nativeAddress === '::1' ? 'loopback' : 'wildcard',
      };
      if (!/^[A-Fa-f0-9]{4}$/u.test(port ?? '') || !tcpEndpoint(endpoint)) {
        throw new Error('Owned listener has an unsupported TCP address/family/port');
      }
      const key = `${family}:${nativeAddress}:${number}`;
      if (endpoints.size === 64 && !endpoints.has(key)) {
        throw new Error('Owned listener admission limit exceeded');
      }
      endpoints.set(key, endpoint);
    }
  }
  count('callsCompleted');
  return [...endpoints.values()].sort(
    (a, b) =>
      a.port - b.port || a.family.localeCompare(b.family) || a.address.localeCompare(b.address),
  );
}
function tcpEndpoint(value) {
  const kind =
    (value?.family === 'IPv4' && value.address === '127.0.0.1') ||
    (value?.family === 'IPv6' && value.address === '::1')
      ? 'loopback'
      : (value?.family === 'IPv4' && value.address === '0.0.0.0') ||
          (value?.family === 'IPv6' && value.address === '::')
        ? 'wildcard'
        : null;
  return (
    kind !== null &&
    value.kind === kind &&
    Number.isInteger(value.port) &&
    value.port > 0 &&
    value.port <= 65535
  );
}
function retainListeners(actor, endpoints) {
  for (const endpoint of endpoints) {
    const key = `${endpoint.family}:${endpoint.address}:${endpoint.port}`;
    if (actor.ports.size === 64 && !actor.ports.has(key)) {
      throw new Error('Observed listener admission limit exceeded');
    }
    actor.ports.set(key, endpoint);
    if (endpoint.kind === 'loopback') {
      if (actor.kernelPorts.size === 64 && !actor.kernelPorts.has(endpoint.port)) {
        throw new Error('Owned loopback port admission limit exceeded');
      }
      actor.kernelPorts.add(endpoint.port);
    }
  }
}
function entries(path, caseLabel) {
  const names = [];
  readOwnedDirectory(path, 'scratch-inventory', { case: caseLabel }, (directory) => {
    while (true) {
      const entry = directory.readSync();
      if (!entry) break;
      if (names.length === 64) throw new Error('Scratch inventory admission limit exceeded');
      names.push(entry.name);
    }
  });
  return names.sort();
}
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
function freePort(port, family = 'IPv4') {
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
    probe.listen(port, family === 'IPv6' ? '::1' : '127.0.0.1', () =>
      probe.close(() => finish('free')),
    );
  });
}
async function snapshot(actor) {
  const live = sample(actor);
  const endpoints = listeners(live, actor.label);
  retainListeners(actor, endpoints);
  const availability = [];
  for (const endpoint of actor.ports.values()) {
    availability.push({ ...endpoint, state: await freePort(endpoint.port, endpoint.family) });
  }
  return { live, listeners: endpoints, availability, scratch: entries(actor.scratch, actor.label) };
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
  try {
    rmSync(actor.scratch, { recursive: true, force: true });
  } catch (error) {
    rememberResourceFailure(error, 'scratch-cleanup', { case: actor.label }, true);
    throw error;
  }
  actors.delete(actor);
}
async function withOwnedCleanup(group, operation) {
  let operationError = null;
  try {
    await operation();
  } catch (error) {
    operationError = error;
  }
  let cleanupError = null;
  let cleanupActor;
  try {
    for (const actor of group) {
      cleanupActor = actor;
      await cleanup(actor);
    }
  } catch (error) {
    rememberResourceFailure(error, 'owned-cleanup', { case: cleanupActor.label }, true);
    cleanupError = error;
  }
  // Preserve the original operation object when cleanup also rejects; both
  // diagnostics remain in the report and no subsequent case can be admitted.
  if (operationError) throw operationError;
  if (cleanupError) throw cleanupError;
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
    ports: new Map(),
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
            if (!tcpEndpoint(value)) throw new Error('Invalid TCP listener observation');
            const key = `${value.family}:${value.address}:${value.port}`;
            if (actor.ports.size === 64 && !actor.ports.has(key)) {
              throw new Error('Observed listener admission limit exceeded');
            }
            actor.ports.set(key, value);
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
async function settle(group, budget, restoring = false) {
  const stop = restoring ? Date.now() + budget : Math.min(deadline, Date.now() + budget);
  let operationError = null;
  try {
    while (group.some((actor) => !actor.exit) && Date.now() < stop) {
      for (const actor of group) {
        const live = sample(actor);
        if (actor.observe) retainListeners(actor, listeners(live, actor.label));
      }
      await delay(200);
    }
    for (const actor of group) actor.timedOut = !actor.exit;
    if (group.every((actor) => !actor.timedOut)) {
      for (const wait of [0, 500, 1500, 3000]) {
        if (wait) await delay(wait);
        // Both roots have ended. Serialize probes so shared closed probe ports
        // cannot be occupied by the other verifier or by this supervisor itself.
        for (const actor of group) actor.snapshots.push(await snapshot(actor));
      }
    } else {
      for (const actor of group) actor.snapshots.push(await snapshot(actor));
    }
    // Drain already-produced pipe bytes without adding work to the verifier.
    await delay(50);
  } catch (error) {
    operationError = error;
  }
  let logError = null;
  let logActor;
  try {
    for (const actor of group) {
      logActor = actor;
      writeFileSync(join(output, `${actor.label}.stdout.log`), actor.stdout);
      writeFileSync(join(output, `${actor.label}.stderr.log`), actor.stderr);
    }
  } catch (error) {
    rememberResourceFailure(error, 'settlement-log', { case: logActor.label }, true);
    logError = error;
  }
  if (operationError) throw operationError;
  if (logError) throw logError;
}
function result(actor, source, negative) {
  const receipt = actor.observer;
  const last = actor.snapshots.at(-1);
  const cleanupDiagnostic = /^ {2}FAIL (?:resource cleanup|browser launch scratch cleanup):/mu.test(
    actor.stderr.toString('utf8'),
  );
  const observationValid =
    !actor.invalid &&
    actor.portEvidenceValid === true &&
    receipt?.pid === actor.pid &&
    /^22\./u.test(receipt?.node ?? '') &&
    receipt.invalid === false &&
    Array.isArray(receipt.servers) &&
    receipt.servers.length > 0 &&
    receipt.servers.length <= 64 &&
    receipt.servers.every(
      (server) =>
        typeof server.closed === 'boolean' &&
        typeof server.listening === 'boolean' &&
        (server.port === null
          ? server.address === null &&
            server.family === null &&
            server.kind === null &&
            server.listening === false
          : tcpEndpoint(server) &&
            actor.ports.has(`${server.family}:${server.address}:${server.port}`)),
    ) &&
    Array.isArray(receipt.children) &&
    receipt.children.length <= 64 &&
    (negative && negative !== 'wrong-hash' ? true : receipt.children.length > 0);
  const closure =
    !cleanupDiagnostic &&
    !actor.timedOut &&
    last &&
    last.live.length === 0 &&
    last.listeners.length === 0 &&
    last.availability.every((row) => row.state === 'free') &&
    last.scratch.length === 0 &&
    receipt?.servers.every(
      (server) => server.listening === false && (server.port === null || server.closed === true),
    );
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
    cleanupDiagnostic,
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
  const observe = (actor, failure) => {
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
      tcpEndpoint(server) && server.address === '127.0.0.1' && server.family === 'IPv4'
        ? [server.port]
        : [],
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
      tracedListeners: observed,
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
    await withOwnedCleanup([actor], async () => {
      await settle([actor], 60_000);
      observe(actor, failure);
    });
  };
  for (const name of ['normal', 'repeat']) await finish(run(name), null);
  const pair = [run('concurrent-1'), run('concurrent-2')];
  let acquiredTogether = null;
  const sharedObservation = async () => {
    while (pair.every((actor) => !actor.exit && !actor.timedOut) && Date.now() < deadline) {
      const startedAt = Date.now();
      const inventories = pair.map((actor) => {
        const live = sample(actor);
        const endpoints = listeners(live, actor.label);
        retainListeners(actor, endpoints);
        return {
          pid: actor.pid,
          birth: actor.owned.get(actor.pid).birth,
          listeners: endpoints,
          ports: [
            ...new Set(
              endpoints
                .filter((endpoint) => endpoint.kind === 'loopback')
                .map((endpoint) => endpoint.port),
            ),
          ],
        };
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
  await withOwnedCleanup(pair, async () => {
    outcomes = await Promise.allSettled([settle(pair, 60_000), sharedObservation()]);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    if (rejected) throw firstObservationError ?? rejected.reason;
    for (const actor of pair) observe(actor, null);
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
    // Both concurrent observations still precede any deliberate cleanup.
  });
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
  await withOwnedCleanup([actor], async () => {
    await settle([actor], restoreBudget, phase === 'restore');
    if (actor.invalid || actor.timedOut || actor.exit?.code !== 0 || actor.exit?.signal) {
      throw new Error('Selected source normal build failed or exceeded the proof budget');
    }
  });
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
      rememberResourceFailure(error, 'owned-cleanup', { case: actor.label }, true);
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
