import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const baseURL = process.env.NODEVIDEO_URL ?? 'http://127.0.0.1:4318/';
const targetOrigin = new URL(baseURL).origin;
const runId = process.env.NODEVIDEO_QA_RUN_ID ?? new Date().toISOString().replaceAll(/[:.]/g, '-');
const outputRoot = join(repoRoot, '.qa', 'evidence', 'public', runId);
const integrityPattern = /6\/6.*sha-256/i;

const scenarios = [
  { name: 'desktop', viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 },
  { name: 'xl', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  { name: 'tablet', viewport: { width: 834, height: 1112 }, deviceScaleFactor: 1 },
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
  { name: 'compact', viewport: { width: 320, height: 568 }, deviceScaleFactor: 2 },
];

const keyTestIds = [
  'app-shell',
  'case-consent',
  'target-usage',
  'real-case-load',
  'asset-integrity',
  'quality-summary',
  'metric-ssim',
  'metric-psnr',
  'real-case-receipt',
];

await mkdir(outputRoot, { recursive: true });

const report = {
  schema: 'nodevideo.ui-capture.v2',
  baseURL,
  runId,
  createdAt: new Date().toISOString(),
  outputRoot,
  scenarios: [],
};

const browser = await chromium.launch({ headless: true });
try {
  for (const scenario of scenarios) {
    const context = await browser.newContext({
      viewport: scenario.viewport,
      deviceScaleFactor: scenario.deviceScaleFactor,
      colorScheme: 'dark',
      locale: 'en-US',
      reducedMotion: 'reduce',
      timezoneId: 'America/Los_Angeles',
    });
    const page = await context.newPage();
    const scenarioReport = {
      name: scenario.name,
      viewport: scenario.viewport,
      deviceScaleFactor: scenario.deviceScaleFactor,
      screenshots: [],
      states: [],
      consoleErrors: [],
      pageErrors: [],
      requestErrors: { failed: [], http: [] },
      externalRequests: [],
      controlPlaneRequests: [],
      journeyError: null,
      passed: false,
    };
    observePage(page, scenarioReport);

    try {
      await page.goto(baseURL, { waitUntil: 'networkidle' });
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByTestId('app-shell').waitFor();
      await page.getByTestId('case-consent').waitFor();
      await page.getByTestId('real-case-load').waitFor();
      await captureState(page, scenarioReport, 'initial-consent-load', 1);

      await page.getByTestId('real-case-load').click();
      await page
        .getByTestId('asset-integrity')
        .filter({ hasText: integrityPattern })
        .waitFor({ timeout: 120_000 });
      await waitForVideo(page, {
        height: 640,
        path: '/media/authorized-real-v1/comparison-side-by-side.mp4',
        width: 720,
      });
      await captureState(page, scenarioReport, 'verified-side-by-side', 2);

      await chooseView(page, 'Reconstruction');
      await waitForVideo(page, {
        height: 1280,
        path: '/media/authorized-real-v1/reconstruction.mp4',
        width: 720,
      });
      await captureState(page, scenarioReport, 'reconstruction', 3);

      const traceButton = page.getByRole('button', { name: /recorded worker trace/i });
      await traceButton.waitFor({ state: 'visible' });
      if ((await traceButton.getAttribute('aria-expanded')) !== 'true') {
        await traceButton.click();
      }
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('button')].some(
          (button) =>
            /recorded worker trace/i.test(button.textContent ?? '') &&
            button.getAttribute('aria-expanded') === 'true',
        );
      });
      await page.getByTestId('asset-integrity').waitFor({ state: 'visible' });
      await page.locator('[data-observability-primitives="assistant-ui-react-o11y"]').waitFor({
        state: 'visible',
      });
      await traceButton.scrollIntoViewIfNeeded();
      await captureState(page, scenarioReport, 'recorded-worker-trace', 4);
    } catch (error) {
      scenarioReport.journeyError = error instanceof Error ? error.message : String(error);
    } finally {
      scenarioReport.passed = scenarioPassed(scenarioReport);
      report.scenarios.push(scenarioReport);
      await context.close();
    }
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
  throw new Error(
    `UI capture recorded a failure. Inspect ${join(outputRoot, 'capture-report.json')}`,
  );
}

console.log(outputRoot);

function observePage(page, scenarioReport) {
  page.on('console', (message) => {
    if (message.type() === 'error') scenarioReport.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => scenarioReport.pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'unknown request failure';
    if (!/ERR_ABORTED/i.test(failure)) {
      scenarioReport.requestErrors.failed.push(`${request.method()} ${request.url()} · ${failure}`);
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      scenarioReport.requestErrors.http.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === targetOrigin) return;
    const summary = `${request.method()} ${url.origin}${url.pathname}`;
    if (url.hostname.endsWith('.convex.cloud')) {
      scenarioReport.controlPlaneRequests.push(summary);
    } else {
      scenarioReport.externalRequests.push(summary);
    }
  });
}

async function chooseView(page, option) {
  const select = page.getByRole('combobox', { name: 'Comparison view' });
  await select.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await select.filter({ hasText: option }).waitFor();
}

async function waitForVideo(page, expected) {
  const video = page.locator('video:visible').first();
  await video.waitFor({ state: 'visible' });
  await page.waitForFunction(
    ({ height, path, width }) => {
      const candidate = [...document.querySelectorAll('video')].find((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      });
      if (!(candidate instanceof HTMLVideoElement) || !candidate.currentSrc) return false;
      return (
        new URL(candidate.currentSrc).pathname === path &&
        candidate.readyState >= HTMLMediaElement.HAVE_METADATA &&
        candidate.error === null &&
        candidate.videoWidth === width &&
        candidate.videoHeight === height
      );
    },
    expected,
    { timeout: 30_000 },
  );
}

