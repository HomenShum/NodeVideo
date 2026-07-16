#!/usr/bin/env node

import {
  createDisabledLocateProvider,
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

const locateAnything = {
  configured: Boolean(process.env.NODEVIDEO_LOCATEANYTHING_ENDPOINT),
  endpointDeclared: Boolean(process.env.NODEVIDEO_LOCATEANYTHING_ENDPOINT),
  codeLicenseRefDeclared: Boolean(process.env.NODEVIDEO_LOCATEANYTHING_CODE_LICENSE_REF),
  modelLicenseRefDeclared: Boolean(process.env.NODEVIDEO_LOCATEANYTHING_MODEL_LICENSE_REF),
  modelLicenseAccepted: process.env.NODEVIDEO_LOCATEANYTHING_LICENSE_ACCEPTED === 'true',
  modelDownloadedByDoctor: false,
  visualPromptClaimed: false,
  status: 'optional-not-contacted',
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
    ? 'Use the HTTP provider only after both code and model license references are declared and accepted.'
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
