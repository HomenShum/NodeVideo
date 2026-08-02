#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nodeAgentRuntime from '../../src/lib/nodeagent-runtime.json' with { type: 'json' };

export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const ROUTING_SCHEMA_VERSION = 'nodevideo.openrouter-free-routing.v1';
export const BENCHMARK_SCHEMA_VERSION = 'nodevideo.openrouter-free-benchmark.v1';
export const MAX_CANDIDATES = 8;
export const MAX_CONCURRENCY = 2;
export const MAX_RESPONSE_BYTES = 1_000_000;
export const REQUEST_TIMEOUT_MS = 25_000;
export const DEFAULT_REPETITIONS = 2;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_MANIFEST_PATH = resolve(ROOT, 'config', 'openrouter-free-routing.json');
export const DEFAULT_REPORT_PATH = resolve(
  ROOT,
  '.qa',
  'openrouter-free-models',
  'latest-report.json',
);
export const PLANNER_OPERATIONS = nodeAgentRuntime.creatorPlanningOperations;

export const BENCHMARK_SCENARIOS = [
  {
    id: 'grounded-founder-quote',
    request:
      'Build one concise launch cut around the strongest exact quote. Preserve meaning and keep it reviewable.',
    transcript:
      'We built NodeVideo so every edit stays reviewable before export. The strongest result is trust, not automation for its own sake.',
    requiredOperations: ['extract_quote', 'preserve_meaning'],
    forbiddenOperations: ['remove_silence'],
  },
  {
    id: 'vertical-campaign-variants',
    request:
      'Prepare three 9:16 campaign variants from this source. Do not invent claims and preserve the speaker meaning.',
    transcript:
      'Creators can inspect the proposed timeline, compare variants, and approve the exact delivery before export.',
    requiredOperations: ['compose_variants', 'preserve_meaning'],
    forbiddenOperations: [],
  },
  {
    id: 'filler-review-boundary',
    request:
      'Identify filler-word edits, but require human review anywhere removing words could change intent.',
    transcript:
      'I think, honestly, the review step is what lets us move faster without losing control of the message.',
    requiredOperations: ['review_fillers', 'preserve_meaning'],
    forbiddenOperations: [],
  },
  {
    id: 'transition-only-scope',
    request: 'Add simple transitions only. Do not rewrite, shorten, or create variants.',
    transcript: 'Every edit remains inspectable, reversible, and grounded in the creator source.',
    requiredOperations: ['add_transitions', 'preserve_meaning'],
    forbiddenOperations: ['compose_variants', 'remove_silence', 'review_fillers'],
  },
];

export function stableDigest(value) {
  return createHash('sha256')
    .update(JSON.stringify(sortKeys(value)))
    .digest('hex');
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}

export function discoverCandidates(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows
    .filter((model) => {
      const parameters = new Set(model.supported_parameters ?? []);
      return (
        typeof model.id === 'string' &&
        model.id.endsWith(':free') &&
        Number(model.pricing?.prompt) === 0 &&
        Number(model.pricing?.completion) === 0 &&
        model.architecture?.output_modalities?.includes('text') &&
        parameters.has('structured_outputs') &&
        parameters.has('max_tokens')
      );
    })
    .map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      created: Number(model.created ?? 0),
      contextLength: Number(model.context_length ?? 0),
    }))
    .sort((a, b) => b.created - a.created || a.id.localeCompare(b.id))
    .slice(0, MAX_CANDIDATES);
}

