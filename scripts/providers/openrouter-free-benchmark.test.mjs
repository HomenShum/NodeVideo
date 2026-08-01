import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_SCENARIOS,
  aggregateResults,
  buildManifest,
  discoverCandidates,
  main,
  parsePlan,
  scorePlan,
  stableDigest,
} from './openrouter-free-benchmark.mjs';

const model = (id, created = 1) => ({
  id,
  name: id,
  created,
  context_length: 32_000,
  pricing: { prompt: '0', completion: '0' },
  architecture: { output_modalities: ['text'] },
  supported_parameters: ['structured_outputs', 'max_tokens'],
});

describe('OpenRouter free-model benchmark scenarios', () => {
  it('a scheduled discovery admits only zero-cost structured text models and hashes deterministically', () => {
    const payload = {
      data: [
        model('new/free:free', 3),
        { ...model('paid/model', 2), pricing: { prompt: '0.1', completion: '0' } },
        { ...model('image/free:free', 1), architecture: { output_modalities: ['image'] } },
      ],
    };
    const candidates = discoverCandidates(payload);
    expect(candidates.map((candidate) => candidate.id)).toEqual(['new/free:free']);
    expect(stableDigest({ b: 2, a: 1 })).toBe(stableDigest({ a: 1, b: 2 }));
    expect(
      discoverCandidates({
        data: Array.from({ length: 12 }, (_, index) => model(`m${index}:free`)),
      }),
    ).toHaveLength(8);
  });

  it('a creator-facing evaluator rejects invented quotes and missing required operations', () => {
    const scenario = BENCHMARK_SCENARIOS[0];
    const invented = parsePlan(
      JSON.stringify({
        summary: 'Use "This quote was never spoken" as the hook.',
        operations: [{ kind: 'compose_variants', reason: 'Prepare several social versions.' }],
      }),
    );
    expect(scorePlan(invented, scenario)).toMatchObject({
      score: 50,
      schemaPass: true,
      requiredPass: false,
      groundingPass: false,
    });
  });

  it('a creator-facing evaluator does not mistake a possessive apostrophe for a quote', () => {
    const scenario = BENCHMARK_SCENARIOS[2];
    const safe = parsePlan(
      JSON.stringify({
        summary: "Protect the speaker's intent while reviewing fillers.",
        operations: [
          { kind: 'review_fillers', reason: "Review 'honestly' before removing it." },
          { kind: 'preserve_meaning', reason: "Keep the speaker's certainty intact." },
        ],
      }),
    );
    expect(scorePlan(safe, scenario)).toMatchObject({ score: 100, groundingPass: true });
  });

  it('a degraded model cannot outrank a slower model that completes every real scenario', () => {
    const candidates = [
      { id: 'fast-but-flaky:free', name: 'flaky', created: 2, contextLength: 32_000 },
      { id: 'slower-reliable:free', name: 'reliable', created: 1, contextLength: 32_000 },
    ];
    const attempts = candidates.flatMap((candidate) =>
      BENCHMARK_SCENARIOS.map((scenario, index) => ({
        model: candidate.id,
        scenarioId: scenario.id,
        success: candidate.id.startsWith('slower') || index < 2,
        score: candidate.id.startsWith('slower') || index < 2 ? 100 : 0,
        latencyMs: candidate.id.startsWith('slower') ? 900 : 100,
      })),
    );
    const rankings = aggregateResults(candidates, attempts, 1);
    expect(rankings[0]).toMatchObject({ id: 'slower-reliable:free', eligible: true });
    expect(rankings[1]).toMatchObject({ id: 'fast-but-flaky:free', eligible: false });
  });

  it('a production manifest keeps only two proven models before the random free-router escape hatch', () => {
    const rankings = ['first:free', 'second:free', 'third:free'].map((id, index) => ({
      id,
      eligible: true,
      successRate: 1,
      meanScore: 100 - index,
      p95LatencyMs: 100 + index,
    }));
    const manifest = buildManifest({
      candidates: rankings,
      rankings,
      catalogDigest: 'abc',
      generatedAt: '2026-08-01T00:00:00.000Z',
      repetitions: 2,
    });
    expect(manifest.selectedModels).toEqual(['first:free', 'second:free']);
    expect(manifest.fallbackRouter).toBe('openrouter/free');
  });

  it('an operator gets a full refresh when a scheduled canary detects a selected-model failure', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'nodevideo-openrouter-benchmark-'));
    const manifestPath = join(scratch, 'routing.json');
    const reportPath = join(scratch, 'report.json');
    const candidates = discoverCandidates({ data: [model('candidate/free:free')] });
    const catalogDigest = stableDigest(candidates);
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 'nodevideo.openrouter-free-routing.v1',
        catalogDigest,
        selectedModels: ['candidate/free:free'],
      }),
    );
    let chatCalls = 0;
    const fetchImpl = async (url, init) => {
      if (String(url).includes('/models?')) {
        return Response.json({ data: [model('candidate/free:free')] });
      }
      chatCalls += 1;
      if (chatCalls === 1) {
        return Response.json({ error: { message: 'canary unavailable' } }, { status: 503 });
      }
      const request = JSON.parse(String(init?.body));
      const user = request.messages[1].content;
      const scenario = BENCHMARK_SCENARIOS.find((item) => user.includes(item.transcript));
      const plan = {
        summary: 'Prepare a source-grounded and reviewable creator edit plan.',
        operations: scenario.requiredOperations.map((kind) => ({
          kind,
          reason: 'Apply only the requested source-grounded operation after creator review.',
        })),
      };
      return Response.json({
        model: 'candidate/free:free',
        choices: [{ message: { content: JSON.stringify(plan) } }],
      });
    };
    try {
      const result = await main(
        [
          '--mode',
          'auto',
          '--repetitions',
          '1',
          '--manifest',
          manifestPath,
          '--report',
          reportPath,
        ],
        { apiKey: 'test', fetchImpl, now: () => '2026-08-01T00:00:00.000Z' },
      );
      expect(result.report).toMatchObject({ mode: 'full', reason: 'selected_model_failed' });
      expect(result.manifest.selectedModels).toEqual(['candidate/free:free']);
      expect(JSON.parse(await readFile(reportPath, 'utf8')).attempts).toHaveLength(4);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('a sustained catalog refresh bounds 96 live-style samples to two concurrent requests', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'nodevideo-openrouter-load-'));
    const manifestPath = join(scratch, 'routing.json');
    const reportPath = join(scratch, 'report.json');
    const catalog = Array.from({ length: 8 }, (_, index) => model(`candidate-${index}:free`));
    let active = 0;
    let maximumActive = 0;
    let chatCalls = 0;
    const fetchImpl = async (url, init) => {
      if (String(url).includes('/models?')) return Response.json({ data: catalog });
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      chatCalls += 1;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1));
      const request = JSON.parse(String(init?.body));
      const user = request.messages[1].content;
      const scenario = BENCHMARK_SCENARIOS.find((item) => user.includes(item.transcript));
      active -= 1;
      return Response.json({
        model: request.model,
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: 'Prepare a safe, reviewable, source-grounded edit plan.',
                operations: scenario.requiredOperations.map((kind) => ({
                  kind,
                  reason:
                    'Apply the requested operation without changing the creator source meaning.',
                })),
              }),
            },
          },
        ],
      });
    };
    try {
      const result = await main(
        [
          '--mode',
          'full',
          '--repetitions',
          '3',
          '--manifest',
          manifestPath,
          '--report',
          reportPath,
        ],
        { apiKey: 'test', fetchImpl, now: () => '2026-08-01T00:00:00.000Z' },
      );
      expect(chatCalls).toBe(96);
      expect(maximumActive).toBe(2);
      expect(result.manifest.selectedModels).toHaveLength(2);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
