import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './verify-production-deploy.mjs';

const URL = 'https://nodevideo.example/';
const TITLE = 'NodeVideo — learn the dance you admire';
const COMMIT = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const BUILD = '/.well-known/agent-ui.build.json';
const CONTRACT = '/.well-known/agent-ui.json';
const CAP = 1_048_576;
const hash = (body) => createHash('sha256').update(body).digest('hex');
const contract = '{ "schemaVersion": "nodevideo.agent-ui.v1", "surfaces": [] }\n';
const receipt = (overrides = {}, bytes = contract) =>
  JSON.stringify({
    schemaVersion: 'nodevideo.agent-ui-build.v1',
    sourceCommit: COMMIT,
    contractSha256: hash(bytes),
    ...overrides,
  });
const env = (overrides = {}) => ({
  GITHUB_SHA: COMMIT,
  DEPLOY_VERIFY_TIMEOUT_MS: '30',
  DEPLOY_VERIFY_INTERVAL_MS: '10',
  ...overrides,
});

describe.skipIf(process.platform !== 'linux')(
  'the native Linux rollback guard owns the current release',
  () => {
    const shellEnv = { PATH: '/usr/bin:/bin', BASH_ENV: '/dev/null', ENV: '/dev/null' };
    let ownershipBlock;

    beforeAll(() => {
      for (const executable of ['/bin/bash', 'jq']) {
        const check = spawnSync(executable, ['--version'], {
          env: shellEnv,
          encoding: 'utf8',
          timeout: 2000,
          maxBuffer: 16384,
        });
        expect(check.status, `${executable} is required on the hosted Linux runner`).toBe(0);
      }
      const workflow = readFileSync(
        new globalThis.URL('../../.github/workflows/deploy-verify.yml', import.meta.url),
        'utf8',
      );
      const start = workflow.indexOf('          if [[ ! "${GITHUB_SHA:-}"');
      const end = workflow.indexOf('          npx --yes vercel@latest rollback', start);
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      ownershipBlock = workflow
        .slice(start, end)
        .split('\n')
        .map((line) => line.slice(10))
        .join('\n');
      expect(ownershipBlock).toContain('curl --proto');
      expect(ownershipBlock).toContain('| jq -er');
      expect(ownershipBlock).not.toContain('npx');
      expect(workflow).toContain('cancel-in-progress: true');
      expect(workflow).toContain("if: failure() && steps.verify.outcome == 'failure'");
    });

    const ref = (sha) => JSON.stringify({ object: { sha } });
    it.each([
      ['same main', ref(COMMIT), 0, COMMIT, 0],
      ['superseded', ref(OLD), 0, COMMIT, 1],
      ['lookup failure', '', 7, COMMIT, 1],
      ['lookup timeout', '', 28, COMMIT, 1],
      ['malformed JSON', '{"object":', 0, COMMIT, 1],
      ['missing ref', '{}', 0, COMMIT, 1],
      ['nonstring SHA', ref(123), 0, COMMIT, 1],
      ['short SHA', ref('abcd'), 0, COMMIT, 1],
      ['invalid expected SHA', ref(COMMIT), 0, 'unknown', 1],
      ['missing expected SHA', ref(COMMIT), 0, '', 1],
      ['body cap failure', '', 63, COMMIT, 1],
      ['body cap after valid prefix', ref(COMMIT), 63, COMMIT, 1],
      ['two ref objects', `${ref(COMMIT)}\n${ref(COMMIT)}`, 0, COMMIT, 1],
      ['malformed JSON after valid prefix', `${ref(COMMIT)}\n{`, 0, COMMIT, 1],
    ])(
      '%s preserves the failure or reaches only the harmless ownership marker',
      (_name, body, curlExit, expected, exitCode) => {
        // Execute the exact workflow guard with real Bash+jq. Only HTTP is scripted;
        // the source slice ends before npx, and no provider credentials are inherited.
        const script = `set -euo pipefail
curl() { printf '%s' "$REF_RESPONSE"; return "$CURL_EXIT"; }
${ownershipBlock}
printf '%s\\n' 'OWNERSHIP_CONFIRMED'
`;
        const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', script], {
          env: {
            ...shellEnv,
            GITHUB_SHA: expected,
            GITHUB_REPOSITORY: 'HomenShum/NodeVideo',
            GITHUB_STEP_SUMMARY: '/dev/null',
            GH_TOKEN: 'offline-placeholder',
            REF_RESPONSE: body,
            CURL_EXIT: String(curlExit),
          },
          encoding: 'utf8',
          timeout: 2000,
          maxBuffer: 16384,
        });
        expect(result.status, result.stderr).toBe(exitCode);
        expect(result.stdout.includes('OWNERSHIP_CONFIRMED')).toBe(exitCode === 0);
        if (exitCode !== 0) expect(result.stdout).toContain('Rollback not attempted.');
      },
    );
  },
);