export function analyzeCatalog(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const zeroCostText = rows.filter(
    (model) =>
      Number(model.pricing?.prompt) === 0 &&
      Number(model.pricing?.completion) === 0 &&
      model.architecture?.output_modalities?.includes('text'),
  );
  const routes = zeroCostText.map((model) => {
    const parameters = new Set(model.supported_parameters ?? []);
    const reasons = [];
    if (model.id === 'openrouter/free') reasons.push('dynamic_router_not_stable_model');
    if (typeof model.id !== 'string' || !model.id.endsWith(':free'))
      reasons.push('not_explicit_free_model');
    if (!parameters.has('structured_outputs')) reasons.push('no_structured_outputs');
    if (!parameters.has('max_tokens')) reasons.push('no_max_tokens');
    return {
      id: model.id,
      eligibleForBenchmark: reasons.length === 0,
      exclusionReasons: reasons,
    };
  });
  return {
    totalCatalogModels: rows.length,
    zeroCostTextRoutes: zeroCostText.length,
    structuredTextRoutes: routes.filter(
      (route) => !route.exclusionReasons.includes('no_structured_outputs'),
    ).length,
    explicitBenchmarkCandidates: routes.filter((route) => route.eligibleForBenchmark).length,
    routes,
  };
}

export function buildPlannerRequest(model, scenario, options = {}) {
  const repair = options.repair === true;
  const responsePolicy = nodeAgentRuntime.plannerResponsePolicy;
  return {
    model,
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
              maxItems: nodeAgentRuntime.limits.maxPlannerOperations,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string', enum: PLANNER_OPERATIONS },
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
    max_tokens: repair ? responsePolicy.repairMaxTokens : responsePolicy.maxTokens,
    temperature: responsePolicy.temperature,
    reasoning: {
      effort: responsePolicy.reasoningEffort,
      exclude: responsePolicy.excludeReasoning,
    },
    ...(responsePolicy.responseHealing ? { plugins: [{ id: 'response-healing' }] } : {}),
    messages: [
      {
        role: 'system',
        content: nodeAgentRuntime.plannerSystemPrompt,
      },
      {
        role: 'user',
        content: `Creator request:\n${scenario.request}\n\nRequired operations derived from that request: ${scenario.requiredOperations.join(', ')}.\nForbidden operations: ${scenario.forbiddenOperations.join(', ') || 'none'}.\n\nSource transcript:\n${scenario.transcript}${
          repair
            ? `\n\nRepair instruction: the prior response failed validation. Return one complete JSON object only. It must include: ${scenario.requiredOperations.join(', ')}.`
            : ''
        }`,
      },
    ],
  };
}

export function parsePlan(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const unfenced = text.replace(/^```(?:json)?\s*|\s*```$/giu, '').trim();
  let value;
  try {
    value = JSON.parse(unfenced);
  } catch {
    return null;
  }
  if (!value || typeof value.summary !== 'string' || !Array.isArray(value.operations)) return null;
  if (
    value.summary.length < 8 ||
    value.summary.length > 800 ||
    value.operations.length < 1 ||
    value.operations.length > nodeAgentRuntime.limits.maxPlannerOperations
  )
    return null;
  const allowed = new Set(PLANNER_OPERATIONS);
  if (
    value.operations.some(
      (operation) =>
        !operation ||
        !allowed.has(operation.kind) ||
        typeof operation.reason !== 'string' ||
        operation.reason.length < 8 ||
        operation.reason.length > 300,
    )
  )
    return null;
  return value;
}

export function scorePlan(plan, scenario) {
  if (!plan) {
    return {
      score: 0,
      schemaPass: false,
      requiredPass: false,
      forbiddenPass: false,
      groundingPass: false,
    };
  }
  const kinds = new Set(plan.operations.map((operation) => operation.kind));
  const requiredHits = scenario.requiredOperations.filter((kind) => kinds.has(kind)).length;
  const requiredRatio = requiredHits / scenario.requiredOperations.length;
  const forbiddenPass = scenario.forbiddenOperations.every((kind) => !kinds.has(kind));
  const combined = `${plan.summary} ${plan.operations.map((operation) => operation.reason).join(' ')}`;
  const doubleQuoted = [...combined.matchAll(/"([^"\n]{8,160})"/gu)].map((match) =>
    match[1].trim(),
  );
  const singleQuoted = [
    ...combined.matchAll(/(?:^|[^\p{L}\p{N}])'([^'\n]{2,160})'(?![\p{L}\p{N}])/gu),
  ].map((match) => match[1].trim());
  const quotes = [...doubleQuoted, ...singleQuoted];
  const groundingPass = quotes.every((quote) =>
    scenario.transcript.toLowerCase().includes(quote.toLowerCase()),
  );
  const score = 20 + requiredRatio * 40 + (forbiddenPass ? 20 : 0) + (groundingPass ? 20 : 0);
  return {
    score,
    schemaPass: true,
    requiredPass: requiredRatio === 1,
    forbiddenPass,
    groundingPass,
  };
}

