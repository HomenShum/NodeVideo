import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import openRouterRouting from '../config/openrouter-free-routing.json' with { type: 'json' };
import { backoffDelayMs, backoffSleep } from '../src/lib/backoff';
import type {
  CreatorPlanningOperation,
  CreatorPlanningOperationKind,
  NodeAgentTraceStep,
} from '../src/lib/nodeagent-contract';
import nodeAgentRuntime from '../src/lib/nodeagent-runtime.json' with { type: 'json' };

const NODE_AGENT_LIMITS = nodeAgentRuntime.limits;
const CREATOR_PLANNING_OPERATIONS = nodeAgentRuntime.creatorPlanningOperations;

type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (value: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

export type CreatorAgentBody = {
  request: string;
  transcript?: string;
  source?: {
    fileName?: string;
    durationMs?: number;
    width?: number;
    height?: number;
  };
  scope?: 'selected-variant' | 'campaign-variants';
  memory?: Array<{ role: 'user' | 'assistant'; text: string }>;
  durability?: {
    caseId: string;
    runId: string;
    ownerKey: string;
    executionKey: string;
    requestDigest: string;
  };
};

type PlannerPlan = {
  summary: string;
  operations: CreatorPlanningOperation[];
};

type OpenRouterPayload = {
  error?: { message?: string };
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

type PlannerPass = {
  plan: PlannerPlan;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  schemaRepaired: boolean;
};

type PlannerObservations = ReturnType<typeof inspectPlannerDraft>;

export type DurablePlannerCheckpoint = {
  schemaVersion: 'nodevideo.agent-checkpoint/v1';
  draft: PlannerPass;
  observations: PlannerObservations;
  trace: NodeAgentTraceStep[];
  modelCalls: number;
};

type CheckpointUpdate = {
  checkpoint: DurablePlannerCheckpoint;
  status: 'running' | 'awaiting_resume';
  error?: string;
};

type DurableClaim =
  | { state: 'busy'; executionId: string; phase: string; leaseUntil: number }
  | { state: 'completed'; executionId: string; result?: unknown }
  | {
      state: 'claimed';
      executionId: string;
      phase: string;
      checkpoint?: unknown;
      resumed: boolean;
    };

const claimAgentExecution = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  DurableClaim
>('caseflow:claimAgentExecution');
const checkpointAgentExecution = makeFunctionReference<'mutation'>(
  'caseflow:checkpointAgentExecution',
);
const completeAgentExecution = makeFunctionReference<'mutation'>('caseflow:completeAgentExecution');
const failAgentExecution = makeFunctionReference<'mutation'>('caseflow:failAgentExecution');

export const maxDuration = 90;

const PLANNER_OPERATIONS = new Set(CREATOR_PLANNING_OPERATIONS);

export function parsePlannerOutput(value: string): PlannerPlan | null {
  const unfenced = value.replace(/^```(?:json)?\s*|\s*```$/giu, '').trim();
  const fragments = [unfenced];
  for (let start = 0; start < unfenced.length; start += 1) {
    if (unfenced[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let cursor = start; cursor < unfenced.length; cursor += 1) {
      const character = unfenced[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}') depth -= 1;
      if (depth === 0) {
        fragments.push(unfenced.slice(start, cursor + 1));
        break;
      }
    }
  }

  for (const fragment of fragments.reverse()) {
    let candidate: unknown;
    try {
      candidate = JSON.parse(fragment);
    } catch {
      continue;
    }
    const parsed = validatePlannerCandidate(candidate);
    if (parsed) return parsed;
  }
  return null;
}

export function repairPlannerOutput(value: string, request: string): PlannerPlan | null {
  const summaryMatch = /"summary"\s*:\s*"((?:\\.|[^"\\])*)"/iu.exec(value);
  if (!summaryMatch) return null;
  let summary = '';
  try {
    summary = JSON.parse(`"${summaryMatch[1]}"`) as string;
  } catch {
    return null;
  }
  if (summary.trim().length < 8) return null;
  const intent = `${request} ${summary}`.toLowerCase();
  const operations: CreatorPlanningOperation[] = [];
  if (/silence|pause|dead air/u.test(intent)) {
    operations.push({
      kind: 'remove_silence',
      reason: 'Remove only timing gaps requested by the user and retain uncertain cuts for review.',
    });
  }
  if (/filler|\bum\b|\buh\b/u.test(intent)) {
    operations.push({
      kind: 'review_fillers',
      reason: 'Flag filler candidates for review before any meaning-sensitive removal.',
    });
  }
  if (/quote|hook|highlight/u.test(intent)) {
    operations.push({
      kind: 'extract_quote',
      reason: 'Locate the requested source-grounded quote without inventing transcript content.',
    });
  }
  if (/variant|version|format|aspect|short|long/u.test(intent)) {
    operations.push({
      kind: 'compose_variants',
      reason: 'Compile only the requested delivery variants from the shared source index.',
    });
  }
  if (/transition|fade|crossfade/u.test(intent)) {
    operations.push({
      kind: 'add_transitions',
      reason: 'Treat transitions as reviewable timeline operations rather than applied effects.',
    });
  }
  operations.push({
    kind: 'preserve_meaning',
    reason: 'Keep speaker meaning authoritative and escalate uncertain edits for human review.',
  });
  return {
    summary: summary.trim().slice(0, 800),
    operations: operations.slice(0, NODE_AGENT_LIMITS.maxPlannerOperations),
  };
}

