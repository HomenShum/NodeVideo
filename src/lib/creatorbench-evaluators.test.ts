import { describe, expect, it } from 'vitest';
import { evaluateWorkflowMetrics, requiredWorkflowMetrics } from './creatorbench-evaluators';

describe('CreatorBench workflow evaluators', () => {
  it('defines a complete evaluator for all eight workflow families', () => {
    const workflows = [
      'smart-reframe',
      'talking-head-cleanup',
      'golden-quote-variants',
      'reference-template',
      'dance-choreography',
      'captioned-multi-format',
      'founder-product-launch',
      'action-subject-following',
    ] as const;
    for (const workflow of workflows)
      expect(requiredWorkflowMetrics(workflow).length).toBeGreaterThanOrEqual(5);
  });

  it('fails closed on missing metrics and material editing errors', () => {
    const missing = evaluateWorkflowMetrics({
      workflow: 'smart-reframe',
      metrics: { exportReopens: true },
    });
    expect(missing.machinePass).toBe(false);
    expect(missing.missingMetricNames).toContain('targetRetention');
    const unsafe = evaluateWorkflowMetrics({
      workflow: 'talking-head-cleanup',
      metrics: {
        speechRetention: 0.99,
        wordTruncations: 1,
        intentionalPauseFalsePositives: 0,
        audioClicks: 0,
        audioVideoSyncMs: 10,
        exportReopens: true,
      },
    });
    expect(unsafe.blockingFindings).toContain('word-truncation');
  });
});
