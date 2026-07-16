export const LOCATE_REQUEST_SCHEMA_VERSION = 'nodevideo.locate-request.v1' as const;
export const LOCATE_RESULT_SCHEMA_VERSION = 'nodevideo.locate-result.v1' as const;
export const LOCATE_HEALTH_SCHEMA_VERSION = 'nodevideo.locate-health.v1' as const;

export type LocateStatus = 'valid' | 'ambiguous' | 'malformed' | 'empty' | 'failed' | 'manual';

export type LocateProviderImplementation =
  | 'locate-anything-http'
  | 'manual'
  | 'disabled'
  | 'replay';

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface NormalizedBox extends NormalizedPoint {
  width: number;
  height: number;
}

export type LocateGeometry =
  | { kind: 'point'; point: NormalizedPoint }
  | { kind: 'box'; box: NormalizedBox };

/** Confidence is optional and may only preserve a value explicitly reported by a provider. */
export interface ProviderReportedConfidence {
  value: number;
  provenance: 'provider-reported';
}

export interface LocateObservation {
  id: string;
  geometry: LocateGeometry;
  label?: string;
  confidence?: ProviderReportedConfidence;
}

/**
 * Media remains behind the asset boundary. A request carries an asset ID and
 * optional frame number, never a URL, path, object URL, token, or media bytes.
 * LocateAnything's released checkpoint is text-query capable; this contract
 * deliberately has no visual-prompt input.
 */
export interface LocateRequest {
  schemaVersion: typeof LOCATE_REQUEST_SCHEMA_VERSION;
  requestId: string;
  traceId: string;
  assetId: string;
  queryKind: 'text';
  query: string;
  task: 'grounding' | 'detection' | 'pointing';
  output: 'box' | 'point';
  cardinality: 'one' | 'many';
  frameNumber?: number;
  maxResults?: number;
}

export interface LocateProviderIdentity {
  id: string;
  implementation: LocateProviderImplementation;
  modelId?: string;
}

export interface LocateDiagnostic {
  code: string;
  message: string;
  retryable: boolean;
}

export interface LocateResult {
  schemaVersion: typeof LOCATE_RESULT_SCHEMA_VERSION;
  requestId: string;
  traceId: string;
  assetId: string;
  provider: LocateProviderIdentity;
  status: LocateStatus;
  observations: LocateObservation[];
  diagnostic?: LocateDiagnostic;
}

export interface LocateLicenseBoundary {
  /** Operator-supplied reference for the HTTP wrapper/source-code license. */
  codeLicenseRef: string;
  /** Operator-supplied reference for the separately governed model weights. */
  modelLicenseRef: string;
  accepted: boolean;
}

export interface LocateHealth {
  schemaVersion: typeof LOCATE_HEALTH_SCHEMA_VERSION;
  provider: LocateProviderIdentity;
  status: 'healthy' | 'degraded' | 'unavailable' | 'disabled';
  capabilities: {
    textPrompt: boolean;
    visualPrompt: false;
    boxes: boolean;
    points: boolean;
  };
  licenseBoundary: LocateLicenseBoundary;
  checkedAt: string;
  diagnostic?: LocateDiagnostic;
}

export interface VisualGroundingProvider {
  readonly id: string;
  locate(request: LocateRequest): Promise<LocateResult>;
  health(): Promise<LocateHealth>;
}

export interface LocateAnythingHttpProviderOptions {
  id?: string;
  endpoint: string;
  healthEndpoint?: string;
  modelId: string;
  licenseBoundary: LocateLicenseBoundary;
  headers?: Readonly<Record<string, string>>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  now?: () => Date;
}

export interface ManualLocateProviderOptions {
  id?: string;
  resolve: (
    request: Readonly<LocateRequest>,
  ) => readonly ManualLocateObservation[] | Promise<readonly ManualLocateObservation[]>;
  now?: () => Date;
}

export type ManualLocateObservation = Omit<LocateObservation, 'confidence'>;

