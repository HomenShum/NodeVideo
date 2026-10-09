// Passive Node 22 observer. Known payloads: nodejs/node v22.23.3
// lib/net.js (server listen tracing) and lib/internal/child_process.js.
// No recovery/error listeners, private handles, reports, patches or timers.
const { channel } = require('node:diagnostics_channel');
const { writeSync } = require('node:fs');

const servers = new Map();
const children = new Map();
let invalid = false;
let beforeExit = false;
let uncaught = false;
const emit = (kind, value) => {
  try {
    const line = `NODEVIDEO_RESOURCE_${kind} ${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(line) > 16384) invalid = true;
    else writeSync(1, line);
  } catch {
    invalid = true;
  }
};
const server = (message) => {
  const ref = message?.server;
  if (!ref || typeof ref.address !== 'function' || typeof ref.listening !== 'boolean') {
    invalid = true;
    return;
  }
  if (!servers.has(ref)) {
    if (servers.size === 64) {
      invalid = true;
      return;
    }
    const record = { address: null, family: null, port: null, kind: null, closed: false };
    servers.set(ref, record);
    ref.once('close', () => {
      record.closed = true;
    });
  }
  const address = ref.address();
  if (address === null) {
    if (ref.listening) invalid = true;
    return;
  }
  const kind =
    (address?.family === 'IPv4' && address.address === '127.0.0.1') ||
    (address?.family === 'IPv6' && address.address === '::1')
      ? 'loopback'
      : (address?.family === 'IPv4' && address.address === '0.0.0.0') ||
          (address?.family === 'IPv6' && address.address === '::')
        ? 'wildcard'
        : null;
  if (!kind || !Number.isInteger(address.port) || address.port < 1 || address.port > 65535) {
    invalid = true;
    return;
  }
  const record = servers.get(ref);
  if (
    record.port !== null &&
    (record.address !== address.address ||
      record.family !== address.family ||
      record.port !== address.port)
  ) {
    invalid = true;
    return;
  }
  Object.assign(record, {
    address: address.address,
    family: address.family,
    port: address.port,
    kind,
  });
  emit('LISTENER', { address: record.address, family: record.family, port: record.port, kind });
};
for (const event of ['asyncStart', 'asyncEnd', 'error']) {
  channel(`tracing:net.server.listen:${event}`).subscribe((message) => {
    try {
      server(message);
    } catch {
      invalid = true;
    }
  });
}
channel('child_process').subscribe((message) => {
  const ref = message?.process;
  if (!ref || typeof ref.once !== 'function') {
    invalid = true;
    return;
  }
  if (children.size === 64) {
    invalid = true;
    return;
  }
  const record = { pid: null, exitCode: null, signalCode: null, closed: false };
  children.set(ref, record);
  ref.once('spawn', () => {
    record.pid = ref.pid;
    if (!Number.isSafeInteger(ref.pid) || ref.pid < 1) invalid = true;
    else emit('CHILD', { pid: ref.pid });
  });
  ref.once('exit', (code, signal) => {
    record.exitCode = code;
    record.signalCode = signal;
  });
  ref.once('close', () => {
    record.closed = true;
  });
});
process.on('beforeExit', () => {
  beforeExit = true;
});
process.on('uncaughtExceptionMonitor', () => {
  uncaught = true;
});
process.on('exit', (code) => {
  try {
    const resources = process.getActiveResourcesInfo();
    if (resources.length > 512) invalid = true;
    const types = {};
    for (const type of resources.slice(0, 512)) types[type] = (types[type] ?? 0) + 1;
    emit('EXIT', {
      node: process.versions.node,
      pid: process.pid,
      code,
      beforeExit,
      uncaught,
      invalid,
      resources: types,
      servers: [...servers].map(([ref, record]) => ({ ...record, listening: ref.listening })),
      children: [...children.values()],
    });
  } catch {
    emit('EXIT', { pid: process.pid, code, invalid: true });
  }
});
