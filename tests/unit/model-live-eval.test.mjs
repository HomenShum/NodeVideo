// Opt-in LIVE receipt run for the Opus 5.5 default (model-defaults SPEC-v3 A.0.3). Makes PAID calls,
// so it is skipped unless NODEVIDEO_LIVE_EVAL=1 and is never part of `npm run check`. It exists to
// produce the missing evidence: the provider-echoed model, usage and cost for BOTH edit-agent paths,
// and an observed OpenRouter tool loop (does Opus 5.5 accept `reasoning.effort` + replayed reasoning).
//
//   NODEVIDEO_LIVE_EVAL=1 ANTHROPIC_API_KEY=... OPENROUTER_API_KEY=... \
//     npx vitest run tests/unit/model-live-eval.test.mjs
//
// Run it on a clean checkout of the PR head. Receipt: .qa/runs/model-refresh-receipt-<sha>.json
// (override with NODEVIDEO_LIVE_EVAL_OUT). Spend cap: NODEVIDEO_LIVE_EVAL_MAX_USD (default 1.00, must be
// a finite number > 0). Both paths share one budget that is checked before EVERY request, so the worst
// case is the cap plus the cost of the one request in flight when it is crossed (max_tokens 4096).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runBrowserAgent } from '../../apps/edit/src/browser-agent';
import { readByokModel } from '../../apps/edit/src/byok';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const live = process.env.NODEVIDEO_LIVE_EVAL === '1';

// The only pricing source in this repo (no other price/pricing/inPerM table exists). Opus 5.5 list price
// $4 / $20 per MTok: SPEC-v3 §A.2.2 (worker row) and the Claude migration guide's Opus 5.5 section
// (pricing as of 2026-10-10). Keyed by (id, transport); the agreement test below keeps the rows equal.
const PRICING = {
  'worker/anthropic': {
    id: 'claude-opus-5-5',
    inPerM: 4,
    outPerM: 20,
    pricingAsOf: '2026-10-10',
    echo: /^claude-opus-5-5/,
  },
  'browser/openrouter': {
    id: 'anthropic/claude-opus-5.5',
    inPerM: 4,
    outPerM: 20,
    pricingAsOf: '2026-10-10',
    echo: /claude-opus-5[.-]5/,
  },
};
const USAGE_KEYS = {
  'worker/anthropic': ['input_tokens', 'output_tokens'],
  'browser/openrouter': ['prompt_tokens', 'completion_tokens'],
};

const plan = JSON.parse(
  readFileSync(
    new URL('../../fixtures/media/integrated-source-only-v1/edit-plan.json', import.meta.url),
    'utf8',
  ),
);
// 0-based, as in the tool schema and the plan summary's `index`; the prompt says so, so the gate below
// asserts the one edit the prompt asked for rather than any edit.
const CLIP_INDEX = 1;
const MESSAGE = `Swap the source of the clip at index ${CLIP_INDEX} (0-based) to the other take.`;
const rows = [];
const transcripts = {};
const requests = {};
const completed = { 'worker/anthropic': false, 'browser/openrouter': false };
const budget = { maxUsd: null, estimateUsd: 0.7, spentUsd: 0, requests: 0, stoppedBy: null };
const startedAt = new Date().toISOString();

const finite = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

function parseCap(raw) {
  const cap = Number(raw ?? 1);
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error(`NODEVIDEO_LIVE_EVAL_MAX_USD must be a finite number > 0, got ${String(raw)}`);
  }
  return cap;
}

// `!(a < b)` is deliberate: a NaN cap or NaN spend fails closed instead of comparing false. Any earlier
// stop (maxUsd, or usageMissing: an unaccounted cost means the cap no longer bounds the run) blocks
// every later request, on either path.
function assertCanSpend(b) {
  if (b.stoppedBy)
    throw new Error(`live-eval stopped (${b.stoppedBy}): no further request is sent`);
  if (!(b.spentUsd < b.maxUsd)) {
    b.stoppedBy = 'maxUsd';
    throw new Error('live-eval budget exhausted: no further request is sent');
  }
}

// No usage, no receipt: a missing or non-numeric count throws, it never becomes a $0 row.
function costFromUsage(price, usage, inKey, outKey) {
  if (finite(usage?.cost) && usage.cost > 0) return usage.cost; // OpenRouter reports its own cost
  if (!finite(usage?.[inKey]) || !finite(usage?.[outKey])) {
    throw new Error(`response usage missing ${inKey}/${outKey} (and cost): cannot account spend`);
  }
  return (usage[inKey] * price.inPerM + usage[outKey] * price.outPerM) / 1e6;
}

// Wraps global fetch (the Anthropic SDK and runBrowserAgent both go through it): enforces the shared
// budget BEFORE dispatch and keeps the exact request bodies sent plus any JSON response bodies.
function guardedFetch(sent, received) {
  const realFetch = globalThis.fetch;
  return async (url, init) => {
    if (typeof init?.body !== 'string') throw new Error('cannot read the outgoing request body');
    assertCanSpend(budget);
    budget.requests += 1;
    const i = sent.push(JSON.parse(init.body)) - 1;
    const res = await realFetch(url, init);
    // received[i] answers sent[i]; null when the response is not JSON, so indexes never shift.
    received[i] = res.headers.get('content-type')?.includes('application/json')
      ? await res.clone().json()
      : null;
    return res;
  };
}

