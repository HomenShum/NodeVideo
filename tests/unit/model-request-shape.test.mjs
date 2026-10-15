// Request-shape proof for the Opus 5.5 default (model-defaults SPEC-v3 §1.3 / A.0.6).
// Builds the real request through each agent's own builder and captures it at a fake
// fetch, so no provider is called and no key is needed. Wire ids come from SPEC-v3 §1.2:
// OpenRouter slug `anthropic/claude-opus-5.5`, direct Anthropic `claude-opus-5-5`.
// Opus 5.5 returns 400 for sampling params, `budget_tokens`, thinking disabled,
// assistant prefill and forced tool_choice.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runBrowserAgent } from '../../apps/edit/src/browser-agent';
import { DEFAULT_MODEL, readByokModel } from '../../apps/edit/src/byok';

const OPENROUTER_OPUS_55 = 'anthropic/claude-opus-5.5';
const ANTHROPIC_OPUS_55 = 'claude-opus-5-5';
const FORBIDDEN_TOP_LEVEL = ['temperature', 'top_p', 'top_k', 'prefill'];

const plan = JSON.parse(
  readFileSync(
    new URL('../../fixtures/media/integrated-source-only-v1/edit-plan.json', import.meta.url),
    'utf8',
  ),
);

function expectOpus55Safe(body) {
  for (const key of FORBIDDEN_TOP_LEVEL) expect(body, key).not.toHaveProperty(key);
  expect(JSON.stringify(body)).not.toContain('budget_tokens');
  // Thinking can't be turned off, and the OpenRouter budget form (`reasoning.max_tokens`) is the
  // same budget-token control under another name.
  expect(body.thinking?.type).not.toBe('disabled');
  expect(body.reasoning?.enabled).not.toBe(false);
  expect(body.reasoning?.max_tokens).toBeUndefined();
  // Forced tool use (`required` / `any` / a named tool) is a 400 on Opus 5.5; `auto` is fine.
  const toolChoice = body.tool_choice;
  if (toolChoice !== undefined) expect(toolChoice).toBe('auto');
  // Assistant prefill: the last message must be the user turn.
  const messages = body.messages;
  expect(messages.at(-1)?.role).toBe('user');
}

