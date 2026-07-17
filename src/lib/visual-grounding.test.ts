import { describe, expect, it, vi } from 'vitest';
import {
  LOCATE_REQUEST_SCHEMA_VERSION,
  LOCATE_RESULT_SCHEMA_VERSION,
  type LocateRequest,
  type LocateResult,
  createDisabledLocateProvider,
  createLocateAnythingHttpProvider,
  createManualLocateProvider,
  createReplayLocateProvider,
  validateLocateHealth,
  validateLocateRequest,
  validateLocateResult,
} from './visual-grounding';

const request = (overrides: Partial<LocateRequest> = {}): LocateRequest => ({
  schemaVersion: LOCATE_REQUEST_SCHEMA_VERSION,
  requestId: 'locate.1',
  traceId: 'trace.1',
  assetId: 'asset.frame.1',
  queryKind: 'text',
  query: 'the dancer',
  task: 'grounding',
  output: 'box',
  cardinality: 'one',
  frameNumber: 42,
  ...overrides,
});

const licenseBoundary = {
  codeLicenseRef: 'license.locate-anything-code',
  modelLicenseRef: 'license.locate-anything-model',
  accepted: true,
};

describe('visual grounding contracts', () => {
  it('keeps requests text-only and media-locator-free', () => {
    expect(() => validateLocateRequest(request())).not.toThrow();
    expect(() =>
      validateLocateRequest({ ...request(), mediaUrl: 'https://private.example/frame.jpg' }),
    ).toThrow(/mediaUrl is not allowed/);
    expect(() => validateLocateRequest({ ...request(), queryKind: 'visual' })).toThrow(
      /queryKind must be text/,
    );
  });

  it('normalizes LocateAnything integer boxes without inventing confidence', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({ answer: '<ref>dancer</ref><box><100><200><700><900></box>' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const provider = createLocateAnythingHttpProvider({
      endpoint: 'https://grounding.example/locate',
      modelId: 'nvidia/LocateAnything-3B',
      licenseBoundary,
      fetch,
    });

    const result = await provider.locate(request());

    expect(result.status).toBe('valid');
    expect(result.observations).toEqual([
      {
        id: 'location.1',
        label: 'dancer',
        geometry: { kind: 'box', box: { x: 0.1, y: 0.2, width: 0.6, height: 0.7 } },
      },
    ]);
    expect(result.observations[0]).not.toHaveProperty('confidence');
    const sent = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(sent).not.toHaveProperty('mediaUrl');
    expect(sent.assetId).toBe('asset.frame.1');
  });

  it.each([
    {
      name: 'ambiguous',
      answer:
        '<ref>left dancer</ref><box><0><0><400><900></box><ref>right dancer</ref><box><500><0><900><900></box>',
      status: 'ambiguous',
    },
    { name: 'empty', answer: '<box>none</box>', status: 'empty' },
    { name: 'malformed', answer: '<box><900><200><100><800></box>', status: 'malformed' },
  ])('classifies $name LocateAnything output explicitly', async ({ answer, status }) => {
    const provider = createLocateAnythingHttpProvider({
      endpoint: 'http://localhost:9000/locate',
      modelId: 'nvidia/LocateAnything-3B',
      licenseBoundary,
      fetch: async () => new Response(JSON.stringify({ answer }), { status: 200 }),
    });
    expect((await provider.locate(request())).status).toBe(status);
  });

  it('fails closed at the separate code/model license boundary', async () => {
    const provider = createLocateAnythingHttpProvider({
      endpoint: 'https://grounding.example/locate',
      modelId: 'nvidia/LocateAnything-3B',
      licenseBoundary: { ...licenseBoundary, accepted: false },
      fetch: vi.fn(),
      now: () => new Date('2026-07-15T12:00:00.000Z'),
    });

    expect((await provider.locate(request())).status).toBe('failed');
    const health = await provider.health();
    expect(health.status).toBe('unavailable');
    expect(health.capabilities.visualPrompt).toBe(false);
    expect(health.licenseBoundary).toMatchObject({ accepted: false });
    expect(() => validateLocateHealth(health)).not.toThrow();
  });

  it('supports manual, disabled, and replay implementations without changing the contract', async () => {
    const manual = createManualLocateProvider({
      resolve: () => [
        {
          id: 'manual.1',
          geometry: { kind: 'box', box: { x: 0.1, y: 0.1, width: 0.5, height: 0.6 } },
        },
      ],
    });
    const manualResult = await manual.locate(request());
    expect(manualResult.status).toBe('manual');
    expect(manualResult.observations[0]).not.toHaveProperty('confidence');

    const disabled = createDisabledLocateProvider();
    expect((await disabled.locate(request())).status).toBe('failed');
    expect((await disabled.health()).status).toBe('disabled');

    const replayResult: LocateResult = {
      schemaVersion: LOCATE_RESULT_SCHEMA_VERSION,
      requestId: 'locate.1',
      traceId: 'trace.1',
      assetId: 'asset.frame.1',
      provider: { id: 'provider.recorded', implementation: 'replay' },
      status: 'valid',
      observations: [
        { id: 'location.1', geometry: { kind: 'box', box: { x: 0, y: 0, width: 1, height: 1 } } },
      ],
    };
    const replay = createReplayLocateProvider({ results: { 'locate.1': replayResult } });
    const replayed = await replay.locate(request());
    expect(replayed.status).toBe('valid');
    expect(replayed.provider.implementation).toBe('replay');
    expect(() => validateLocateResult(replayed, request())).not.toThrow();
  });

  it('rejects unnormalized geometry and naked confidence values', () => {
    const base: LocateResult = {
      schemaVersion: LOCATE_RESULT_SCHEMA_VERSION,
      requestId: 'locate.1',
      traceId: 'trace.1',
      assetId: 'asset.frame.1',
      provider: { id: 'provider.replay', implementation: 'replay' },
      status: 'valid',
      observations: [
        { id: 'location.1', geometry: { kind: 'box', box: { x: 0, y: 0, width: 1, height: 1 } } },
      ],
    };
    expect(() =>
      validateLocateResult({
        ...base,
        observations: [
          {
            id: 'location.1',
            geometry: { kind: 'box', box: { x: 100, y: 0, width: 1, height: 1 } },
          },
        ],
      }),
    ).toThrow(/normalized/);
    expect(() =>
      validateLocateResult({
        ...base,
        observations: [{ ...base.observations[0], confidence: 0.9 }],
      }),
    ).toThrow();
  });
});