// resolvedModel is the `model` of the request body actually sent for this response (the latest
// dispatched request), never a literal; fallbackUsed is true when the provider echoed another model.
function record(path, sent) {
  const price = PRICING[path];
  const [inKey, outKey] = USAGE_KEYS[path];
  return ({ model, usage, id }) => {
    let costUsd;
    try {
      costUsd = costFromUsage(price, usage, inKey, outKey);
    } catch (error) {
      budget.stoppedBy = 'usageMissing';
      throw error;
    }
    budget.spentUsd += costUsd;
    rows.push({
      path,
      requestedModel: price.id,
      resolvedModel: sent.at(-1)?.model ?? null,
      echoedModel: model ?? null,
      responseId: id ?? null,
      usage,
      costUsd,
      fallbackUsed: !price.echo.test(model ?? ''),
    });
    if (!(budget.spentUsd <= budget.maxUsd)) {
      budget.stoppedBy = 'maxUsd';
      throw new Error('live-eval budget exceeded');
    }
  };
}

// Runs one edit-agent path through the guarded fetch, then asserts on EVERY row/request/event what
// A.0.3 and §A.2.2 require: model resolution, accounting, no tool errors, the one requested edit. `check`
// holds the path-specific assertions; `completed[path]` is set only after ALL of them pass.
async function observe(path, run, check) {
  const price = PRICING[path];
  const sent = [];
  const received = [];
  const events = [];
  vi.stubGlobal('fetch', guardedFetch(sent, received));
  try {
    await run({ events, onResponse: record(path, sent) });
  } finally {
    vi.unstubAllGlobals();
    transcripts[path] = { events, messages: sent.at(-1)?.messages ?? null };
    requests[path] = sent.map(({ messages, tools, ...params }) => params);
  }
  const pathRows = rows.filter((r) => r.path === path);
  expect(budget.stoppedBy, 'a budget or accounting stop is an incomplete run').toBeNull();
  expect(events.filter((e) => e.type === 'error')).toEqual([]);
  expect(pathRows.length, 'no response was recorded').toBeGreaterThan(0);
  for (const body of sent) expect(body.model).toBe(price.id);
  for (const row of pathRows) {
    expect(row.resolvedModel).toBe(row.requestedModel);
    expect(row.echoedModel).toMatch(price.echo);
    expect(row.fallbackUsed).toBe(false);
    expect(row.usage).toBeDefined();
  }
  expect(
    events.filter((e) => e.type === 'tool' && e.output?.error),
    'tool outputs must carry no errors',
  ).toEqual([]);
  expect(
    events.filter((e) => e.type === 'proposal').map((e) => e.proposal),
    'exactly one proposal, and it is the swap that was asked for',
  ).toEqual([{ kind: 'swap-source', clipIndex: CLIP_INDEX }]);
  await check?.({ sent, received, pathRows });
  completed[path] = true;
}