export function inferRequestedOperations(request: string): CreatorPlanningOperationKind[] {
  const intent = request.toLowerCase();
  const operations: CreatorPlanningOperationKind[] = [];
  if (/silence|pause|dead air/u.test(intent)) operations.push('remove_silence');
  if (/filler|\bum\b|\buh\b/u.test(intent)) operations.push('review_fillers');
  if (/quote|hook|highlight/u.test(intent)) operations.push('extract_quote');
  if (/variant|version|format|aspect|\b9:16\b|\b1:1\b|\b16:9\b|short|long/u.test(intent))
    operations.push('compose_variants');
  if (/transition|fade|crossfade/u.test(intent)) operations.push('add_transitions');
  if (/preserve|meaning|intent|do not (?:rewrite|change)|without changing/u.test(intent))
    operations.push('preserve_meaning');
  return operations.slice(0, NODE_AGENT_LIMITS.maxPlannerOperations);
}

function validatePlannerCandidate(candidate: unknown): PlannerPlan | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const record = candidate as Record<string, unknown>;
  if (typeof record.summary !== 'string' || record.summary.trim().length < 8) return null;
  if (
    !Array.isArray(record.operations) ||
    record.operations.length < 1 ||
    record.operations.length > NODE_AGENT_LIMITS.maxPlannerOperations
  )
    return null;
  const operations = record.operations.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const operation = entry as Record<string, unknown>;
    if (
      typeof operation.kind !== 'string' ||
      !PLANNER_OPERATIONS.has(operation.kind) ||
      typeof operation.reason !== 'string' ||
      operation.reason.trim().length < 8
    )
      return [];
    return [
      {
        kind: operation.kind as CreatorPlanningOperationKind,
        reason: operation.reason.trim().slice(0, 300),
      },
    ];
  });
  if (operations.length !== record.operations.length) return null;
  return { summary: record.summary.trim().slice(0, 800), operations };
}

export function parseBody(value: unknown): CreatorAgentBody | null {
  let candidate = value;
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!candidate || typeof candidate !== 'object') return null;
  const body = candidate as Record<string, unknown>;
  if (
    typeof body.request !== 'string' ||
    !body.request.trim() ||
    body.request.length > NODE_AGENT_LIMITS.maxPromptCharacters
  ) {
    return null;
  }
  if (
    body.memory !== undefined &&
    (!Array.isArray(body.memory) ||
      body.memory.length > NODE_AGENT_LIMITS.maxHistoryTurns ||
      body.memory.some(
        (turn) =>
          !turn ||
          typeof turn !== 'object' ||
          !['user', 'assistant'].includes(String((turn as Record<string, unknown>).role)) ||
          typeof (turn as Record<string, unknown>).text !== 'string' ||
          String((turn as Record<string, unknown>).text).length >
            NODE_AGENT_LIMITS.maxModelMessageCharacters,
      ))
  ) {
    return null;
  }
  if (body.durability !== undefined) {
    if (!body.durability || typeof body.durability !== 'object') return null;
    const durability = body.durability as Record<string, unknown>;
    if (
      ['caseId', 'runId', 'ownerKey', 'executionKey', 'requestDigest'].some(
        (key) =>
          typeof durability[key] !== 'string' ||
          !String(durability[key]).trim() ||
          String(durability[key]).length > 256,
      )
    ) {
      return null;
    }
  }
  return candidate as CreatorAgentBody;
}

