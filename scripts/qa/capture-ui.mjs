import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const baseURL = process.env.NODEVIDEO_URL ?? 'http://127.0.0.1:4318/';
const targetOrigin = new URL(baseURL).origin;
const runId = process.env.NODEVIDEO_QA_RUN_ID ?? new Date().toISOString().replaceAll(/[:.]/g, '-');
const outputRoot = join(repoRoot, '.qa', 'evidence', 'public', runId);

await mkdir(outputRoot, { recursive: true });

const browser = await chromium.launch({ headless: true });
const scenarios = [
  { name: 'desktop', viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 },
  { name: 'xl-boundary', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  { name: 'tablet', viewport: { width: 834, height: 1112 }, deviceScaleFactor: 1 },
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
  { name: 'compact-phone', viewport: { width: 320, height: 568 }, deviceScaleFactor: 2 },
];
const report = {
  schema: 'nodevideo.ui-capture.v1',
  baseURL,
  runId,
  createdAt: new Date().toISOString(),
  scenarios: [],
};

try {
  for (const scenario of scenarios) {
    const context = await browser.newContext({
      viewport: scenario.viewport,
      deviceScaleFactor: scenario.deviceScaleFactor,
      colorScheme: 'dark',
      locale: 'en-US',
      timezoneId: 'America/Los_Angeles',
    });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const externalRequests = [];
    const controlPlaneRequests = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.hostname.endsWith('.convex.cloud')) {
        controlPlaneRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
        return;
      }
      if (url.origin !== targetOrigin && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
        externalRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      }
    });

    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('app-shell').waitFor();
    await page.screenshot({
      path: join(outputRoot, `${scenario.name}-01-first-run.png`),
      fullPage: true,
    });

    await page.getByTestId('demo-load').click();
    await page.getByTestId('run-plan').waitFor({ state: 'visible' });
    await page.screenshot({
      path: join(outputRoot, `${scenario.name}-02-demo-loaded.png`),
      fullPage: true,
    });

    await page.getByTestId('run-plan').click();
    await page.getByTestId('proposal-card').waitFor({ state: 'visible' });
    await page.screenshot({
      path: join(outputRoot, `${scenario.name}-03-proof-review.png`),
      fullPage: true,
    });

    await page.getByTestId('accept-proposal').click();
    await page
      .getByTestId('version-history')
      .getByText(/version 2/i)
      .waitFor();
    await page.screenshot({
      path: join(outputRoot, `${scenario.name}-04-accepted.png`),
      fullPage: true,
    });

    report.scenarios.push({
      name: scenario.name,
      viewport: scenario.viewport,
      consoleErrors,
      pageErrors,
      externalRequests,
      controlPlaneRequests,
      passed:
        consoleErrors.length === 0 && pageErrors.length === 0 && externalRequests.length === 0,
    });
    await context.close();
  }
} finally {
  await browser.close();
}

report.passed = report.scenarios.every((scenario) => scenario.passed);
await writeFile(
  join(outputRoot, 'capture-report.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
);

if (!report.passed) {
  throw new Error(`UI capture recorded a failure: ${JSON.stringify(report.scenarios)}`);
}

console.log(outputRoot);
