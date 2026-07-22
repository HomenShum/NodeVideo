import type { CreatorBenchWorkflow } from './creatorbench-contracts';

export type MetricValue = number | boolean | null;
export type WorkflowEvaluation = {
  workflow: CreatorBenchWorkflow;
  metricVersion: string;
  metrics: Record<string, MetricValue>;
  requiredMetricNames: string[];
  missingMetricNames: string[];
  blockingFindings: string[];
  machinePass: boolean;
};

const REQUIRED_METRICS: Record<CreatorBenchWorkflow, string[]> = {
  'smart-reframe': [
    'targetRetention',
    'identitySwitches',
    'cropJitter',
    'actionContextRetention',
    'lowConfidenceCoverage',
    'exportReopens',
  ],
  'talking-head-cleanup': [
    'speechRetention',
    'wordTruncations',
    'intentionalPauseFalsePositives',
    'audioClicks',
    'audioVideoSyncMs',
    'exportReopens',
  ],
  'golden-quote-variants': [
    'quoteSourceFidelity',
    'semanticCompleteness',
    'durationCompliance',
    'captionAccuracy',
    'sourceFrameLineage',
    'exportReopens',
  ],
  'reference-template': [
    'structuralAdherence',
    'sourceFaithfulness',
    'protectedAssetCopies',
    'formatCompliance',
    'exportReopens',
  ],
  'dance-choreography': [
    'phraseCoverage',
    'cutTiming',
    'importantLimbCoverage',
    'musicalAlignment',
    'exportReopens',
  ],
  'captioned-multi-format': [
    'captionAccuracy',
    'safeRegionCompliance',
    'subjectRetention',
    'audioVideoSyncMs',
    'exportReopens',
  ],
  'founder-product-launch': [
    'narrativeRoleCoverage',
    'productSourceFaithfulness',
    'demonstrationVisibility',
    'ctaPresent',
    'durationCompliance',
    'exportReopens',
  ],
  'action-subject-following': [
    'targetRetention',
    'identitySwitches',
    'actionContextRetention',
    'lowConfidenceCoverage',
    'exportReopens',
  ],
};

export function evaluateWorkflowMetrics(input: {
  workflow: CreatorBenchWorkflow;
  metrics: Record<string, MetricValue>;
}): WorkflowEvaluation {
  const requiredMetricNames = REQUIRED_METRICS[input.workflow];
  const missingMetricNames = requiredMetricNames.filter(
    (name) => input.metrics[name] === null || input.metrics[name] === undefined,
  );
  const blockingFindings: string[] = [];
  const value = (name: string) => input.metrics[name];
  const identitySwitches = value('identitySwitches');
  const wordTruncations = value('wordTruncations');
  const protectedAssetCopies = value('protectedAssetCopies');
  const audioVideoSyncMs = value('audioVideoSyncMs');
  if (value('exportReopens') === false) blockingFindings.push('export-does-not-reopen');
  if (typeof identitySwitches === 'number' && identitySwitches > 0)
    blockingFindings.push('identity-switch');
  if (typeof wordTruncations === 'number' && wordTruncations > 0)
    blockingFindings.push('word-truncation');
  if (typeof protectedAssetCopies === 'number' && protectedAssetCopies > 0)
    blockingFindings.push('protected-asset-copy');
  if (typeof audioVideoSyncMs === 'number' && Math.abs(audioVideoSyncMs) > 80)
    blockingFindings.push('audio-video-desync');
  for (const name of [
    'targetRetention',
    'speechRetention',
    'quoteSourceFidelity',
    'semanticCompleteness',
    'sourceFaithfulness',
    'importantLimbCoverage',
    'subjectRetention',
    'productSourceFaithfulness',
  ]) {
    const metric = value(name);
    if (typeof metric === 'number' && metric < 0.9) blockingFindings.push(`${name}-below-floor`);
  }
  return {
    workflow: input.workflow,
    metricVersion: 'creatorbench-workflow-metrics-v1',
    metrics: { ...input.metrics },
    requiredMetricNames,
    missingMetricNames,
    blockingFindings,
    machinePass: missingMetricNames.length === 0 && blockingFindings.length === 0,
  };
}

export function requiredWorkflowMetrics(workflow: CreatorBenchWorkflow) {
  return [...REQUIRED_METRICS[workflow]];
}