function plannerRequest(
  body: CreatorAgentBody,
  messages: Array<{ role: string; content: string }>,
  useBenchmarkedModels: boolean,
) {
  const selectedModels = openRouterRouting.selectedModels.slice(0, 2);
  return {
    ...(useBenchmarkedModels && selectedModels.length > 0
      ? { models: selectedModels }
      : { model: openRouterRouting.fallbackRouter }),
    provider: { require_parameters: true },
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'nodevideo_creator_plan',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: { type: 'string', minLength: 8, maxLength: 800 },
            operations: {
              type: 'array',
              minItems: 1,
              maxItems: NODE_AGENT_LIMITS.maxPlannerOperations,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string', enum: [...PLANNER_OPERATIONS] },
                  reason: { type: 'string', minLength: 8, maxLength: 300 },
                },
                required: ['kind', 'reason'],
              },
            },
          },
          required: ['summary', 'operations'],
        },
      },
    },
    max_tokens: nodeAgentRuntime.plannerResponsePolicy.maxTokens,
    temperature: nodeAgentRuntime.plannerResponsePolicy.temperature,
    reasoning: {
      effort: nodeAgentRuntime.plannerResponsePolicy.reasoningEffort,
      exclude: nodeAgentRuntime.plannerResponsePolicy.excludeReasoning,
    },
    ...(nodeAgentRuntime.plannerResponsePolicy.responseHealing
      ? { plugins: [{ id: 'response-healing' }] }
      : {}),
    messages,
    metadata: { scope: body.scope ?? 'selected-variant' },
  };
}

async function readBoundedPayload(response: Response): Promise<OpenRouterPayload> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > NODE_AGENT_LIMITS.maxUpstreamBytes)
    throw new Error('The free router response was too large.');
  if (!response.body) throw new Error('The free router returned an empty response body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > NODE_AGENT_LIMITS.maxUpstreamBytes) {
      await reader.cancel();
      throw new Error('The free router response exceeded the one-megabyte limit.');
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as OpenRouterPayload;
  } catch {
    throw new Error('The free router returned invalid JSON.');
  }
}

async function requestPlannerPass(options: {
  apiKey: string;
  body: CreatorAgentBody;
  messages: Array<{ role: string; content: string }>;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  now: () => number;
  useBenchmarkedModels: boolean;
}): Promise<PlannerPass> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs));
  const startedAt = options.now();
  try {
    const upstream = await options.fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://nodevideo-pi.vercel.app',
        'X-OpenRouter-Title': 'NodeVideo Creator Agent',
      },
      body: JSON.stringify(
        plannerRequest(options.body, options.messages, options.useBenchmarkedModels),
      ),
    });
    const payload = await readBoundedPayload(upstream);
    const text = payload.choices?.[0]?.message?.content?.trim();
    const parsedPlan = text ? parsePlannerOutput(text) : null;
    const plan = parsedPlan ?? (text ? repairPlannerOutput(text, options.body.request) : null);
    const requiredOperations = inferRequestedOperations(options.body.request);
    const returnedOperations = new Set(plan?.operations.map((operation) => operation.kind) ?? []);
    const missingOperations = requiredOperations.filter((kind) => !returnedOperations.has(kind));
    if (!upstream.ok || !text || !payload.model || !plan || missingOperations.length > 0) {
      throw new Error(
        payload.error?.message ??
          (missingOperations.length > 0
            ? `The free router omitted requested operations: ${missingOperations.join(', ')}.`
            : 'The free router returned a plan that failed NodeVideo schema validation.'),
      );
    }
    return {
      plan,
      model: payload.model,
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
      latencyMs: options.now() - startedAt,
      schemaRepaired: !parsedPlan,
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The free router timed out.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function inspectPlannerDraft(body: CreatorAgentBody, plan: PlannerPlan) {
  const transcript = (body.transcript ?? '').slice(0, NODE_AGENT_LIMITS.maxTranscriptCharacters);
  const quoteCandidates = [
    ...`${plan.summary} ${plan.operations.map((item) => item.reason).join(' ')}`.matchAll(
      /["']([^"']{8,160})["']/gu,
    ),
  ].map((match) => match[1].trim());
  const unsupportedQuotes = quoteCandidates.filter(
    (quote) => !transcript.toLowerCase().includes(quote.toLowerCase()),
  );
  const operationKinds = plan.operations.map((operation) => operation.kind);
  return {
    source: {
      fileName: body.source?.fileName ?? 'unknown',
      durationMs: body.source?.durationMs ?? 0,
      dimensions:
        body.source?.width && body.source?.height
          ? `${body.source.width}x${body.source.height}`
          : 'unknown',
    },
    scope: body.scope ?? 'selected-variant',
    transcriptCharacters: transcript.length,
    operationKinds,
    duplicateOperations: operationKinds.filter(
      (kind, index) => operationKinds.indexOf(kind) !== index,
    ),
    unsupportedQuotes,
    requiresHumanReview: unsupportedQuotes.length > 0 || operationKinds.includes('review_fillers'),
  };
}

export function parseDurableCheckpoint(value: unknown): DurablePlannerCheckpoint | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<DurablePlannerCheckpoint>;
  if (candidate.schemaVersion !== 'nodevideo.agent-checkpoint/v1') return undefined;
  if (!candidate.draft || !validatePlannerCandidate(candidate.draft.plan)) return undefined;
  if (
    typeof candidate.draft.model !== 'string' ||
    typeof candidate.draft.inputTokens !== 'number' ||
    typeof candidate.draft.outputTokens !== 'number' ||
    typeof candidate.draft.latencyMs !== 'number' ||
    typeof candidate.draft.schemaRepaired !== 'boolean' ||
    !candidate.observations ||
    !Array.isArray(candidate.trace) ||
    candidate.trace.length > NODE_AGENT_LIMITS.maxTraceSteps ||
    typeof candidate.modelCalls !== 'number'
  ) {
    return undefined;
  }
  return candidate as DurablePlannerCheckpoint;
}