export interface ReplayLocateProviderOptions {
  id?: string;
  results: Readonly<Record<string, LocateResult>>;
  now?: () => Date;
}

const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const MAX_QUERY_LENGTH = 1_000;
const DEFAULT_RESPONSE_LIMIT = 256 * 1024;

export function createLocateAnythingHttpProvider(
  options: LocateAnythingHttpProviderOptions,
): VisualGroundingProvider {
  const id = options.id ?? 'provider.locate-anything';
  assertId(id, 'LocateAnything provider id');
  const endpoint = validateEndpoint(options.endpoint, 'LocateAnything endpoint');
  const healthEndpoint = options.healthEndpoint
    ? validateEndpoint(options.healthEndpoint, 'LocateAnything health endpoint')
    : undefined;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  assertBoundedString(options.modelId, 'LocateAnything model id', 256);
  validateLicenseBoundary(options.licenseBoundary, 'LocateAnything license boundary');
  const headers = validateHeaders(options.headers ?? {});
  const timeoutMs = boundedInteger(options.timeoutMs ?? 30_000, 1, 5 * 60_000, 'timeoutMs');
  const maxResponseBytes = boundedInteger(
    options.maxResponseBytes ?? DEFAULT_RESPONSE_LIMIT,
    1_024,
    2_000_000,
    'maxResponseBytes',
  );
  const now = options.now ?? (() => new Date());
  const identity: LocateProviderIdentity = {
    id,
    implementation: 'locate-anything-http',
    modelId: options.modelId,
  };

  return {
    id,
    async locate(request) {
      validateLocateRequest(request);
      if (!options.licenseBoundary.accepted) {
        return failureResult(request, identity, 'license-not-accepted', false);
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort('locate request timed out'), timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json', ...headers },
          body: JSON.stringify(request),
          redirect: 'error',
          signal: controller.signal,
        });
        if (!response.ok) {
          return failureResult(
            request,
            identity,
            `http-${response.status}`,
            response.status >= 500,
          );
        }
        const body = await readBoundedText(response, maxResponseBytes);
        let payload: unknown;
        try {
          payload = JSON.parse(body);
        } catch {
          return malformedResult(request, identity, 'response-not-json');
        }
        return locateAnythingPayloadToResult(request, identity, payload);
      } catch (error) {
        return failureResult(request, identity, diagnosticCode(error), true);
      } finally {
        clearTimeout(timeout);
      }
    },
    async health() {
      if (!options.licenseBoundary.accepted) {
        return createHealth(
          identity,
          'unavailable',
          options.licenseBoundary,
          now,
          diagnostic('license-not-accepted', false),
        );
      }
      if (!healthEndpoint) {
        return createHealth(identity, 'healthy', options.licenseBoundary, now);
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort('health request timed out'), timeoutMs);
      try {
        const response = await fetchImpl(healthEndpoint, {
          method: 'GET',
          headers: { accept: 'application/json', ...headers },
          redirect: 'error',
          signal: controller.signal,
        });
        return createHealth(
          identity,
          response.ok ? 'healthy' : 'degraded',
          options.licenseBoundary,
          now,
          response.ok ? undefined : diagnostic(`http-${response.status}`, response.status >= 500),
        );
      } catch (error) {
        return createHealth(
          identity,
          'unavailable',
          options.licenseBoundary,
          now,
          diagnostic(diagnosticCode(error), true),
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function createManualLocateProvider(
  options: ManualLocateProviderOptions,
): VisualGroundingProvider {
  const id = options.id ?? 'provider.manual';
  assertId(id, 'Manual provider id');
  const now = options.now ?? (() => new Date());
  const identity: LocateProviderIdentity = { id, implementation: 'manual' };
  const licenseBoundary = notApplicableLicenseBoundary('nodevideo.manual-grounding');
  return {
    id,
    async locate(request) {
      validateLocateRequest(request);
      try {
        const observations = structuredClone(await options.resolve(structuredClone(request)));
        if (!Array.isArray(observations) || observations.length === 0) {
          return emptyResult(request, identity, 'manual-no-selection');
        }
        const result: LocateResult = {
          schemaVersion: LOCATE_RESULT_SCHEMA_VERSION,
          requestId: request.requestId,
          traceId: request.traceId,
          assetId: request.assetId,
          provider: identity,
          status: 'manual',
          observations,
        };
        validateLocateResult(result, request);
        return result;
      } catch (error) {
        return failureResult(request, identity, diagnosticCode(error), false);
      }
    },
    async health() {
      return createHealth(identity, 'healthy', licenseBoundary, now);
    },
  };
}

export function createDisabledLocateProvider(
  id = 'provider.disabled',
  now: () => Date = () => new Date(),
): VisualGroundingProvider {
  assertId(id, 'Disabled provider id');
  const identity: LocateProviderIdentity = { id, implementation: 'disabled' };
  const licenseBoundary = notApplicableLicenseBoundary('nodevideo.disabled-grounding');
  return {
    id,
    async locate(request) {
      validateLocateRequest(request);
      return failureResult(request, identity, 'provider-disabled', false);
    },
    async health() {
      return createHealth(
        identity,
        'disabled',
        licenseBoundary,
        now,
        diagnostic('provider-disabled', false),
        false,
      );
    },
  };
}

export function createReplayLocateProvider(
  options: ReplayLocateProviderOptions,
): VisualGroundingProvider {
  const id = options.id ?? 'provider.replay';
  assertId(id, 'Replay provider id');
  const now = options.now ?? (() => new Date());
  const identity: LocateProviderIdentity = { id, implementation: 'replay' };
  const licenseBoundary = notApplicableLicenseBoundary('nodevideo.replay-grounding');
  return {
    id,
    async locate(request) {
      validateLocateRequest(request);
      const replayed = options.results[request.requestId];
      if (!replayed) return failureResult(request, identity, 'replay-miss', false);
      const result = structuredClone(replayed);
      result.provider = identity;
      try {
        validateLocateResult(result, request);
        return result;
      } catch {
        return malformedResult(request, identity, 'replay-binding-invalid');
      }
    },
    async health() {
      return createHealth(identity, 'healthy', licenseBoundary, now);
    },
  };
}

export function validateLocateRequest(value: unknown): asserts value is LocateRequest {
  const request = asRecord(value, 'LocateRequest');
  assertExactKeys(
    request,
    'LocateRequest',
    [
      'schemaVersion',
      'requestId',
      'traceId',
      'assetId',
      'queryKind',
      'query',
      'task',
      'output',
      'cardinality',
    ],
    ['frameNumber', 'maxResults'],
  );
  assert(request.schemaVersion === LOCATE_REQUEST_SCHEMA_VERSION, 'Unsupported LocateRequest.');
  assertId(request.requestId, 'LocateRequest.requestId');
  assertId(request.traceId, 'LocateRequest.traceId');
  assertId(request.assetId, 'LocateRequest.assetId');
  assert(request.queryKind === 'text', 'LocateRequest.queryKind must be text.');
  assertBoundedString(request.query, 'LocateRequest.query', MAX_QUERY_LENGTH);
  assertOneOf(request.task, ['grounding', 'detection', 'pointing'], 'LocateRequest.task');
  assertOneOf(request.output, ['box', 'point'], 'LocateRequest.output');
  assertOneOf(request.cardinality, ['one', 'many'], 'LocateRequest.cardinality');
  if (request.task === 'pointing')
    assert(request.output === 'point', 'Pointing requires point output.');
  if (request.frameNumber !== undefined) {
    boundedInteger(request.frameNumber, 0, Number.MAX_SAFE_INTEGER, 'LocateRequest.frameNumber');
  }
  if (request.maxResults !== undefined) {
    boundedInteger(request.maxResults, 1, 1_000, 'LocateRequest.maxResults');
  }
}

export function validateLocateResult(
  value: unknown,
  request?: LocateRequest,
): asserts value is LocateResult {
  if (request) validateLocateRequest(request);
  const result = asRecord(value, 'LocateResult');
  assertExactKeys(
    result,
    'LocateResult',
    ['schemaVersion', 'requestId', 'traceId', 'assetId', 'provider', 'status', 'observations'],
    ['diagnostic'],
  );
  assert(result.schemaVersion === LOCATE_RESULT_SCHEMA_VERSION, 'Unsupported LocateResult.');
  assertId(result.requestId, 'LocateResult.requestId');
  assertId(result.traceId, 'LocateResult.traceId');
  assertId(result.assetId, 'LocateResult.assetId');
  validateProviderIdentity(result.provider, 'LocateResult.provider');
  assertOneOf(
    result.status,
    ['valid', 'ambiguous', 'malformed', 'empty', 'failed', 'manual'],
    'LocateResult.status',
  );
  assert(Array.isArray(result.observations), 'LocateResult.observations must be an array.');
  const observationIds = new Set<string>();
  result.observations.forEach((item, index) => {
    validateObservation(item, `LocateResult.observations[${index}]`);
    assert(!observationIds.has(item.id), 'LocateResult observation IDs must be unique.');
    observationIds.add(item.id);
  });
  const hasLocations = ['valid', 'ambiguous', 'manual'].includes(result.status as string);
  assert(
    hasLocations ? result.observations.length > 0 : result.observations.length === 0,
    `LocateResult ${String(result.status)} has an invalid observation count.`,
  );
  if (result.status === 'manual') {
    assert(
      result.observations.every((item) => item.confidence === undefined),
      'Manual observations cannot claim provider confidence.',
    );
  }
  if (result.diagnostic !== undefined)
    validateDiagnostic(result.diagnostic, 'LocateResult.diagnostic');
  if (result.status === 'failed' || result.status === 'malformed') {
    assert(
      result.diagnostic !== undefined,
      `${String(result.status)} results require a diagnostic.`,
    );
  }
  if (request) {
    assert(result.requestId === request.requestId, 'LocateResult request ID does not match.');
    assert(result.traceId === request.traceId, 'LocateResult trace ID does not match.');
    assert(result.assetId === request.assetId, 'LocateResult asset ID does not match.');
    if (result.status === 'valid' && request.cardinality === 'one') {
      assert(
        result.observations.length === 1,
        'Single-cardinality result must contain one observation.',
      );
    }
    for (const observation of result.observations) {
      assert(
        observation.geometry.kind === request.output,
        'LocateResult geometry kind does not match.',
      );
    }
  }
}

export function validateLocateHealth(value: unknown): asserts value is LocateHealth {
  const health = asRecord(value, 'LocateHealth');
  assertExactKeys(
    health,
    'LocateHealth',
    ['schemaVersion', 'provider', 'status', 'capabilities', 'licenseBoundary', 'checkedAt'],
    ['diagnostic'],
  );
  assert(health.schemaVersion === LOCATE_HEALTH_SCHEMA_VERSION, 'Unsupported LocateHealth.');
  validateProviderIdentity(health.provider, 'LocateHealth.provider');
  assertOneOf(
    health.status,
    ['healthy', 'degraded', 'unavailable', 'disabled'],
    'LocateHealth.status',
  );
  const capabilities = asRecord(health.capabilities, 'LocateHealth.capabilities');
  assertExactKeys(capabilities, 'LocateHealth.capabilities', [
    'textPrompt',
    'visualPrompt',
    'boxes',
    'points',
  ]);
  for (const key of ['textPrompt', 'boxes', 'points'] as const) {
    assert(typeof capabilities[key] === 'boolean', `LocateHealth.capabilities.${key} is invalid.`);
  }
  assert(capabilities.visualPrompt === false, 'Visual-prompt support must not be promised.');
  validateLicenseBoundary(health.licenseBoundary, 'LocateHealth.licenseBoundary');
  assertIsoTimestamp(health.checkedAt, 'LocateHealth.checkedAt');
  if (health.diagnostic !== undefined)
    validateDiagnostic(health.diagnostic, 'LocateHealth.diagnostic');
}

export function isNormalizedPoint(value: unknown): value is NormalizedPoint {
  try {
    validatePoint(value, 'NormalizedPoint');
    return true;
  } catch {
    return false;
  }
}

export function isNormalizedBox(value: unknown): value is NormalizedBox {
  try {
    validateBox(value, 'NormalizedBox');
    return true;
  } catch {
    return false;
  }
}

function locateAnythingPayloadToResult(
  request: LocateRequest,
  provider: LocateProviderIdentity,
  payload: unknown,
): LocateResult {
  const record = isRecord(payload) ? payload : undefined;
  if (!record || typeof record.answer !== 'string') {
    return malformedResult(request, provider, 'missing-answer');
  }
  const answer = record.answer.trim();
  if (answer.includes('<box>none</box>')) return emptyResult(request, provider, 'no-object');
  const parsed = parseLocateAnythingAnswer(answer, request.output);
  if (parsed.malformed) return malformedResult(request, provider, 'malformed-coordinates');
  if (parsed.observations.length === 0)
    return malformedResult(request, provider, 'missing-coordinates');
  if (request.maxResults !== undefined && parsed.observations.length > request.maxResults) {
    return malformedResult(request, provider, 'result-limit-exceeded');
  }
  const result: LocateResult = {
    schemaVersion: LOCATE_RESULT_SCHEMA_VERSION,
    requestId: request.requestId,
    traceId: request.traceId,
    assetId: request.assetId,
    provider,
    status: request.cardinality === 'one' && parsed.observations.length > 1 ? 'ambiguous' : 'valid',
    observations: parsed.observations,
  };
  validateLocateResult(result, request);
  return result;
}

function parseLocateAnythingAnswer(
  answer: string,
  output: LocateRequest['output'],
): { observations: LocateObservation[]; malformed: boolean } {
  const observations: LocateObservation[] = [];
  const pattern = /(?:<ref>([^<]{1,500})<\/ref>\s*)?<box>((?:<\d+>){2}|(?:<\d+>){4})<\/box>/g;
  let matchedBoxes = 0;
  let match = pattern.exec(answer);
  while (match !== null) {
    matchedBoxes += 1;
    const values = [...match[2].matchAll(/<(\d+)>/g)].map((item) => Number(item[1]));
    if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 1_000)) {
      return { observations: [], malformed: true };
    }
    const label = match[1]?.trim();
    if (output === 'point' && values.length === 2) {
      observations.push({
        id: `location.${observations.length + 1}`,
        ...(label ? { label } : {}),
        geometry: { kind: 'point', point: { x: values[0] / 1_000, y: values[1] / 1_000 } },
      });
    } else if (output === 'box' && values.length === 4) {
      const [x1, y1, x2, y2] = values;
      if (x2 <= x1 || y2 <= y1) return { observations: [], malformed: true };
      observations.push({
        id: `location.${observations.length + 1}`,
        ...(label ? { label } : {}),
        geometry: {
          kind: 'box',
          box: {
            x: x1 / 1_000,
            y: y1 / 1_000,
            width: (x2 - x1) / 1_000,
            height: (y2 - y1) / 1_000,
          },
        },
      });
    } else {
      return { observations: [], malformed: true };
    }
    match = pattern.exec(answer);
  }
  const declaredBoxes = (answer.match(/<box>/g) ?? []).length;
  return { observations, malformed: declaredBoxes !== matchedBoxes };
}

function validateObservation(value: unknown, label: string): asserts value is LocateObservation {
  const observation = asRecord(value, label);
  assertExactKeys(observation, label, ['id', 'geometry'], ['label', 'confidence']);
  assertId(observation.id, `${label}.id`);
  const geometry = asRecord(observation.geometry, `${label}.geometry`);
  assertOneOf(geometry.kind, ['point', 'box'], `${label}.geometry.kind`);
  if (geometry.kind === 'point') {
    assertExactKeys(geometry, `${label}.geometry`, ['kind', 'point']);
    validatePoint(geometry.point, `${label}.geometry.point`);
  } else {
    assertExactKeys(geometry, `${label}.geometry`, ['kind', 'box']);
    validateBox(geometry.box, `${label}.geometry.box`);
  }
  if (observation.label !== undefined)
    assertBoundedString(observation.label, `${label}.label`, 500);
  if (observation.confidence !== undefined) {
    const confidence = asRecord(observation.confidence, `${label}.confidence`);
    assertExactKeys(confidence, `${label}.confidence`, ['value', 'provenance']);
    assertUnitInterval(confidence.value, `${label}.confidence.value`);
    assert(
      confidence.provenance === 'provider-reported',
      `${label}.confidence.provenance must be provider-reported.`,
    );
  }
}

function validatePoint(value: unknown, label: string): asserts value is NormalizedPoint {
  const point = asRecord(value, label);
  assertExactKeys(point, label, ['x', 'y']);
  assertUnitInterval(point.x, `${label}.x`);
  assertUnitInterval(point.y, `${label}.y`);
}

function validateBox(value: unknown, label: string): asserts value is NormalizedBox {
  const box = asRecord(value, label);
  assertExactKeys(box, label, ['x', 'y', 'width', 'height']);
  assertUnitInterval(box.x, `${label}.x`);
  assertUnitInterval(box.y, `${label}.y`);
  assertFiniteNumber(box.width, `${label}.width`);
  assertFiniteNumber(box.height, `${label}.height`);
  assert(box.width > 0 && box.height > 0, `${label} dimensions must be positive.`);
  assert(box.x + box.width <= 1 + 1e-9, `${label} exceeds normalized width.`);
  assert(box.y + box.height <= 1 + 1e-9, `${label} exceeds normalized height.`);
}

function validateProviderIdentity(
  value: unknown,
  label: string,
): asserts value is LocateProviderIdentity {
  const provider = asRecord(value, label);
  assertExactKeys(provider, label, ['id', 'implementation'], ['modelId']);
  assertId(provider.id, `${label}.id`);
  assertOneOf(
    provider.implementation,
    ['locate-anything-http', 'manual', 'disabled', 'replay'],
    `${label}.implementation`,
  );
  if (provider.modelId !== undefined)
    assertBoundedString(provider.modelId, `${label}.modelId`, 256);
}

function validateLicenseBoundary(
  value: unknown,
  label: string,
): asserts value is LocateLicenseBoundary {
  const boundary = asRecord(value, label);
  assertExactKeys(boundary, label, ['codeLicenseRef', 'modelLicenseRef', 'accepted']);
  assertBoundedString(boundary.codeLicenseRef, `${label}.codeLicenseRef`, 1_000);
  assertBoundedString(boundary.modelLicenseRef, `${label}.modelLicenseRef`, 1_000);
  assert(typeof boundary.accepted === 'boolean', `${label}.accepted must be boolean.`);
}

function validateDiagnostic(value: unknown, label: string): asserts value is LocateDiagnostic {
  const item = asRecord(value, label);
  assertExactKeys(item, label, ['code', 'message', 'retryable']);
  assertId(item.code, `${label}.code`);
  assertBoundedString(item.message, `${label}.message`, 1_000);
  assert(typeof item.retryable === 'boolean', `${label}.retryable must be boolean.`);
}

function createHealth(
  provider: LocateProviderIdentity,
  status: LocateHealth['status'],
  licenseBoundary: LocateLicenseBoundary,
  now: () => Date,
  diagnosticValue?: LocateDiagnostic,
  textPrompt = true,
): LocateHealth {
  const health: LocateHealth = {
    schemaVersion: LOCATE_HEALTH_SCHEMA_VERSION,
    provider,
    status,
    capabilities: { textPrompt, visualPrompt: false, boxes: true, points: true },
    licenseBoundary,
    checkedAt: now().toISOString(),
    ...(diagnosticValue ? { diagnostic: diagnosticValue } : {}),
  };
  validateLocateHealth(health);
  return health;
}

function notApplicableLicenseBoundary(codeLicenseRef: string): LocateLicenseBoundary {
  return { codeLicenseRef, modelLicenseRef: 'not-applicable', accepted: true };
}

function failureResult(
  request: LocateRequest,
  provider: LocateProviderIdentity,
  code: string,
  retryable: boolean,
): LocateResult {
  return {
    schemaVersion: LOCATE_RESULT_SCHEMA_VERSION,
    requestId: request.requestId,
    traceId: request.traceId,
    assetId: request.assetId,
    provider,
    status: 'failed',
    observations: [],
    diagnostic: diagnostic(code, retryable),
  };
}

function malformedResult(
  request: LocateRequest,
  provider: LocateProviderIdentity,
  code: string,
): LocateResult {
  return {
    schemaVersion: LOCATE_RESULT_SCHEMA_VERSION,
    requestId: request.requestId,
    traceId: request.traceId,
    assetId: request.assetId,
    provider,
    status: 'malformed',
    observations: [],
    diagnostic: diagnostic(code, false),
  };
}

function emptyResult(
  request: LocateRequest,
  provider: LocateProviderIdentity,
  code: string,
): LocateResult {
  return {
    schemaVersion: LOCATE_RESULT_SCHEMA_VERSION,
    requestId: request.requestId,
    traceId: request.traceId,
    assetId: request.assetId,
    provider,
    status: 'empty',
    observations: [],
    diagnostic: diagnostic(code, false),
  };
}

function diagnostic(code: string, retryable: boolean): LocateDiagnostic {
  const clean = PROVIDER_ID_PATTERN.test(code) ? code : 'provider-error';
  return { code: clean, message: clean.replaceAll('-', ' '), retryable };
}

function diagnosticCode(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'request-timeout';
  return error instanceof Error && /timeout|aborted/i.test(error.message)
    ? 'request-timeout'
    : 'provider-error';
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('response too large');
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('response too large');
  return text;
}

function validateEndpoint(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const local = ['localhost', '127.0.0.1', '::1'].includes(host);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error(`${label} must use HTTPS except on localhost.`);
  }
  if (url.username || url.password) throw new Error(`${label} cannot contain credentials.`);
  url.hash = '';
  return url.toString();
}