async function captureState(page, scenarioReport, stateName, index) {
  const screenshotName = `${scenarioReport.name}-${String(index).padStart(2, '0')}-${stateName}.png`;
  await page.screenshot({ path: join(outputRoot, screenshotName), fullPage: true });
  const [documentOverflow, keySelectors, video, claims, trace] = await Promise.all([
    readDocumentOverflow(page),
    readKeySelectors(page),
    readVideo(page),
    readClaims(page),
    readTrace(page),
  ]);
  scenarioReport.screenshots.push(screenshotName);
  scenarioReport.states.push({
    name: stateName,
    screenshot: screenshotName,
    documentOverflow,
    keySelectors,
    claims,
    video,
    trace,
  });
}

async function readDocumentOverflow(page) {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const documentWidth = document.documentElement.scrollWidth;
    const bodyWidth = document.body.scrollWidth;
    const offenders = [...document.querySelectorAll('*')]
      .flatMap((element) => {
        if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return [];
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          box.width === 0 ||
          (box.left >= -1 && box.right <= viewportWidth + 1)
        ) {
          return [];
        }
        return [
          {
            selector:
              element.getAttribute('data-testid') ??
              element.getAttribute('aria-label') ??
              element.id ??
              element.tagName.toLowerCase(),
            left: Math.round(box.left * 100) / 100,
            right: Math.round(box.right * 100) / 100,
            width: Math.round(box.width * 100) / 100,
          },
        ];
      })
      .slice(0, 20);
    return {
      viewportWidth,
      documentWidth,
      bodyWidth,
      horizontalOverflowPx: Math.max(0, documentWidth - viewportWidth, bodyWidth - viewportWidth),
      offenders,
    };
  });
}

async function readKeySelectors(page) {
  return page.evaluate((testIds) => {
    return Object.fromEntries(
      testIds.map((testId) => {
        const element = document.querySelector(`[data-testid="${testId}"]`);
        const box = element?.getBoundingClientRect();
        const style = element ? getComputedStyle(element) : undefined;
        return [
          testId,
          {
            present: Boolean(element),
            visible: Boolean(
              element &&
                box &&
                box.width > 0 &&
                box.height > 0 &&
                style?.display !== 'none' &&
                style?.visibility !== 'hidden',
            ),
            text: element?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
          },
        ];
      }),
    );
  }, keyTestIds);
}

async function readClaims(page) {
  return page.evaluate(() => {
    const text = (testId) =>
      document
        .querySelector(`[data-testid="${testId}"]`)
        ?.textContent?.replace(/\s+/g, ' ')
        .trim() ?? null;
    return {
      consent: text('case-consent'),
      targetUsage: text('target-usage'),
      integrity: text('asset-integrity'),
      qualitySummary: text('quality-summary'),
      ssim: text('metric-ssim'),
      psnr: text('metric-psnr'),
    };
  });
}

async function readVideo(page) {
  const video = page.locator('video:visible').first();
  if ((await video.count()) === 0) return null;
  return video.evaluate((element) => {
    const media = element;
    const box = media.getBoundingClientRect();
    return {
      currentSrc: media.currentSrc || null,
      duration: Number.isFinite(media.duration) ? media.duration : null,
      readyState: media.readyState,
      errorCode: media.error?.code ?? null,
      intrinsicWidth: media.videoWidth,
      intrinsicHeight: media.videoHeight,
      renderedWidth: Math.round(box.width * 100) / 100,
      renderedHeight: Math.round(box.height * 100) / 100,
    };
  });
}

async function readTrace(page) {
  return page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) =>
      /recorded worker trace/i.test(candidate.textContent ?? ''),
    );
    const trace = document.querySelector(
      '[data-observability-primitives="assistant-ui-react-o11y"]',
    );
    return {
      present: Boolean(button),
      open: button?.getAttribute('aria-expanded') === 'true',
      visible: Boolean(trace && trace.getBoundingClientRect().height > 0),
      spanCount: trace?.querySelectorAll('[aria-label]').length ?? 0,
      title: button?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    };
  });
}

function scenarioPassed(scenario) {
  const initial = scenario.states.find((state) => state.name === 'initial-consent-load');
  const sideBySide = scenario.states.find((state) => state.name === 'verified-side-by-side');
  const reconstruction = scenario.states.find((state) => state.name === 'reconstruction');
  const trace = scenario.states.find((state) => state.name === 'recorded-worker-trace');
  return (
    scenario.journeyError === null &&
    scenario.states.length === 4 &&
    scenario.screenshots.length === 4 &&
    scenario.consoleErrors.length === 0 &&
    scenario.pageErrors.length === 0 &&
    scenario.requestErrors.failed.length === 0 &&
    scenario.requestErrors.http.length === 0 &&
    scenario.externalRequests.length === 0 &&
    scenario.states.every((state) => state.documentOverflow.horizontalOverflowPx <= 1) &&
    initial?.keySelectors['case-consent']?.visible === true &&
    initial?.keySelectors['real-case-load']?.visible === true &&
    integrityPattern.test(sideBySide?.claims.integrity ?? '') &&
    sideBySide?.video?.intrinsicWidth === 720 &&
    sideBySide?.video?.intrinsicHeight === 640 &&
    reconstruction?.video?.intrinsicWidth === 720 &&
    reconstruction?.video?.intrinsicHeight === 1280 &&
    trace?.trace.open === true &&
    trace.trace.visible === true &&
    trace.trace.spanCount === 7
  );
}