function serve(bodies = {}) {
  return (url) => {
    const paths = { '/': `<title>${TITLE}</title>`, [BUILD]: receipt(), [CONTRACT]: contract };
    const body = bodies[url.pathname] ?? paths[url.pathname];
    if (body === undefined) throw new Error('unexpected request');
    return Promise.resolve(new Response(body));
  };
}

async function verify(settings = env(), args = [URL]) {
  const result = main(args, settings);
  await vi.runAllTimersAsync();
  return result;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T00:00:00Z'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(serve()));
});

afterEach(() => {
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('a maintainer verifies the exact release before accepting production', () => {
  it('accepts the expected receipt, exact contract bytes and the homepage title in one attempt', async () => {
    expect(await verify()).toBe(0);
    expect(fetch.mock.calls.map(([url]) => url.href)).toEqual([
      URL,
      `${URL}.well-known/agent-ui.build.json`,
      `${URL}.well-known/agent-ui.json`,
    ]);
    expect(fetch.mock.calls.every(([, options]) => options.redirect === 'error')).toBe(true);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`source ${COMMIT}`));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(hash(contract)));
  });

  it('waits through an old healthy page until the new receipt and contract arrive', async () => {
    let attempt = 0;
    fetch.mockImplementation((url) => {
      if (url.pathname === '/') attempt += 1;
      return serve({ [BUILD]: receipt({ sourceCommit: attempt < 3 ? OLD : COMMIT }) })(url);
    });
    expect(await verify()).toBe(0);
    expect(attempt).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(7);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`source commit ${OLD}`));
  });

  it('preserves the optional content signal while resolving receipts from the production origin', async () => {
    fetch.mockImplementation(serve({ '/practice': '<title>Practice a routine</title>' }));
    expect(await verify(env(), [`${URL}practice`, 'Practice a routine'])).toBe(0);
    expect(fetch.mock.calls.map(([url]) => url.pathname)).toEqual(['/practice', BUILD, CONTRACT]);
  });

  it('fails a persistently stale deployment although every homepage has the right title', async () => {
    fetch.mockImplementation(serve({ [BUILD]: receipt({ sourceCommit: OLD }) }));
    expect(await verify()).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenLastCalledWith(expect.stringContaining('not verified live'));
  });

  it.each([
    ['missing title', { '/': '<title>Loading</title>' }, 'content signal absent'],
    ['malformed receipt', { [BUILD]: '{private fixture text' }, 'invalid JSON in build receipt'],
    ['null receipt', { [BUILD]: 'null' }, 'invalid build receipt schema'],
    [
      'wrong schema',
      { [BUILD]: receipt({ schemaVersion: 'other' }) },
      'invalid build receipt schema',
    ],
    ['missing source', { [BUILD]: receipt({ sourceCommit: undefined }) }, 'source commit invalid'],
    ['bad hash', { [BUILD]: receipt({ contractSha256: 'short' }) }, 'invalid contract hash'],
    [
      'changed bytes',
      { [CONTRACT]: JSON.stringify(JSON.parse(contract)) },
      'contract byte hash mismatch',
    ],
    ['malformed contract', { [CONTRACT]: '{incomplete' }, 'invalid JSON in UI contract'],
  ])('fails honestly when propagation yields %s', async (_name, bodies, reason) => {
    fetch.mockImplementation(serve(bodies));
    expect(await verify(env({ DEPLOY_VERIFY_TIMEOUT_MS: '10' }))).toBe(1);
    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(reason));
    expect(JSON.stringify(console.error.mock.calls)).not.toContain('private fixture text');
  });

  it.each(['/', BUILD, CONTRACT])(
    'rejects non-200 responses at %s even with plausible bodies',
    async (path) => {
      const good = serve();
      fetch.mockImplementation((url) =>
        url.pathname === path ? Promise.resolve(new Response(TITLE, { status: 503 })) : good(url),
      );
      expect(await verify(env({ DEPLOY_VERIFY_TIMEOUT_MS: '10' }))).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('HTTP 503'));
    },
  );

  it('accepts complete bodies exactly at the byte cap, including a whitespace-padded JSON contract', async () => {
    const fullContract = contract.padEnd(CAP, ' ');
    fetch.mockImplementation(
      serve({
        '/': TITLE.padEnd(CAP - Buffer.byteLength(TITLE) + TITLE.length, ' '),
        [BUILD]: receipt({}, fullContract).padEnd(CAP, ' '),
        [CONTRACT]: fullContract,
      }),
    );
    expect(await verify()).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each(['/', BUILD, CONTRACT])(
    'rejects and cancels an oversized body at %s instead of accepting its prefix',
    async (path) => {
      const cancel = vi.fn();
      const prefix = path === '/' ? TITLE : path === BUILD ? receipt() : contract;
      const good = serve();
      fetch.mockImplementation((url) => {
        if (url.pathname !== path) return good(url);
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(prefix));
                controller.enqueue(new Uint8Array(CAP));
              },
              cancel,
            }),
          ),
        );
      });
      expect(await verify(env({ DEPLOY_VERIFY_TIMEOUT_MS: '10' }))).toBe(1);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('response exceeds'));
    },
  );

  it('aborts a hung fetch at the remaining total deadline', async () => {
    const started = Date.now();
    fetch.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    expect(await verify()).toBe(1);
    expect(Date.now() - started).toBe(30);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('retains the ten-second request limit during a longer release wait and bounds the final request', async () => {
    const started = Date.now();
    const abortedAt = [];
    fetch.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              abortedAt.push(Date.now() - started);
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    );
    expect(
      await verify(env({ DEPLOY_VERIFY_TIMEOUT_MS: '25000', DEPLOY_VERIFY_INTERVAL_MS: '1000' })),
    ).toBe(1);
    expect(abortedAt).toEqual([10000, 21000, 25000]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('aborts a stalled response body rather than accepting its already-received title', async () => {
    fetch.mockImplementation((_url, { signal }) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(TITLE));
              signal.addEventListener('abort', () => controller.error(signal.reason), {
                once: true,
              });
            },
          }),
        ),
      ),
    );
    expect(await verify()).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalled();
  });

  it('uses the remaining budget across requests, not a fresh total timeout for each endpoint', async () => {
    const started = Date.now();
    const good = serve();
    fetch.mockImplementation(
      (url, { signal }) =>
        new Promise((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(signal.reason);
          };
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', abort);
            resolve(good(url));
          }, 8);
          signal.addEventListener('abort', abort, { once: true });
        }),
    );
    expect(await verify(env({ DEPLOY_VERIFY_TIMEOUT_MS: '10' }))).toBe(1);
    expect(Date.now() - started).toBe(10);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries a temporary body read error and verifies only the subsequent complete response', async () => {
    fetch.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(new ReadableStream({ start: (c) => c.error(new Error('disconnected')) })),
      ),
    );
    expect(await verify()).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('disconnected'));
  });

  it.each([
    [{ GITHUB_SHA: undefined }, [URL]],
    [{ GITHUB_SHA: 'unknown' }, [URL]],
    [{ GITHUB_SHA: 'a'.repeat(39) }, [URL]],
    [{ DEPLOY_VERIFY_TIMEOUT_MS: 'NaN' }, [URL]],
    [{ DEPLOY_VERIFY_TIMEOUT_MS: 'Infinity' }, [URL]],
    [{ DEPLOY_VERIFY_TIMEOUT_MS: '0' }, [URL]],
    [{ DEPLOY_VERIFY_INTERVAL_MS: '-1' }, [URL]],
    [{ DEPLOY_VERIFY_INTERVAL_MS: '2147483648' }, [URL]],
    [{}, ['not a URL']],
    [{}, ['file:///ordinary.json']],
    [{}, ['https://user:password@nodevideo.example/']],
    [{}, [URL, '']],
  ])('rejects invalid operator configuration before any request: %j', async (overrides, args) => {
    expect(await verify(env(overrides), args)).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it('keeps simultaneous release checks independent and clears every request timer', async () => {
    const checks = Array.from({ length: 24 }, (_, index) =>
      main([URL], env({ GITHUB_SHA: index % 2 === 0 ? COMMIT : OLD })),
    );
    await vi.runAllTimersAsync();
    expect(await Promise.all(checks)).toEqual(Array.from({ length: 24 }, (_, index) => index % 2));
    expect(fetch).toHaveBeenCalledTimes(108);
    expect(console.log).toHaveBeenCalledTimes(12);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds sustained stale-release polling without accumulating live timers or succeeding', async () => {
    fetch.mockImplementation(serve({ [BUILD]: receipt({ sourceCommit: OLD }) }));
    expect(
      await verify(env({ DEPLOY_VERIFY_TIMEOUT_MS: '240000', DEPLOY_VERIFY_INTERVAL_MS: '1000' })),
    ).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(480);
    expect(console.log).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the real CLI exits 2 with missing expected identity before contacting its URL', () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new globalThis.URL('./verify-production-deploy.mjs', import.meta.url)),
        'http://127.0.0.1:9',
      ],
      {
        env: { NODE_OPTIONS: process.env.NODE_OPTIONS ?? '' },
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 16384,
      },
    );
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('GITHUB_SHA must be the complete expected source commit');
  });
});
