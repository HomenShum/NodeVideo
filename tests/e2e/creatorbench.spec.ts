import { type Page, expect, test } from 'playwright/test';

const report = {
  schemaVersion: 'nodevideo.creatorbench-public-report/v1',
  benchmarkVersion: 'creatorbench-v1.0.0-test',
  status: 'evaluated',
  generatedAt: '2026-07-21T20:00:00.000Z',
  claim: {
    schemaVersion: 'nodevideo.creatorbench-public-claim/v1',
    benchmarkVersion: 'creatorbench-v1.0.0-test',
    freezeReceiptId: 'freeze_test_001',
    population: {
      split: 'private-heldout',
      instanceCount: 200,
      sourceCount: 80,
      creatorDisjointSourceCount: 76,
      domainCount: 15,
      workflowCount: 8,
    },
    outcomes: {
      automatic_usable: {
        numerator: 110,
        denominator: 200,
        rate: 0.55,
        confidenceInterval: { lower: 0.48, upper: 0.62, level: 0.95 },
      },
      assisted_usable: {
        numerator: 30,
        denominator: 200,
        rate: 0.15,
        confidenceInterval: { lower: 0.11, upper: 0.21, level: 0.95 },
      },
      review_required: { numerator: 20, denominator: 200, rate: 0.1 },
      safely_abstained: { numerator: 18, denominator: 200, rate: 0.09 },
      unsupported: { numerator: 8, denominator: 200, rate: 0.04 },
      technical_failure: { numerator: 8, denominator: 200, rate: 0.04 },
      silent_failure: {
        numerator: 6,
        denominator: 200,
        rate: 0.03,
        confidenceInterval: { lower: 0.01, upper: 0.06, level: 0.95 },
      },
    },
    limitations: ['Tiny sports balls remain unreliable under motion blur.'],
  },
  dataset: {
    clips: 250,
    creators: 76,
    domains: 15,
    workflows: 8,
    instances: 200,
    splits: { development: 100, public_test: 60, private_heldout: 40 },
  },
  counts: { reviewedInstances: 120, excludedInstances: 2 },
  metrics: {
    latencyMs: { p50: 4200, p95: 14000 },
    costUsd: { perUsableOutput: 0.043 },
    correctionTimeSeconds: { median: 24 },
    exportReopen: { numerator: 197, denominator: 200, rate: 0.985 },
  },
  missingDataTreatment: 'Excluded values remain in the denominator unless rights-invalid.',
  subgroups: [
    {
      id: 'talking-head',
      label: 'Talking head',
      workflow: 'cleanup',
      total: 40,
      automaticUsable: { numerator: 30, denominator: 40, rate: 0.75 },
      assistedUsable: 0.1,
      reviewRequired: 0.05,
      safelyAbstained: 0.05,
      silentFailure: { numerator: 2, denominator: 40, rate: 0.05 },
      medianCorrectionSeconds: 12,
    },
    {
      id: 'court-sport',
      label: 'Court sport',
      condition: 'tiny target',
      total: 20,
      automaticUsable: { numerator: 6, denominator: 20, rate: 0.3 },
      assistedUsable: 0.25,
      reviewRequired: 0.2,
      safelyAbstained: 0.15,
      silentFailure: { numerator: 2, denominator: 20, rate: 0.1 },
      medianCorrectionSeconds: 54,
    },
  ],
  routes: [
    {
      id: 'local-yolo',
      label: 'YOLO local + envelope critic',
      workflow: 'smart reframe',
      sampleCount: 90,
      usable: { numerator: 63, denominator: 90, rate: 0.7 },
      silentFailure: { numerator: 1, denominator: 90, rate: 0.011 },
      medianCostUsd: 0,
      medianLatencyMs: 1800,
      status: 'observed',
      reason: 'Sampled route; not automatically promoted by this UI.',
    },
  ],
  representativeFailures: [
    {
      id: 'failure-1',
      title: 'Ball lost during rapid pan',
      workflow: 'smart reframe',
      domain: 'basketball',
      outcome: 'silent_failure',
      reason: 'The crop retained the player but lost the requested ball context.',
    },
  ],
  freezeReceipt: {
    receiptId: 'freeze_test_001',
    frozenAt: '2026-07-21T18:00:00.000Z',
    sourceCommit: '0123456789abcdef',
    configHash: 'sha256:test-config',
    manifestHash: 'sha256:test-manifest',
    evaluatorVersion: 'creatorbench-evaluator/1.0.0',
    thresholdPolicy: 'creatorbench-thresholds/v1',
    status: 'verified',
  },
  reviewCases: [
    {
      id: 'public-review-001',
      request: 'Keep the full group visible in a vertical crop.',
      sourcePoster: '/media/tracking-atlas-v1/group-performance/before.jpg',
      outputPoster: '/media/tracking-atlas-v1/group-performance/after.jpg',
      publicSourceLabel: 'Rights-cleared public fixture',
      route: 'group-performance-local',
      confidence: 0.88,
      machineFindings: ['Formation retained throughout the public fixture.'],
      hiddenTargetHint: 'must never render',
    },
  ],
};

async function mockReport(page: Page) {
  await page.route('**/benchmarks/creatorbench-v1/results/public-report.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(report) }),
  );
}