export async function runDeepPlanner(
  body: CreatorAgentBody,
  options: {
    apiKey: string;
    fetchImpl?: typeof fetch;
    now?: () => number;
    runId?: string;
    checkpoint?: DurablePlannerCheckpoint;
    onCheckpoint?: (update: CheckpointUpdate) => Promise<void>;
  },
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const runId = options.runId ?? crypto.randomUUID();
  const startedAt = now();
  const trace: NodeAgentTraceStep[] = options.checkpoint?.trace.slice() ?? [];
  const system = nodeAgentRuntime.plannerSystemPrompt;
  const userContext = JSON.stringify({
    request: body.request,
    requiredOperations: inferRequestedOperations(body.request),
    scope: body.scope ?? 'selected-variant',
    source: body.source ?? {},
    transcript: (body.transcript ?? '').slice(0, NODE_AGENT_LIMITS.maxTranscriptCharacters),
    durableThreadMemory: (body.memory ?? []).slice(-NODE_AGENT_LIMITS.maxHistoryTurns),
  });
  let draft: PlannerPass | undefined = options.checkpoint?.draft;
  let observations: PlannerObservations | undefined = options.checkpoint?.observations;
  let lastError = 'The free router was unavailable.';
  let modelCalls = options.checkpoint?.modelCalls ?? 0;
  for (let attempt = 1; attempt <= 2 && !draft; attempt += 1) {
    if (attempt > 1) {
      // Bounded exponential backoff before retrying a transient router failure.
      const budgetLeft = NODE_AGENT_LIMITS.plannerTotalBudgetMs - (now() - startedAt);
      if (backoffDelayMs(attempt - 1) >= budgetLeft) break;
      await backoffSleep(attempt - 1);
    }
    const remaining = NODE_AGENT_LIMITS.plannerTotalBudgetMs - (now() - startedAt);
    if (remaining <= 0) break;
    modelCalls += 1;
    try {
      draft = await requestPlannerPass({
        apiKey: options.apiKey,
        body,
        fetchImpl,
        now,
        useBenchmarkedModels: attempt === 1,
        timeoutMs: Math.min(NODE_AGENT_LIMITS.plannerPassTimeoutMs, remaining),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContext },
          ...(attempt > 1
            ? [
                {
                  role: 'user',
                  content:
                    'The previous candidate failed. Return one valid JSON object only with allowlisted operations.',
                },
              ]
            : []),
        ],
      });
      trace.push({
        id: `draft-${attempt}`,
        kind: 'model',
        status: 'completed',
        detail: `Draft plan accepted on attempt ${attempt}.`,
        model: draft.model,
        latencyMs: draft.latencyMs,
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'The free router was unavailable.';
      trace.push({
        id: `draft-${attempt}`,
        kind: 'model',
        status: 'failed',
        detail: lastError,
      });
    }
  }
  if (!draft) throw new Error(lastError);

  if (!observations) {
    observations = inspectPlannerDraft(body, draft.plan);
    trace.push({
      id: 'grounding-tools',
      kind: 'tool',
      status: 'completed',
      detail: `${observations.operationKinds.length} operations checked; ${observations.unsupportedQuotes.length} unsupported quoted claims; review=${observations.requiresHumanReview}.`,
    });
    await options.onCheckpoint?.({
      status: 'running',
      checkpoint: {
        schemaVersion: 'nodevideo.agent-checkpoint/v1',
        draft,
        observations,
        trace: trace.slice(-NODE_AGENT_LIMITS.maxTraceSteps),
        modelCalls,
      },
    });
  }

  let finalPass = draft;
  let degradedReason = '';
  const runTokensUsed = draft.inputTokens + draft.outputTokens;
  const remaining = NODE_AGENT_LIMITS.plannerTotalBudgetMs - (now() - startedAt);
  if (runTokensUsed >= NODE_AGENT_LIMITS.maxRunTokens) {
    degradedReason =
      'The model review pass was skipped because the per-run token ceiling was reached.';
  } else if (remaining >= NODE_AGENT_LIMITS.plannerMinReviewBudgetMs) {
    modelCalls += 1;
    try {
      finalPass = await requestPlannerPass({
        apiKey: options.apiKey,
        body,
        fetchImpl,
        now,
        useBenchmarkedModels: true,
        timeoutMs: Math.min(NODE_AGENT_LIMITS.plannerPassTimeoutMs, remaining),
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: JSON.stringify({
              request: body.request,
              scope: body.scope ?? 'selected-variant',
              source: observations.source,
              durableThreadMemory: (body.memory ?? []).slice(-NODE_AGENT_LIMITS.maxHistoryTurns),
            }),
          },
          {
            role: 'assistant',
            content: JSON.stringify(draft.plan),
          },
          {
            role: 'user',
            content: `NodeVideo executed deterministic grounding tools. Review and repair the draft using these observations, then return the final JSON plan only: ${JSON.stringify(observations)}`,
          },
        ],
      });
      trace.push({
        id: 'model-review',
        kind: 'model',
        status: 'completed',
        detail: 'Final plan reviewed against deterministic tool observations.',
        model: finalPass.model,
        latencyMs: finalPass.latencyMs,
      });
    } catch (error) {
      degradedReason =
        error instanceof Error ? error.message : 'The model review pass was unavailable.';
    }
  } else {
    degradedReason =
      'The model review pass was skipped because the total time budget was exhausted.';
  }
  if (degradedReason) {
    await options.onCheckpoint?.({
      status: 'awaiting_resume',
      error: degradedReason,
      checkpoint: {
        schemaVersion: 'nodevideo.agent-checkpoint/v1',
        draft,
        observations,
        trace: trace.slice(-NODE_AGENT_LIMITS.maxTraceSteps),
        modelCalls,
      },
    });
    trace.push({
      id: 'model-review',
      kind: 'status',
      status: 'degraded',
      detail: degradedReason,
    });
  }

  return {
    ok: true,
    runId,
    text: finalPass.plan.summary,
    plan: finalPass.plan,
    provider: 'openrouter',
    model: finalPass.model,
    inputTokens: draft.inputTokens + (finalPass === draft ? 0 : finalPass.inputTokens),
    outputTokens: draft.outputTokens + (finalPass === draft ? 0 : finalPass.outputTokens),
    latencyMs: now() - startedAt,
    costUsd: 0,
    attempts: modelCalls,
    iterations: finalPass === draft ? 1 : 2,
    depthMode: finalPass === draft ? 'single_pass_degraded' : 'iterative',
    schemaRepaired: draft.schemaRepaired || finalPass.schemaRepaired,
    trace: trace.slice(-NODE_AGENT_LIMITS.maxTraceSteps),
    ...(degradedReason ? { degradedReason } : {}),
    resumed: Boolean(options.checkpoint),
    resumable: Boolean(degradedReason && options.onCheckpoint),
  };
}

