#!/usr/bin/env node

import {
  createDisabledLocateProvider,
  createLocateAnythingHttpProvider,
  createManualLocateProvider,
  createReplayLocateProvider,
  validateLocateRequest,
} from '../../src/lib/visual-grounding.ts';

const request = {
  schemaVersion: 'nodevideo.locate-request.v1',
  requestId: 'request.doctor',
  traceId: 'trace.doctor',
  assetId: 'asset.doctor-fixture',
  queryKind: 'text',
  query: 'primary dancer full body',
  task: 'grounding',
  output: 'box',
  cardinality: 'one',
};
validateLocateRequest(request);
const replayResult = {
  schemaVersion: 'nodevideo.locate-result.v1',
  requestId: request.requestId,
  traceId: request.traceId,
  assetId: request.assetId,
  provider: { id: 'provider.replay', implementation: 'replay' },
  status: 'valid',
  observations: [
    {
      id: 'observation.dancer',
      geometry: { kind: 'box', box: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 } },
      label: 'primary dancer full body',
    },
  ],
};
const replay = createReplayLocateProvider({ results: { [request.requestId]: replayResult } });
const manual = createManualLocateProvider({
  resolve: () => [
    {
      id: 'observation.manual',
      geometry: { kind: 'box', box: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 } },
    },
  ],
});
const disabled = createDisabledLocateProvider();
const [replayHealth, replayLocate, manualHealth, manualLocate, disabledHealth, disabledLocate] =
  await Promise.all([
    replay.health(),
    replay.locate(request),
    manual.health(),
    manual.locate(request),
    disabled.health(),
    disabled.locate(request),
  ]);

const locateConfigured = Boolean(process.env.NODEVIDEO_LOCATEANYTHING_ENDPOINT);
const locateProvider = locateConfigured
  ? createLocateAnythingHttpProvider({
      endpoint: process.env.NODEVIDEO_LOCATEANYTHING_ENDPOINT,
      healthEndpoint: process.env.NODEVIDEO_LOCATEANYTHING_HEALTH_ENDPOINT,
      modelId: 'nvidia/LocateAnything-3B',
      timeoutMs: 2 * 60_000,
      licenseBoundary: {
        codeLicenseRef: process.env.NODEVIDEO_LOCATEANYTHING_CODE_LICENSE_REF ?? 'missing',
        modelLicenseRef: process.env.NODEVIDEO_LOCATEANYTHING_MODEL_LICENSE_REF ?? 'missing',
        accepted: process.env.NODEVIDEO_LOCATEANYTHING_LICENSE_ACCEPTED === 'true',
      },
    })
  : undefined;
const [locateHealth, locateResult] = locateProvider
  ? await Promise.all([locateProvider.health(), locateProvider.locate(request)])
  : [undefined, undefined];
const locateAnything = {
  configured: locateConfigured,
  endpointDeclared: Boolean(process.env.NODEVIDEO_LOCATEANYTHING_ENDPOINT),
  codeLicenseRefDeclared: Boolean(process.env.NODEVIDEO_LOCATEANYTHING_CODE_LICENSE_REF),
  modelLicenseRefDeclared: Boolean(process.env.NODEVIDEO_LOCATEANYTHING_MODEL_LICENSE_REF),
  modelLicenseAccepted: process.env.NODEVIDEO_LOCATEANYTHING_LICENSE_ACCEPTED === 'true',
  modelDownloadedByDoctor: false,
  visualPromptClaimed: false,
  status: locateResult?.status ?? 'optional-not-contacted',
  health: locateHealth?.status ?? 'not-contacted',
  observationCount: locateResult?.observations.length ?? 0,
};
const checks = [
  ['replay provider is healthy', replayHealth.status === 'healthy'],
  ['replay provider returns a bound valid box', replayLocate.status === 'valid'],
  ['manual provider is healthy', manualHealth.status === 'healthy'],
  ['manual provider returns explicit manual status', manualLocate.status === 'manual'],
  ['disabled provider reports disabled', disabledHealth.status === 'disabled'],
  ['disabled provider fails closed', disabledLocate.status === 'failed'],
  ['no visual-prompt capability is claimed', replayHealth.capabilities.visualPrompt === false],
  ['doctor never downloads model weights', locateAnything.modelDownloadedByDoctor === false],
  ...(locateConfigured
    ? [
        ['LocateAnything code license is declared', locateAnything.codeLicenseRefDeclared],
        ['LocateAnything model license is declared', locateAnything.modelLicenseRefDeclared],
        ['LocateAnything license use is accepted', locateAnything.modelLicenseAccepted],
        ['LocateAnything sidecar is healthy', locateHealth?.status === 'healthy'],
        ['LocateAnything returns a live valid observation', locateResult?.status === 'valid'],
        [
          'LocateAnything preserves provider identity',
          locateResult?.provider.implementation === 'locate-anything-http',
        ],
        [
          'LocateAnything does not invent confidence',
          locateResult?.observations.every((item) => item.confidence === undefined) === true,
        ],
      ]
    : []),
];
const report = {
  schemaVersion: 'nodevideo.grounding-doctor.v1',
  passed: checks.every(([, passed]) => passed),
  checks: checks.map(([name, passed]) => ({ name, passed })),
  profiles: {
    replay: { health: replayHealth.status, locate: replayLocate.status },
    manual: { health: manualHealth.status, locate: manualLocate.status },
    disabled: { health: disabledHealth.status, locate: disabledLocate.status },
    locateAnything,
  },
  nextStep: locateAnything.configured
    ? reportPassed(locateHealth, locateResult)
      ? 'Live LocateAnything sidecar is healthy and returned a contract-valid observation.'
      : 'Inspect the live LocateAnything health and result checks above.'
    : 'Optional: configure an operator-managed LocateAnything HTTP sidecar; replay/manual remain fully usable.',
};

if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  for (const check of report.checks)
    console.log(`${check.passed ? 'PASS' : 'FAIL'}: ${check.name}`);
  console.log(
    `OPTIONAL: LocateAnything ${locateAnything.configured ? 'declared' : 'not configured'}.`,
  );
  console.log(report.nextStep);
}
if (!report.passed) process.exitCode = 1;

function reportPassed(health, result) {
  return health?.status === 'healthy' && result?.status === 'valid';
}