// Always runs (and is part of `npm run check`): the guards and the pricing table are testable offline.
describe('live-eval harness (offline)', () => {
  it('rejects a cap that is not a finite number > 0', () => {
    for (const bad of ['abc', '0', '-1', '', 'Infinity', 'NaN']) {
      expect(() => parseCap(bad), bad).toThrow(/finite number > 0/);
    }
    expect(parseCap(undefined)).toBe(1);
    expect(parseCap('2.5')).toBe(2.5);
  });

  it('blocks the next request once the cap is spent, or if the cap or spend is NaN', () => {
    expect(() => assertCanSpend({ maxUsd: 1, spentUsd: 0.99, stoppedBy: null })).not.toThrow();
    for (const spentUsd of [1, 1.2, Number.NaN]) {
      const b = { maxUsd: 1, spentUsd, stoppedBy: null };
      expect(() => assertCanSpend(b)).toThrow(/exhausted/);
      expect(b.stoppedBy).toBe('maxUsd');
    }
    expect(() => assertCanSpend({ maxUsd: Number.NaN, spentUsd: 0, stoppedBy: null })).toThrow(
      /exhausted/,
    );
  });

  it('blocks every later request once any stop is set, even with budget left', () => {
    for (const stoppedBy of ['usageMissing', 'maxUsd']) {
      const b = { maxUsd: 1, spentUsd: 0.1, stoppedBy };
      expect(() => assertCanSpend(b), stoppedBy).toThrow(/stopped/);
      expect(b.stoppedBy).toBe(stoppedBy);
    }
  });

  it('the asked-for edit is a real swap on the fixture plan', async () => {
    const { swapClipSource } = await import('../../scripts/workers/edit-agent.mjs');
    expect(swapClipSource(plan, CLIP_INDEX).patch).toEqual({
      kind: 'swap-source',
      clipIndex: CLIP_INDEX,
    });
  });

  it('fails closed when usage or cost is absent', () => {
    const p = PRICING['browser/openrouter'];
    const [i, o] = USAGE_KEYS['browser/openrouter'];
    expect(() => costFromUsage(p, undefined, i, o)).toThrow(/usage missing/);
    expect(() => costFromUsage(p, { prompt_tokens: 10 }, i, o)).toThrow(/usage missing/);
    expect(() => costFromUsage(p, { prompt_tokens: 'x', completion_tokens: 1 }, i, o)).toThrow(
      /usage missing/,
    );
    expect(costFromUsage(p, { cost: 0.03 }, i, o)).toBe(0.03);
    expect(costFromUsage(p, { prompt_tokens: 1e6, completion_tokens: 1e6 }, i, o)).toBe(24);
  });

  it('pricing sources agree per Opus 5.5 id and are dated', () => {
    const [first, ...rest] = Object.values(PRICING);
    for (const entry of rest) {
      expect({ inPerM: entry.inPerM, outPerM: entry.outPerM }).toEqual({
        inPerM: first.inPerM,
        outPerM: first.outPerM,
      });
    }
    for (const entry of Object.values(PRICING)) {
      expect(entry.pricingAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe.skipIf(!live)('live receipt: Opus 5.5 edit agents (PAID)', () => {
  const testedCommit = live ? git('rev-parse', 'HEAD') : '';
  const gitDirty = live ? git('status', '--porcelain').length > 0 : false;
  const constantSha256 = Object.fromEntries(
    live
      ? ['apps/edit/src/byok.ts', 'scripts/workers/edit-agent.mjs'].map((f) => [
          f,
          createHash('sha256')
            .update(execFileSync('git', ['show', `HEAD:${f}`]))
            .digest('hex'),
        ])
      : [],
  );

  // A failing beforeAll skips every test in this suite, so no paid request follows a failed precondition.
  beforeAll(() => {
    budget.maxUsd = parseCap(process.env.NODEVIDEO_LIVE_EVAL_MAX_USD);
    expect(gitDirty, 'receipt is rejected when the tree is dirty').toBe(false);
    expect(process.env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY').toBeTruthy();
    expect(process.env.OPENROUTER_API_KEY, 'OPENROUTER_API_KEY').toBeTruthy();
    expect(
      process.env.NODEVIDEO_EDIT_AGENT_MODEL,
      'override would change the tested model',
    ).toBeFalsy();
  });

  it('worker path (direct Anthropic) echoes claude-opus-5-5', async () => {
    const { runEditAgent } = await import('../../scripts/workers/edit-agent.mjs');
    await observe('worker/anthropic', ({ events, onResponse }) =>
      runEditAgent({
        plan,
        message: MESSAGE,
        history: [],
        send: (e) => events.push(e),
        onResponse,
      }),
    );
  }, 180_000);

  it('browser path (OpenRouter) completes a tool loop, replays reasoning, echoes opus 5.5', async () => {
    vi.stubGlobal('location', { origin: 'http://localhost' });
    try {
      await observe(
        'browser/openrouter',
        ({ events, onResponse }) =>
          runBrowserAgent({
            plan,
            message: MESSAGE,
            history: [],
            apiKey: process.env.OPENROUTER_API_KEY,
            model: readByokModel(),
            signal: AbortSignal.timeout(120_000),
            emit: (e) => events.push(e),
            onResponse,
          }),
        ({ sent, received, pathRows }) => {
          expect(received[0], 'first response must be a JSON body').toBeTruthy();
          const returned = received[0]?.choices?.[0]?.message?.reasoning_details;
          const replayed = sent[1]?.messages?.find(
            (m) => m.role === 'assistant',
          )?.reasoning_details;
          const row = pathRows.at(-1);
          row.reasoningDetailsReturned = returned !== undefined;
          row.reasoningDetailsReplayed = replayed !== undefined;
          row.reasoningDetailsEqual =
            returned !== undefined && isDeepStrictEqual(replayed, returned);
          expect(sent.length, 'a real tool continuation').toBeGreaterThanOrEqual(2);
          if (returned !== undefined) expect(replayed).toEqual(returned);
        },
      );
    } finally {
      vi.unstubAllGlobals();
    }
  }, 180_000);

  afterAll(() => {
    if (rows.length === 0) return; // a failed precondition sent nothing: no receipt
    const out =
      process.env.NODEVIDEO_LIVE_EVAL_OUT ??
      `.qa/runs/model-refresh-receipt-${testedCommit.slice(0, 12)}.json`;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(
      out,
      `${JSON.stringify(
        {
          command: 'NODEVIDEO_LIVE_EVAL=1 npx vitest run tests/unit/model-live-eval.test.mjs',
          candidateIds: Object.values(PRICING).map((p) => p.id),
          echoedModels: rows.map((r) => r.echoedModel),
          rows,
          testedCommit,
          gitDirty,
          constantSha256,
          budget,
          pricing: Object.fromEntries(
            Object.entries(PRICING).map(([key, { echo, ...price }]) => [key, price]),
          ),
          completed,
          requests,
          transcripts,
          startedAt,
          environment: 'local keyed machine',
        },
        null,
        2,
      )}\n`,
    );
  });
});