function validateHeaders(input: Readonly<Record<string, string>>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(input)) {
    const name = rawName.trim().toLowerCase();
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || /[\r\n]/.test(value)) {
      throw new Error('LocateAnything header is invalid.');
    }
    if (['host', 'content-length', 'content-type'].includes(name)) {
      throw new Error(`LocateAnything header ${name} is managed by the provider.`);
    }
    output[name] = value;
  }
  return output;
}

function asRecord(value: unknown, label: string): Record<string, any> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, any>,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) assert(Object.hasOwn(value, key), `${label}.${key} is required.`);
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label}.${key} is not allowed.`);
}

function assertId(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && PROVIDER_ID_PATTERN.test(value), `${label} is invalid.`);
}

function assertBoundedString(value: unknown, label: string, max: number): asserts value is string {
  assert(
    typeof value === 'string' && value.trim().length > 0 && value.length <= max,
    `${label} is invalid.`,
  );
}

function assertOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): asserts value is T {
  assert(typeof value === 'string' && allowed.includes(value as T), `${label} is invalid.`);
}

function assertUnitInterval(value: unknown, label: string): asserts value is number {
  assertFiniteNumber(value, label);
  assert(value >= 0 && value <= 1, `${label} must be normalized to 0..1.`);
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  assert(typeof value === 'number' && Number.isFinite(value), `${label} must be finite.`);
}

function boundedInteger(value: unknown, min: number, max: number, label: string): number {
  assert(
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max,
    `${label} is invalid.`,
  );
  return value;
}

function assertIsoTimestamp(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === 'string' &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    `${label} must be an ISO timestamp.`,
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
