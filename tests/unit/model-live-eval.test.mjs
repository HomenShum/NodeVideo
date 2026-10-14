// Opt-in LIVE receipt run for the Opus 5.5 default (model-defaults SPEC-v3 A.0.3). Makes PAID calls,
// so it is skipped unless NODEVIDEO_LIVE_EVAL=1 and is never part of `npm run check`. It exists to
// produce the missing evidence: the provider-echoed model, usage and cost for BOTH edit-agent paths,
// and an observed OpenRouter tool loop (does Opus 5.5 accept `reasoning.effort` + replayed reasoning).
//
//   NODEVIDEO_LIVE_EVAL=1 ANTHROPIC_API_KEY=... OPENROUTER_API_KEY=... \
//     npx vitest run tests/unit/model-live-eval.test.mjs
//
// Run it on a clean checkout of the PR head. Receipt: .qa/runs/model-refresh-receipt-<sha>.json
// (override with NODEVIDEO_LIVE_EVAL_OUT). Spend cap: NODEVIDEO_LIVE_EVAL_MAX_USD (default 1.00).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { runBrowserAgent } from '../../apps/edit/src/browser-agent';
import { readByokModel } from '../../apps/edit/src/byok';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const live = process.env.NODEVIDEO_LIVE_EVAL === '1';
const maxUsd = Number(process.env.NODEVIDEO_LIVE_EVAL_MAX_USD ?? 1);
const PRICE = { inPerM: 4, outPerM: 20 }; // Opus 5.5 list price, SPEC-v3 §1.3
const plan = JSON.parse(
  readFileSync(
    new URL('../../fixtures/media/integrated-source-only-v1/edit-plan.json', import.meta.url),
    'utf8',
  ),
);
const MESSAGE = 'Swap the source of clip 1 to the other take.';
const rows = [];
const budget = { maxUsd, estimateUsd: 0.7, spentUsd: 0, requests: 0, stoppedBy: null };
const startedAt = new Date().toISOString();

// Throwing from the hook ends the agent loop, so a budget stop is an incomplete (rejected) run.
function record(path, requestedModel, usageCost) {
  return ({ model, usage, id }) => {
    const costUsd = usageCost(usage);
    budget.requests += 1;
    budget.spentUsd += costUsd;
    rows.push({
      path,
      requestedModel,
      resolvedModel: requestedModel,
      echoedModel: model ?? null,
      responseId: id ?? null,
      usage,
      costUsd,
      fallbackUsed: false,
    });
    if (budget.spentUsd > maxUsd) {
      budget.stoppedBy = 'maxUsd';
      throw new Error('live-eval budget exceeded');
    }
  };
}

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

  it('starts from a clean tree with keys and no model override', () => {
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
    const events = [];
    await runEditAgent({
      plan,
      message: MESSAGE,
      history: [],
      send: (e) => events.push(e),
      onResponse: record(
        'worker/anthropic',
        'claude-opus-5-5',
        (u) => (u.input_tokens * PRICE.inPerM + u.output_tokens * PRICE.outPerM) / 1e6,
      ),
    });
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(events.some((e) => e.type === 'tool')).toBe(true);
    expect(rows.at(-1).echoedModel).toMatch(/^claude-opus-5-5/);
  }, 180_000);

  it('browser path (OpenRouter) completes a tool loop, replays reasoning, echoes opus 5.5', async () => {
    const requestBodies = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal('location', { origin: 'http://localhost' });
    vi.stubGlobal('fetch', (url, init) => {
      requestBodies.push(JSON.parse(init.body));
      return realFetch(url, init);
    });
    try {
      const events = [];
      await runBrowserAgent({
        plan,
        message: MESSAGE,
        history: [],
        apiKey: process.env.OPENROUTER_API_KEY,
        model: readByokModel(),
        signal: AbortSignal.timeout(120_000),
        emit: (e) => events.push(e),
        onResponse: record(
          'browser/openrouter',
          'anthropic/claude-opus-5.5',
          (u) =>
            u?.cost ??
            ((u?.prompt_tokens ?? 0) * PRICE.inPerM + (u?.completion_tokens ?? 0) * PRICE.outPerM) /
              1e6,
        ),
      });
      expect(events.filter((e) => e.type === 'error')).toEqual([]);
      expect(events.some((e) => e.type === 'tool')).toBe(true);
      expect(requestBodies.length).toBeGreaterThanOrEqual(2); // a real tool continuation
      const replayed = requestBodies[1].messages.find((m) => m.role === 'assistant');
      rows.at(-1).reasoningDetailsReplayed = replayed?.reasoning_details !== undefined;
      rows.at(-1).requestBodies = requestBodies.map(({ messages, tools, ...rest }) => rest);
      expect(rows.at(-1).echoedModel).toMatch(/claude-opus-5[.-]5/);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 180_000);

  afterAll(() => {
    const out =
      process.env.NODEVIDEO_LIVE_EVAL_OUT ??
      `.qa/runs/model-refresh-receipt-${testedCommit.slice(0, 12)}.json`;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(
      out,
      `${JSON.stringify(
        {
          command: 'NODEVIDEO_LIVE_EVAL=1 npx vitest run tests/unit/model-live-eval.test.mjs',
          candidateIds: ['claude-opus-5-5', 'anthropic/claude-opus-5.5'],
          echoedModels: rows.map((r) => r.echoedModel),
          rows,
          testedCommit,
          gitDirty,
          constantSha256,
          budget,
          startedAt,
          environment: 'local keyed machine',
        },
        null,
        2,
      )}\n`,
    );
  });
});