test.describe('CreatorBench public evidence and reviewer UI', () => {
  test('loads the real render pilot with three reopened formats and a blind review queue', async ({
    page,
  }) => {
    await page.goto('/creatorbench');
    await expect(page.getByLabel('Dataset coverage')).toContainText('111');
    await expect(page.getByText('264/264')).toBeVisible();

    const reviewButton = page.getByRole('button', { name: 'Review lab' }).first();
    await reviewButton.scrollIntoViewIfNeeded();
    await reviewButton.click();
    const review = page.getByTestId('review-lab');
    await expect(review).toContainText(/case 1 of 88/iu);
    await expect(review).toContainText('Additional requested formats');
    await expect(review).not.toContainText('Deterministic center-crop baseline');
    await expect(review.locator('img')).toHaveCount(4);
    expect(
      await review
        .locator('img')
        .evaluateAll((images) =>
          images.every((image) => image instanceof HTMLImageElement && image.naturalWidth > 0),
        ),
    ).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
  });

  test('renders exact samples, rates, intervals, subgroups, routes, failures, and freeze receipt', async ({
    page,
  }) => {
    await mockReport(page);
    await page.goto('/creatorbench');
    await expect(page.getByRole('heading', { name: /See what works/i })).toBeVisible();
    await expect(page.getByText('creatorbench-v1.0.0-test')).toBeVisible();
    await expect(page.getByLabel('Dataset coverage')).toContainText('250');
    await expect(page.getByTestId('metric-automatic')).toContainText('55.0%');
    await expect(page.getByTestId('metric-automatic')).toContainText('110/200');
    await expect(page.getByTestId('metric-automatic')).toContainText('95% CI 48.0%–62.0%');
    await expect(page.getByTestId('metric-silent')).toContainText('3.0%');

    await page.getByRole('button', { name: 'Coverage' }).first().click();
    await expect(page.getByTestId('coverage-view')).toContainText('Court sport');
    await expect(page.getByTestId('coverage-view')).toContainText('10.0%');

    await page.getByRole('button', { name: 'Weaknesses' }).first().click();
    await expect(page.getByTestId('failure-view')).toContainText('Tiny sports balls');
    await expect(page.getByTestId('failure-view')).toContainText('Ball lost during rapid pan');

    await page.getByRole('button', { name: 'Route evidence' }).first().click();
    await expect(page.getByTestId('route-view')).toContainText('YOLO local + envelope critic');
    await expect(page.getByTestId('route-view')).toContainText('90');

    await page.getByRole('button', { name: 'Freeze receipt' }).first().click();
    await expect(page.getByTestId('freeze-view')).toContainText('sha256:test-config');
    await expect(page.getByTestId('freeze-view')).toContainText('0123456789abcdef');
  });

  test('keeps reviewer judgment blind, bounded, keyboard-operable, and explicitly non-durable', async ({
    page,
  }) => {
    await mockReport(page);
    await page.goto('/creatorbench');
    await page.getByRole('button', { name: 'Review lab' }).first().click();
    const review = page.getByTestId('review-lab');
    await expect(review).toContainText('LOCAL DRAFT · NOT SAVED');
    await expect(review).not.toContainText('group-performance-local');
    await expect(review).not.toContainText('must never render');
    await page.getByLabel('Minor correction', { exact: false }).check();
    await page.getByLabel('Estimated correction time').fill('18');
    await page.getByLabel('wrong subject').check();
    await page.getByRole('button', { name: 'Hold local judgment' }).click();
    await expect(review).toContainText('Judgment recorded in local memory only');
    await expect(review).toContainText('group-performance-local');
    await expect(page.getByRole('link', { name: 'Download review draft' })).toHaveAttribute(
      'download',
      /creatorbench-review-public-review-001\.json/u,
    );
    await page.reload();
    await page.getByRole('button', { name: 'Review lab' }).first().click();
    await expect(page.getByTestId('review-lab')).not.toContainText('Judgment held locally');
  });

  test('fails closed when the report is absent and never prints invented metrics', async ({
    page,
  }) => {
    await page.route('**/benchmarks/creatorbench-v1/results/public-report.json', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
    );
    await page.goto('/creatorbench');
    await expect(page.getByTestId('error-state')).toContainText('evidence is unavailable');
    await expect(page.getByTestId('error-state')).not.toContainText('100%');
  });

  test('renders an honest unevaluated state when infrastructure exists without results', async ({
    page,
  }) => {
    await page.route('**/benchmarks/creatorbench-v1/results/public-report.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schemaVersion: 'nodevideo.creatorbench-public-report/v1',
          benchmarkVersion: 'creatorbench-v1',
          status: 'infrastructure_only',
          counts: { clips: 0, creators: 0, domains: 0, workflows: 0, instances: 0 },
        }),
      }),
    );
    await page.goto('/creatorbench');
    await expect(page.getByTestId('unevaluated-state')).toContainText(
      'No benchmark performance has been published yet.',
    );
    await expect(page.getByTestId('creatorbench-overview')).toHaveCount(0);
  });

  test('renders unavailable measured metrics without crashing when the real report uses null', async ({
    page,
  }) => {
    const reportWithoutUsableOutputs = {
      ...report,
      metrics: {
        ...report.metrics,
        costUsd: { perUsableOutput: null },
        correctionTimeSeconds: { median: null },
      },
    };
    await page.route('**/benchmarks/creatorbench-v1/results/public-report.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(reportWithoutUsableOutputs),
      }),
    );

    await page.goto('/creatorbench');
    await expect(page.getByRole('heading', { name: /See what works/i })).toBeVisible();
    await expect(page.getByTestId('creatorbench-overview')).toContainText('Not reported');
  });

  test('works in light and dark themes without page-level horizontal overflow', async ({
    page,
  }) => {
    await mockReport(page);
    await page.goto('/creatorbench');
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/u);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(await page.evaluate(() => document.characterSet)).toBe('UTF-8');
  });
});