async function readBoundedJson(response) {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error('response_too_large');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('response_too_large');
  return JSON.parse(new TextDecoder().decode(bytes));
}

function responseEvidence(payload) {
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;
  const reasoning = choice?.message?.reasoning;
  return {
    finishReason: choice?.finish_reason ?? null,
    nativeFinishReason: choice?.native_finish_reason ?? null,
    contentLength: typeof content === 'string' ? content.length : 0,
    reasoningLength: typeof reasoning === 'string' ? reasoning.length : 0,
    contentPreview:
      typeof content === 'string' ? content.replace(/\s+/gu, ' ').trim().slice(0, 500) : '',
  };
}

function diagnoseFailure({ response, payload, plan, evaluation, evidence }) {
  if (!response.ok) {
    return {
      code: 'upstream_http_error',
      mechanism: `OpenRouter returned HTTP ${response.status}.`,
      likelyCause: payload.error?.message ?? 'The selected free provider rejected the request.',
      remediation:
        'Retry once within the request budget, then remove the route if failures persist.',
    };
  }
  if (!payload.model) {
    return {
      code: 'missing_resolved_model',
      mechanism: 'OpenRouter returned no resolved model identifier.',
      likelyCause: 'The router response was incomplete and cannot prove which model executed.',
      remediation: 'Retry once and reject any response whose executing model is not identified.',
    };
  }
  if (evidence.contentLength === 0) {
    return {
      code: 'missing_content',
      mechanism: 'The provider returned HTTP 200 but no assistant content.',
      likelyCause:
        evidence.reasoningLength > 0 || evidence.finishReason === 'length'
          ? 'Reasoning or truncation consumed the completion budget before the JSON answer.'
          : 'The provider emitted an empty structured-output message.',
      remediation:
        'Use low reasoning effort, exclude reasoning text, increase the bounded answer budget, and retry once.',
    };
  }
  if (!plan) {
    return {
      code: 'invalid_structured_output',
      mechanism: 'The provider returned HTTP 200 content that failed the NodeVideo plan schema.',
      likelyCause:
        evidence.finishReason === 'length'
          ? 'The JSON answer was truncated at the completion limit.'
          : 'The provider did not honor strict structured output exactly.',
      remediation:
        'Enable response healing and retry once with a JSON-only repair instruction and larger bounded output budget.',
    };
  }
  if (!evaluation.requiredPass) {
    return {
      code: 'required_operations_missing',
      mechanism: 'The plan was valid JSON but omitted at least one explicitly requested operation.',
      likelyCause:
        'The planner did not map every creator action to the corresponding operation enum.',
      remediation:
        'Use explicit action-to-operation mapping in the shared planner prompt and retry once.',
    };
  }
  if (!evaluation.forbiddenPass) {
    return {
      code: 'forbidden_operation_added',
      mechanism: 'The plan introduced an operation the creator explicitly prohibited.',
      likelyCause: 'The planner expanded scope beyond the creator request.',
      remediation:
        'Restate the prohibited operations in the repair prompt and reject unresolved output.',
    };
  }
  return {
    code: 'invented_or_unsupported_quote',
    mechanism: 'The plan quoted text that was not present in the supplied transcript.',
    likelyCause:
      'The planner generated unsupported wording instead of extracting source text exactly.',
    remediation: 'Restate the source-grounding constraint and reject unresolved output.',
  };
}

function retryStrategy(code) {
  return {
    upstream_http_error: 'bounded_provider_retry',
    missing_resolved_model: 'bounded_provider_retry',
    missing_content: 'low_reasoning_larger_budget_retry',
    invalid_structured_output: 'response_healing_json_only_retry',
    required_operations_missing: 'explicit_operation_mapping_retry',
    forbidden_operation_added: 'scope_constraint_retry',
    invented_or_unsupported_quote: 'source_grounding_retry',
    timeout: 'bounded_timeout_retry',
    transport_or_parse_error: 'bounded_transport_retry',
  }[code];
}