export async function requestDigest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const hex = [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

function durableClient() {
  const convexUrl = process.env.VITE_CONVEX_URL;
  if (!convexUrl) throw new Error('Durable NodeAgent storage is not configured.');
  const parsed = new URL(convexUrl);
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.convex.cloud')) {
    throw new Error('Durable NodeAgent storage URL is invalid.');
  }
  return new ConvexHttpClient(parsed.origin);
}

function errorText(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return fallback;
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.status(405).json({ ok: false, error: 'POST required.' });
    return;
  }
  const body = parseBody(request.body);
  if (!body) {
    response.status(400).json({ ok: false, error: 'A bounded creator request is required.' });
    return;
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    response.status(503).json({ ok: false, error: 'The free planning route is not configured.' });
    return;
  }
  let execution:
    | {
        client: ConvexHttpClient;
        executionId: string;
        workerToken: string;
        checkpoint?: DurablePlannerCheckpoint;
      }
    | undefined;
  let failureStage = 'planning';
  try {
    if (body.durability) {
      failureStage = 'digest verification';
      const digest = await requestDigest(body.request);
      if (
        digest !== body.durability.requestDigest ||
        body.durability.executionKey !== body.durability.requestDigest
      ) {
        response.status(400).json({ ok: false, error: 'Durable execution digest mismatch.' });
        return;
      }
      failureStage = 'durable storage setup';
      const client = durableClient();
      const workerToken = crypto.randomUUID();
      failureStage = 'durable execution claim';
      const claim = await client.mutation(claimAgentExecution, {
        caseId: body.durability.caseId,
        ownerKey: body.durability.ownerKey,
        runId: body.durability.runId,
        executionKey: body.durability.executionKey,
        requestDigest: body.durability.requestDigest,
        requestText: body.request,
        workerToken,
      });
      if (claim.state === 'busy') {
        response.status(409).json({
          ok: false,
          error: 'This NodeAgent run is already active.',
          executionId: claim.executionId,
          phase: claim.phase,
          resumeAfterMs: Math.max(0, claim.leaseUntil - Date.now()),
        });
        return;
      }
      if (claim.state === 'completed') {
        response.status(200).json(claim.result);
        return;
      }
      const checkpoint = parseDurableCheckpoint(claim.checkpoint);
      if (claim.checkpoint && !checkpoint) {
        throw new Error('The durable NodeAgent checkpoint failed validation.');
      }
      execution = { client, executionId: claim.executionId, workerToken, checkpoint };
    }

    failureStage = 'agent planning';
    const result = await runDeepPlanner(body, {
      apiKey,
      runId: execution?.executionId,
      checkpoint: execution?.checkpoint,
      onCheckpoint: execution
        ? async (update) => {
            await execution?.client.mutation(checkpointAgentExecution, {
              caseId: body.durability?.caseId,
              ownerKey: body.durability?.ownerKey,
              executionId: execution.executionId,
              workerToken: execution.workerToken,
              phase: 'review',
              status: update.status,
              checkpoint: update.checkpoint,
              ...(update.error ? { error: update.error } : {}),
            });
          }
        : undefined,
    });
    if (execution && !result.resumable) {
      failureStage = 'durable execution completion';
      await execution.client.mutation(completeAgentExecution, {
        caseId: body.durability?.caseId,
        ownerKey: body.durability?.ownerKey,
        executionId: execution.executionId,
        workerToken: execution.workerToken,
        result,
      });
    }
    response.status(200).json(result);
  } catch (error) {
    const message = errorText(error, `NodeAgent failed during ${failureStage}.`);
    console.error('creator-agent request failed', {
      stage: failureStage,
      name: error instanceof Error ? error.name : typeof error,
      message,
    });
    if (execution) {
      try {
        await execution.client.mutation(failAgentExecution, {
          caseId: body.durability?.caseId,
          ownerKey: body.durability?.ownerKey,
          executionId: execution.executionId,
          workerToken: execution.workerToken,
          error: message,
        });
      } catch {
        // Preserve the original failure; a lost lease is already visible in durable state.
      }
    }
    response.status(502).json({
      ok: false,
      error: message,
      stage: failureStage,
    });
  }
}
