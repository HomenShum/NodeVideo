#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nodeAgentRuntime from '../../src/lib/nodeagent-runtime.json' with { type: 'json' };

export const OPENROUTER_MODELS_URL =
  'https://openrouter.ai/api/v1/models?supported_parameters=structured_outputs&sort=newest';
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
    .slice(0, MAX_CANDIDATES)
    .map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      created: Number(model.created ?? 0),
      contextLength: Number(model.context_length ?? 0),
    }));
}

export function buildPlannerRequest(model, scenario) {
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
    max_tokens: 500,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: nodeAgentRuntime.plannerSystemPrompt,
      },
      {
        role: 'user',
        content: `Creator request:\n${scenario.request}\n\nSource transcript:\n${scenario.transcript}`,
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
  const score = 40 + requiredRatio * 30 + (forbiddenPass ? 10 : 0) + (groundingPass ? 20 : 0);
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

export async function runAttempt({
  apiKey,
  model,
  scenario,
  fetchImpl = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
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
      body: JSON.stringify(buildPlannerRequest(model, scenario)),
    });
    const payload = await readBoundedJson(response);
    const plan = parsePlan(payload.choices?.[0]?.message?.content);
    const evaluation = scorePlan(plan, scenario);
    const success =
      response.ok &&
      Boolean(payload.model) &&
      evaluation.schemaPass &&
      evaluation.forbiddenPass &&
      evaluation.groundingPass;
    return {
      model,
      resolvedModel: payload.model ?? null,
      scenarioId: scenario.id,
      success,
      httpStatus: response.status,
      latencyMs: Math.round(performance.now() - started),
      ...evaluation,
      error: success
        ? null
        : (payload.error?.message ??
          (plan ? 'scenario_requirements_failed' : 'invalid_structured_output')),
    };
  } catch (error) {
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
      error: controller.signal.aborted
        ? 'timeout'
        : error instanceof Error
          ? error.message
          : 'unknown_error',
    };
  } finally {
    clearTimeout(timeout);
  }
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
  return {
    mode: value('--mode', 'auto'),
    repetitions: Number(value('--repetitions', String(DEFAULT_REPETITIONS))),
    manifestPath: resolve(value('--manifest', DEFAULT_MANIFEST_PATH)),
    reportPath: resolve(value('--report', DEFAULT_REPORT_PATH)),
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
    attempts,
    rankings,
    selectedModels: manifest.selectedModels,
  };
  if (!options.dryRun) {
    await mkdir(dirname(options.manifestPath), { recursive: true });
    await mkdir(dirname(options.reportPath), { recursive: true });
    await writeFile(options.manifestPath, formatManifestJson(manifest));
    await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify({ ...report, attempts: undefined }, null, 2));
  if (manifest.selectedModels.length === 0) process.exitCode = 2;
  return { report, manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
