// In-browser edit agent: an OpenAI-compatible tool-calling loop that runs
// entirely in the tab, calling OpenRouter directly with the user's session
// key. Tool calls execute against a working copy of the plan (so the model
// sees its own edits); each mutating call is surfaced as a proposal the
// studio renders as a patch card and applies only on accept. No server, no
// SSE bridge — this is the "in-browser from the start" path.

import {
  type Plan,
  type PlanPatch,
  nudgeBoundary,
  planSummary,
  reorderClips,
  setOverlayText,
  swapClipSource,
} from './plan-tools';

export type AgentEvent =
  | { type: 'reasoning'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; input: unknown; output: unknown }
  | { type: 'proposal'; proposal: PlanPatch }
  | { type: 'error'; error: string };

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

const SYSTEM = `You are the NodeVideo edit agent for a beat-aligned dance edit (the "Sign" case: two takes A/B cut on a beat grid with lyric overlays).
Call get_plan_summary before proposing anything — ground every claim in tool results.
Each mutating tool call becomes a patch card the user must accept; the plan you see updates as if accepted, but nothing is final until the user applies it — say so.
Make the smallest edit that satisfies the request. Never invent clips, overlays, or timings not present in the plan. These are relative, uncalibrated edits to a creative work — no quality guarantees.
Keep replies to a few sentences; the tool cards carry the detail.`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_plan_summary',
      description:
        'Read the plan: bpm, duration, ordered clips with lanes and times, and overlays.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'swap_clip_source',
      description: 'Swap one clip to the other take (A<->B), keeping the same song beats.',
      parameters: {
        type: 'object',
        properties: { clipIndex: { type: 'integer' } },
        required: ['clipIndex'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'nudge_boundary',
      description:
        'Move the cut after a clip by whole beats (negative = earlier); neighbor absorbs it.',
      parameters: {
        type: 'object',
        properties: { clipIndex: { type: 'integer' }, beats: { type: 'integer' } },
        required: ['clipIndex', 'beats'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reorder_clips',
      description: 'Move a clip to a new position; the timeline re-lays contiguously.',
      parameters: {
        type: 'object',
        properties: { fromIndex: { type: 'integer' }, toIndex: { type: 'integer' } },
        required: ['fromIndex', 'toIndex'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_overlay_text',
      description: 'Rewrite a lyric overlay (id from get_plan_summary), max 80 chars.',
      parameters: {
        type: 'object',
        properties: { overlayId: { type: 'string' }, text: { type: 'string' } },
        required: ['overlayId', 'text'],
        additionalProperties: false,
      },
    },
  },
];

export async function runBrowserAgent(options: {
  plan: Plan;
  message: string;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  apiKey: string;
  model: string;
  signal: AbortSignal;
  emit: (event: AgentEvent) => void;
}): Promise<void> {
  let workingPlan = options.plan;
  const runTool = (name: string, args: Record<string, unknown>) => {
    if (name === 'get_plan_summary') return { summary: planSummary(workingPlan) };
    const result =
      name === 'swap_clip_source'
        ? swapClipSource(workingPlan, Number(args.clipIndex))
        : name === 'nudge_boundary'
          ? nudgeBoundary(workingPlan, Number(args.clipIndex), Number(args.beats))
          : name === 'reorder_clips'
            ? reorderClips(workingPlan, Number(args.fromIndex), Number(args.toIndex))
            : name === 'set_overlay_text'
              ? setOverlayText(workingPlan, String(args.overlayId), String(args.text))
              : { error: `unknown tool ${name}` };
    if (result.error) return { error: result.error };
    if (result.plan) workingPlan = result.plan;
    if (result.patch) options.emit({ type: 'proposal', proposal: result.patch });
    return { applied: 'pending user acceptance', clips: planSummary(workingPlan).clips };
  };

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM },
    ...options.history.map((turn) => ({ role: turn.role, content: turn.text }) as ChatMessage),
    { role: 'user', content: options.message.slice(0, 2000) },
  ];

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: options.signal,
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
        'http-referer': location.origin,
        'x-title': 'NodeVideo stitch studio',
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        max_tokens: 1024,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      options.emit({
        type: 'error',
        error:
          response.status === 401
            ? 'model_auth_failed'
            : `openrouter_${response.status}${detail ? `: ${detail.slice(0, 120)}` : ''}`,
      });
      return;
    }
    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          reasoning?: string | null;
          tool_calls?: ChatMessage['tool_calls'];
        };
        finish_reason?: string;
      }>;
    };
    const choice = data.choices?.[0]?.message;
    if (!choice) {
      options.emit({ type: 'error', error: 'empty_model_response' });
      return;
    }
    if (choice.reasoning) options.emit({ type: 'reasoning', delta: choice.reasoning });
    if (choice.content) options.emit({ type: 'text', delta: choice.content });

    const toolCalls = choice.tool_calls ?? [];
    if (toolCalls.length === 0) return;

    messages.push({
      role: 'assistant',
      content: choice.content ?? null,
      tool_calls: toolCalls,
    });
    for (const call of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        args = {};
      }
      const output = runTool(call.function.name, args);
      options.emit({ type: 'tool', name: call.function.name, input: args, output });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
    }
  }
  options.emit({ type: 'error', error: 'edit_agent_iteration_limit' });
}