describe('browser edit agent request shape (OpenRouter)', () => {
  const bodies = [];
  beforeEach(() => {
    bodies.length = 0;
    vi.stubGlobal('location', { origin: 'http://localhost' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
          { status: 200 },
        );
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to the OpenRouter Opus 5.5 slug, explicit effort, 4096-token cap, no forbidden keys', async () => {
    expect(DEFAULT_MODEL).toBe(OPENROUTER_OPUS_55);
    await runBrowserAgent({
      plan,
      message: 'swap clip 1',
      history: [],
      apiKey: 'test-key-not-real',
      model: readByokModel(),
      signal: new AbortController().signal,
      emit: () => {},
    });
    expect(bodies).toHaveLength(1);
    const body = bodies[0];
    expect(body.model).toBe(OPENROUTER_OPUS_55);
    expect(body.max_tokens).toBe(4096);
    expect(body.reasoning).toEqual({ effort: 'low' });
    expectOpus55Safe(body);
  });
});

describe('browser edit agent tool continuation (OpenRouter)', () => {
  const bodies = [];
  const reasoning = 'checked the plan first';
  const reasoningDetails = [
    {
      type: 'reasoning.text',
      text: reasoning,
      signature: 'sig-opaque-1',
      format: 'anthropic-claude-v1',
      index: 0,
    },
  ];
  beforeEach(() => {
    bodies.length = 0;
    vi.stubGlobal('location', { origin: 'http://localhost' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        const message =
          bodies.length === 1
            ? {
                content: null,
                reasoning,
                reasoning_details: reasoningDetails,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'get_plan_summary', arguments: '{}' },
                  },
                ],
              }
            : { content: 'done' };
        return new Response(JSON.stringify({ choices: [{ message, finish_reason: 'stop' }] }), {
          status: 200,
        });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('replays the returned reasoning unchanged on the follow-up request and stays Opus 5.5 safe', async () => {
    await runBrowserAgent({
      plan,
      message: 'what is in the plan?',
      history: [],
      apiKey: 'test-key-not-real',
      model: readByokModel(),
      signal: new AbortController().signal,
      emit: () => {},
    });
    expect(bodies).toHaveLength(2);
    const assistant = bodies[1].messages.find((m) => m.role === 'assistant');
    expect(assistant.tool_calls[0].id).toBe('call_1');
    expect(assistant.reasoning).toBe(reasoning);
    expect(assistant.reasoning_details).toEqual(reasoningDetails);
    expect(bodies[1].messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
    // The follow-up ends on a tool result, not a user turn, so only the keys are checked here.
    for (const body of bodies) {
      expect(body.model).toBe(OPENROUTER_OPUS_55);
      expect(body.reasoning).toEqual({ effort: 'low' });
      expect(body.thinking?.type).not.toBe('disabled');
      expect(JSON.stringify(body)).not.toContain('budget_tokens');
      for (const key of FORBIDDEN_TOP_LEVEL) expect(body, key).not.toHaveProperty(key);
    }
  });
});

describe('browser edit agent refusal handling (OpenRouter)', () => {
  const refusal = {
    message: { content: null },
    finish_reason: 'content_filter',
    native_finish_reason: 'refusal',
  };
  const toolTurn = {
    message: {
      content: null,
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'get_plan_summary', arguments: '{}' } },
      ],
    },
    finish_reason: 'tool_calls',
  };
  afterEach(() => vi.unstubAllGlobals());

  async function run(choices) {
    let call = 0;
    vi.stubGlobal('location', { origin: 'http://localhost' });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ choices: [choices[call++]] }), { status: 200 }),
      ),
    );
    const events = [];
    await runBrowserAgent({
      plan,
      message: 'swap clip 1',
      history: [],
      apiKey: 'test-key-not-real',
      model: readByokModel(),
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
    });
    return { events, calls: call };
  }

  it('emits model_refused when the first response is a 200 refusal', async () => {
    const { events, calls } = await run([refusal]);
    expect(calls).toBe(1);
    expect(events).toEqual([{ type: 'error', error: 'model_refused' }]);
  });

  it('emits model_refused when the refusal arrives after a tool continuation', async () => {
    const { events, calls } = await run([toolTurn, refusal]);
    expect(calls).toBe(2);
    expect(events.at(-1)).toEqual({ type: 'error', error: 'model_refused' });
    expect(events.filter((e) => e.type === 'tool')).toHaveLength(1);
  });
});

describe('worker edit agent request shape (direct Anthropic)', () => {
  const bodies = [];
  const savedEnv = { ...process.env };
  beforeEach(() => {
    bodies.length = 0;
    // biome-ignore lint/performance/noDelete: env var must be truly unset, not "undefined"
    delete process.env.NODEVIDEO_EDIT_AGENT_MODEL;
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        return new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'invalid_request_error', message: 'fake transport' },
          }),
          {
            status: 400,
            headers: { 'content-type': 'application/json' },
          },
        );
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...savedEnv };
  });

  it('defaults to claude-opus-5-5 with adaptive thinking, explicit effort and no forbidden keys', async () => {
    const { runEditAgent } = await import('../../scripts/workers/edit-agent.mjs');
    await runEditAgent({ plan, message: 'swap clip 1', history: [], send: () => {} });
    expect(bodies).toHaveLength(1);
    const body = bodies[0];
    expect(body.model).toBe(ANTHROPIC_OPUS_55);
    expect(body.thinking?.type).toBe('adaptive');
    expect(body.output_config?.effort).toBe('low');
    expectOpus55Safe(body);
  });
});