async function runSingleAttempt({ apiKey, model, scenario, fetchImpl, timeoutMs, repair }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetchImpl(OPENROUTER_CHAT_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://nodevideo-pi.vercel.app',
        'X-OpenRouter-Title': 'NodeVideo Free Model Benchmark',
      },
      body: JSON.stringify(buildPlannerRequest(model, scenario, { repair })),
    });
    const payload = await readBoundedJson(response);
    const evidence = responseEvidence(payload);
    const plan = parsePlan(payload.choices?.[0]?.message?.content);
    const evaluation = scorePlan(plan, scenario);
    const success =
      response.ok &&
      Boolean(payload.model) &&
      evaluation.schemaPass &&
      evaluation.requiredPass &&
      evaluation.forbiddenPass &&
      evaluation.groundingPass;
    const diagnosis = success
      ? null
      : diagnoseFailure({ response, payload, plan, evaluation, evidence });
    return {
      model,
      resolvedModel: payload.model ?? null,
      scenarioId: scenario.id,
      success,
      httpStatus: response.status,
      latencyMs: Math.round(performance.now() - started),
      ...evaluation,
      responseEvidence: evidence,
      diagnosis,
      error: success ? null : (payload.error?.message ?? diagnosis.code),
    };
  } catch (error) {
    const diagnosis = {
      code: controller.signal.aborted ? 'timeout' : 'transport_or_parse_error',
      mechanism: controller.signal.aborted
        ? `No bounded response completed within ${timeoutMs}ms.`
        : 'The benchmark could not read a valid bounded OpenRouter response.',
      likelyCause: controller.signal.aborted
        ? 'The free provider was overloaded or its generation exceeded the request budget.'
        : error instanceof Error
          ? error.message
          : 'Unknown transport failure.',
      remediation: controller.signal.aborted
        ? 'Retry once with low reasoning effort, then reject the route if it still exceeds the budget.'
        : 'Retry once; reject repeated malformed, oversized, or unreadable responses.',
    };
    return {
      model,
      resolvedModel: null,
      scenarioId: scenario.id,
      success: false,
      httpStatus: null,
      latencyMs: Math.round(performance.now() - started),
      score: 0,
      schemaPass: false,
      requiredPass: false,
      forbiddenPass: false,
      groundingPass: false,
      responseEvidence: null,
      diagnosis,
      error: diagnosis.code,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runAttempt({
  apiKey,
  model,
  scenario,
  fetchImpl = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  const first = await runSingleAttempt({
    apiKey,
    model,
    scenario,
    fetchImpl,
    timeoutMs,
    repair: false,
  });
  if (first.success) {
    return {
      ...first,
      resolution: { attempted: false, strategy: null, outcome: 'not_needed' },
    };
  }
  const repaired = await runSingleAttempt({
    apiKey,
    model,
    scenario,
    fetchImpl,
    timeoutMs,
    repair: true,
  });
  return {
    ...repaired,
    latencyMs: first.latencyMs + repaired.latencyMs,
    initialFailure: {
      error: first.error,
      httpStatus: first.httpStatus,
      latencyMs: first.latencyMs,
      diagnosis: first.diagnosis,
      responseEvidence: first.responseEvidence,
    },
    resolution: {
      attempted: true,
      strategy: retryStrategy(first.diagnosis.code),
      outcome: repaired.success ? 'resolved' : 'unresolved',
      finalFailure: repaired.success ? null : repaired.diagnosis,
    },
  };
}

export function aggregateResults(candidates, attempts, repetitions) {
  const expectedSamples = BENCHMARK_SCENARIOS.length * repetitions;
  return candidates
    .map((candidate) => {
      const samples = attempts.filter((attempt) => attempt.model === candidate.id);
      const successes = samples.filter((attempt) => attempt.success).length;
      const sortedLatencies = samples.map((attempt) => attempt.latencyMs).sort((a, b) => a - b);
      const scenarioCoverage = new Set(
        samples.filter((attempt) => attempt.success).map((attempt) => attempt.scenarioId),
      ).size;
      const successRate = samples.length === 0 ? 0 : successes / samples.length;
      const meanScore =
        samples.length === 0
          ? 0
          : samples.reduce((sum, attempt) => sum + attempt.score, 0) / samples.length;
      const p95LatencyMs =
        sortedLatencies[Math.max(0, Math.ceil(sortedLatencies.length * 0.95) - 1)] ?? null;
      return {
        ...candidate,
        samples: samples.length,
        successes,
        successRate,
        meanScore,
        p95LatencyMs,
        scenarioCoverage,
        eligible:
          samples.length === expectedSamples &&
          successRate >= 0.75 &&
          meanScore >= 80 &&
          scenarioCoverage === BENCHMARK_SCENARIOS.length,
      };
    })
    .sort(
      (a, b) =>
        Number(b.eligible) - Number(a.eligible) ||
        b.successRate - a.successRate ||
        b.meanScore - a.meanScore ||
        (a.p95LatencyMs ?? Number.MAX_SAFE_INTEGER) - (b.p95LatencyMs ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id),
    );
}

export function buildFailureDeepDives(candidates, attempts) {
  return candidates.map((candidate) => {
    const samples = attempts.filter((attempt) => attempt.model === candidate.id);
    const initialFailures = samples.filter((attempt) => attempt.initialFailure);
    const unresolvedFailures = samples.filter((attempt) => !attempt.success);
    const causeCodes = [
      ...new Set(
        samples
          .flatMap((attempt) => [attempt.initialFailure?.diagnosis, attempt.diagnosis])
          .filter(Boolean)
          .map((diagnosis) => diagnosis.code),
      ),
    ];
    const rootCauses = causeCodes.map((code) => {
      const matching = samples.flatMap((attempt) => {
        const observations = [];
        if (attempt.initialFailure?.diagnosis?.code === code) {
          observations.push({
            diagnosis: attempt.initialFailure.diagnosis,
            scenarioId: attempt.scenarioId,
            httpStatus: attempt.initialFailure.httpStatus,
            error: attempt.initialFailure.error,
            responseEvidence: attempt.initialFailure.responseEvidence,
          });
        }
        if (attempt.diagnosis?.code === code) {
          observations.push({
            diagnosis: attempt.diagnosis,
            scenarioId: attempt.scenarioId,
            httpStatus: attempt.httpStatus,
            error: attempt.error,
            responseEvidence: attempt.responseEvidence,
          });
        }
        return observations;
      });
      const exemplar = matching[0];
      return {
        code,
        observedCount: matching.length,
        mechanism: exemplar.diagnosis.mechanism,
        likelyCause: exemplar.diagnosis.likelyCause,
        confidence: code === 'timeout' || code === 'upstream_http_error' ? 'observed' : 'inferred',
        evidence: matching.slice(0, 3).map((observation) => ({
          scenarioId: observation.scenarioId,
          httpStatus: observation.httpStatus,
          error: observation.error,
          responseEvidence: observation.responseEvidence,
        })),
        remediation: exemplar.diagnosis.remediation,
      };
    });
    const resolutions = samples
      .filter((attempt) => attempt.resolution?.attempted)
      .map((attempt) => ({
        scenarioId: attempt.scenarioId,
        strategy: attempt.resolution.strategy,
        outcome: attempt.resolution.outcome,
      }));
    return {
      model: candidate.id,
      status:
        unresolvedFailures.length > 0
          ? 'unresolved_failures'
          : initialFailures.length > 0
            ? 'recovered_by_bounded_repair'
            : 'passed_without_repair',
      samples: samples.length,
      initialFailures: initialFailures.length,
      resolvedFailures: resolutions.filter((resolution) => resolution.outcome === 'resolved')
        .length,
      unresolvedFailures: unresolvedFailures.length,
      rootCauses,
      resolutions,
    };
  });
}

export function formatFailureDeepDiveMarkdown(report) {
  const coverage = report.catalogCoverage;
  const lines = [
    '# OpenRouter free-model failure deep dive',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Supply and eligibility',
    '',
    `OpenRouter exposed ${coverage.zeroCostTextRoutes} zero-cost text routes; ${coverage.structuredTextRoutes} advertised structured outputs, and ${coverage.explicitBenchmarkCandidates} were stable explicit-model candidates for this benchmark.`,
    '',
  ];
  for (const model of report.failureDeepDives) {
    lines.push(`## ${model.model}`, '');
    lines.push(
      `Status: **${model.status}**. Initial failures: ${model.initialFailures}; resolved by bounded repair: ${model.resolvedFailures}; unresolved: ${model.unresolvedFailures}.`,
      '',
    );
    if (model.rootCauses.length === 0) {
      lines.push('No failures were observed.', '');
      continue;
    }
    for (const cause of model.rootCauses) {
      const sample = cause.evidence[0];
      lines.push(
        `- **${cause.code}** (${cause.confidence}, ${cause.observedCount} observations)`,
        `  - Mechanism: ${cause.mechanism}`,
        `  - Why: ${cause.likelyCause}`,
        `  - Evidence: scenario \`${sample.scenarioId}\`, HTTP ${sample.httpStatus ?? 'none'}, error \`${sample.error}\`, finish \`${sample.responseEvidence?.finishReason ?? 'none'}\`, content ${sample.responseEvidence?.contentLength ?? 0} chars, reasoning ${sample.responseEvidence?.reasoningLength ?? 0} chars.`,
        `  - Resolution: ${cause.remediation}`,
      );
    }
    if (model.resolutions.length > 0) {
      lines.push('', 'Resolution attempts:');
      for (const resolution of model.resolutions) {
        lines.push(
          `- \`${resolution.scenarioId}\`: \`${resolution.strategy}\` → **${resolution.outcome}**`,
        );
      }
    }
    lines.push('');
  }
  lines.push(
    'A resolution is marked resolved only when the same scenario produced a schema-valid, complete, scope-safe, source-grounded plan on the bounded repair attempt.',
    '',
  );
  return lines.join('\n');
}

async function mapBounded(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  return results;
}

async function fetchCatalog(fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(OPENROUTER_MODELS_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`catalog_http_${response.status}`);
    return await readBoundedJson(response);
  } finally {
    clearTimeout(timeout);
  }
}

async function readManifest(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function buildManifest({ candidates, rankings, catalogDigest, generatedAt, repetitions }) {
  const eligible = rankings
    .filter((row) => row.eligible)
    .slice(0, 2)
    .map((row) => row.id);
  return {
    schemaVersion: ROUTING_SCHEMA_VERSION,
    generatedAt,
    catalogDigest,
    benchmark: {
      schemaVersion: BENCHMARK_SCHEMA_VERSION,
      scenarios: BENCHMARK_SCENARIOS.map((scenario) => scenario.id),
      repetitions,
      thresholds: { minimumSuccessRate: 0.75, minimumMeanScore: 80, requiredScenarioCoverage: 1 },
    },
    selectedModels: eligible,
    fallbackRouter: 'openrouter/free',
    candidates: rankings,
    discoveredModels: candidates.map((candidate) => candidate.id),
  };
}

export function formatManifestJson(manifest) {
  const serialized = JSON.stringify(manifest, null, 2);
  const repositoryFormatted =
    manifest.selectedModels.length === 1
      ? serialized.replace(
          / {2}"selectedModels": \[\n {4}("(?:[^"\\]|\\.)*")\n {2}\],/u,
          '  "selectedModels": [$1],',
        )
      : serialized;
  return `${repositoryFormatted}\n`;
}

function parseArgs(argv) {
  const value = (name, fallback) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : fallback;
  };
  const reportPath = resolve(value('--report', DEFAULT_REPORT_PATH));
  return {
    mode: value('--mode', 'auto'),
    repetitions: Number(value('--repetitions', String(DEFAULT_REPETITIONS))),
    manifestPath: resolve(value('--manifest', DEFAULT_MANIFEST_PATH)),
    reportPath,
    deepDivePath: resolve(value('--deep-dive', join(dirname(reportPath), 'latest-deep-dive.md'))),
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
  };
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  if (!['auto', 'full', 'canary'].includes(options.mode))
    throw new Error('mode must be auto, full, or canary');
  if (!Number.isInteger(options.repetitions) || options.repetitions < 1 || options.repetitions > 3)
    throw new Error('repetitions must be an integer from 1 to 3');
  const apiKey = dependencies.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const catalog = await fetchCatalog(fetchImpl);
  const candidates = discoverCandidates(catalog);
  const catalogCoverage = analyzeCatalog(catalog);
  if (candidates.length === 0)
    throw new Error('No free structured-output text models were discovered.');
  const catalogDigest = stableDigest(candidates);
  const previous = await readManifest(options.manifestPath);
  let reason = options.force || options.mode === 'full' ? 'forced' : null;
  let canaryAttempts = [];
  if (!reason && previous?.catalogDigest !== catalogDigest) reason = 'catalog_changed';
  if (!reason && (options.mode === 'auto' || options.mode === 'canary')) {
    const canaryModels = previous?.selectedModels?.slice(0, 2) ?? [];
    if (canaryModels.length === 0) reason = 'missing_selection';
    else {
      canaryAttempts = await mapBounded(canaryModels, MAX_CONCURRENCY, (model) =>
        runAttempt({ apiKey, model, scenario: BENCHMARK_SCENARIOS[0], fetchImpl }),
      );
      if (canaryAttempts.some((attempt) => !attempt.success)) reason = 'selected_model_failed';
      else if (canaryAttempts.some((attempt) => attempt.resolution?.attempted))
        reason = 'selected_model_degraded';
    }
  }
  if (options.mode === 'canary' || (!reason && options.mode === 'auto')) {
    const report = {
      schemaVersion: BENCHMARK_SCHEMA_VERSION,
      generatedAt: now(),
      mode: 'canary',
      action: reason ? 'full_benchmark_required' : 'no_change',
      reason,
      catalogDigest,
      catalogCoverage,
      attempts: canaryAttempts,
    };
    console.log(JSON.stringify(report, null, 2));
    return { report, manifest: previous };
  }
  const jobs = candidates.flatMap((candidate) =>
    BENCHMARK_SCENARIOS.flatMap((scenario) =>
      Array.from({ length: options.repetitions }, (_, repetition) => ({
        model: candidate.id,
        scenario,
        repetition: repetition + 1,
      })),
    ),
  );
  const attempts = await mapBounded(jobs, MAX_CONCURRENCY, async (job) => ({
    repetition: job.repetition,
    ...(await runAttempt({ apiKey, model: job.model, scenario: job.scenario, fetchImpl })),
  }));
  const rankings = aggregateResults(candidates, attempts, options.repetitions);
  const failureDeepDives = buildFailureDeepDives(candidates, attempts);
  const generatedAt = now();
  const manifest = buildManifest({
    candidates,
    rankings,
    catalogDigest,
    generatedAt,
    repetitions: options.repetitions,
  });
  const report = {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    generatedAt,
    mode: 'full',
    reason: reason ?? 'requested',
    catalogDigest,
    catalogCoverage,
    attempts,
    rankings,
    failureDeepDives,
    selectedModels: manifest.selectedModels,
    routingStatus:
      manifest.selectedModels.length > 0
        ? 'eligible_models_selected'
        : 'fallback_only_no_eligible_stable_model',
  };
  if (!options.dryRun) {
    await mkdir(dirname(options.manifestPath), { recursive: true });
    await mkdir(dirname(options.reportPath), { recursive: true });
    await writeFile(options.manifestPath, formatManifestJson(manifest));
    await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(options.deepDivePath, formatFailureDeepDiveMarkdown(report));
  }
  console.log(JSON.stringify({ ...report, attempts: undefined }, null, 2));
  return { report, manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
