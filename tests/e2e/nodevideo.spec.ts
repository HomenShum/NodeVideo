import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import {
  type Locator,
  type Page,
  type Request,
  type Response,
  expect,
  test,
} from 'playwright/test';

const publicSyntheticVideoPath = resolve('fixtures/media/tutorial-compare-v1/source-reference.mp4');
const targetOrigin = new URL(process.env.NODEVIDEO_URL ?? 'http://127.0.0.1:4317').origin;

interface WorkerReceiptPayload {
  schema: string;
  boundary: string;
  disclosure: string;
  worker: { id: string; version: string };
  sourceAssets: Array<{ sourceClass: string }>;
  media: {
    reference: { sha256: string };
    sideBySide: { sha256: string };
    difference: { sha256: string };
  };
  events: Array<{ sequence: number }>;
  validation: { passed: boolean; assertions: unknown[] };
}

interface WorkerResultPayload {
  status: string;
  validation: { verdict: string };
  artifacts: { tutorialComparison: { criticalMoments: unknown[] } };
}

interface VerifiedDemoLoad {
  receipt: WorkerReceiptPayload;
  result: WorkerResultPayload;
}

interface BrowserLedger {
  consoleErrors: string[];
  controlPlaneReads: string[];
  externalRequests: string[];
  pageErrors: string[];
  publicWorkerRequests: string[];
  publicMediaResponses: Array<{ contentType: string; status: number }>;
}

function publicWorkerAsset(pathname: string): boolean {
  return /(receipt|result|reference-normalized|attempt-normalized|comparison-side-by-side|comparison-difference).*(\.json|\.mp4)$/i.test(
    pathname,
  );
}

function publicMediaAsset(pathname: string): boolean {
  return /(reference-normalized|attempt-normalized|comparison-side-by-side|comparison-difference).*\.mp4$/i.test(
    pathname,
  );
}

function isAllowedControlPlaneRequest(request: Request): boolean {
  const url = new URL(request.url());
  if (
    url.protocol !== 'https:' ||
    !/^[a-z0-9-]+\.convex\.cloud$/i.test(url.hostname) ||
    url.pathname !== '/api/query' ||
    request.headers().authorization
  ) {
    return false;
  }
  if (request.method() === 'OPTIONS') {
    const headers = request.headers();
    return headers.origin === targetOrigin && headers['access-control-request-method'] === 'POST';
  }
  if (request.method() !== 'POST') return false;
  try {
    const body = request.postDataJSON() as { format?: unknown; path?: unknown };
    return body.path === 'runtimeSources:list' && body.format === 'convex_encoded_json';
  } catch {
    return false;
  }
}

function observeBrowser(page: Page): BrowserLedger {
  const ledger: BrowserLedger = {
    consoleErrors: [],
    controlPlaneReads: [],
    externalRequests: [],
    pageErrors: [],
    publicWorkerRequests: [],
    publicMediaResponses: [],
  };

  page.on('console', (message) => {
    if (message.type() === 'error') ledger.consoleErrors.push(message.text());
  });

  page.on('pageerror', (error) => ledger.pageErrors.push(error.message));

  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return;
    if (url.origin === targetOrigin) {
      if (publicWorkerAsset(url.pathname)) {
        ledger.publicWorkerRequests.push(url.pathname);
      }
      return;
    }
    if (isAllowedControlPlaneRequest(request)) {
      if (request.method() === 'POST') ledger.controlPlaneReads.push(url.hostname);
      return;
    }

    // Deliberately omit query strings and bodies: a failed assertion must not print a token.
    ledger.externalRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
  });

  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin !== targetOrigin || !publicMediaAsset(url.pathname)) return;
    ledger.publicMediaResponses.push({
      contentType: response.headers()['content-type'] ?? '',
      status: response.status(),
    });
  });

  return ledger;
}

async function openCleanRoot(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  expect(await page.evaluate(() => document.characterSet)).toBe('UTF-8');
}

function waitForPublicAsset(page: Page, marker: string): Promise<Response> {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === targetOrigin && url.pathname.toLowerCase().includes(marker.toLowerCase());
  });
}

async function loadVerifiedDemo(page: Page): Promise<VerifiedDemoLoad> {
  await openCleanRoot(page);

  const receiptResponsePromise = waitForPublicAsset(page, 'receipt');
  const resultResponsePromise = waitForPublicAsset(page, 'result');
  const comparisonResponsePromise = waitForPublicAsset(page, 'comparison-side-by-side');
  const demo = page.getByTestId('demo-load');
  await expect(demo).toBeVisible();
  await expect(demo).toContainText(/verified synthetic worker/i);
  await demo.click();

  const [receiptResponse, resultResponse, comparisonResponse] = await Promise.all([
    receiptResponsePromise,
    resultResponsePromise,
    comparisonResponsePromise,
  ]);
  await expect(page.getByTestId('privacy-badge')).toContainText(/public synthetic worker/i);
  await expect(page.getByTestId('run-plan')).toBeVisible();

  expect(receiptResponse.ok(), 'the deployed worker receipt must load').toBe(true);
  expect(resultResponse.ok(), 'the deployed worker result must load').toBe(true);
  expect(comparisonResponse.ok(), 'the media hashed by the browser must load').toBe(true);
  expect(new URL(receiptResponse.url()).origin).toBe(targetOrigin);
  expect(new URL(resultResponse.url()).origin).toBe(targetOrigin);
  expect(new URL(comparisonResponse.url()).origin).toBe(targetOrigin);
  expect(comparisonResponse.headers()['content-type']).toContain('video/mp4');

  const receipt = (await receiptResponse.json()) as WorkerReceiptPayload;
  const result = (await resultResponse.json()) as WorkerResultPayload;
  const deployedMediaSha256 = createHash('sha256')
    .update(await comparisonResponse.body())
    .digest('hex');

  expect(receipt.schema).toBe('nodevideo.worker-receipt.v1');
  expect(receipt.boundary).toBe('public-worker');
  expect(receipt.disclosure).toMatch(/public synthetic media/i);
  expect(receipt.disclosure).toMatch(/no personal media or model call/i);
  expect(receipt.sourceAssets.length).toBeGreaterThanOrEqual(2);
  expect(receipt.sourceAssets.every((asset) => asset.sourceClass === 'public-fixture')).toBe(true);
  expect(
    receipt.events.every(
      (event, index) => index === 0 || event.sequence > receipt.events[index - 1].sequence,
    ),
  ).toBe(true);
  expect(receipt.validation.passed).toBe(true);
  expect(receipt.validation.assertions).toHaveLength(13);
  expect(result.status).toBe('completed');
  expect(result.validation.verdict).toBe('pass');
  expect(result.artifacts.tutorialComparison.criticalMoments).toHaveLength(3);
  expect(deployedMediaSha256).toBe(receipt.media.sideBySide.sha256);

  return { receipt, result };
}

async function runSyntheticComparison(page: Page): Promise<VerifiedDemoLoad> {
  const verified = await loadVerifiedDemo(page);

  const runPlan = page.getByTestId('run-plan');
  await expect(runPlan).toBeVisible();
  await expect(runPlan).toBeEnabled();
  await runPlan.click();

  await expect(page.getByTestId('stage-list')).toBeVisible();
  await expect(page.getByTestId('trace-panel')).toBeVisible();
  await expect(page.getByTestId('artifact-panel')).toBeVisible();
  await expect(page.getByTestId('proposal-card')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId('accept-proposal')).toBeEnabled();
  return verified;
}

async function showWorkspacePane(page: Page, label: 'Project' | 'Canvas' | 'Inspect') {
  const navigation = page.getByRole('radiogroup', { name: 'Workspace views' });
  if (await navigation.isVisible()) {
    await navigation.getByRole('radio', { name: label }).click();
  }
}

async function expectPublicVideo(
  page: Page,
  view: 'reference' | 'comparison' | 'difference',
  marker: string,
  width: number,
  height: number,
): Promise<string> {
  const video = page.getByLabel(`Worker-produced public ${view} video`);
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((node) => (node as HTMLVideoElement).currentSrc))
    .toContain(marker);
  await expect
    .poll(() =>
      video.evaluate((node) => {
        const media = node as HTMLVideoElement;
        return {
          error: media.error?.code ?? null,
          height: media.videoHeight,
          readyState: media.readyState,
          width: media.videoWidth,
        };
      }),
    )
    .toMatchObject({ error: null, height, width });
  const metadata = await video.evaluate((node) => {
    const media = node as HTMLVideoElement;
    return { currentSrc: media.currentSrc, duration: media.duration, readyState: media.readyState };
  });
  expect(new URL(metadata.currentSrc).origin).toBe(targetOrigin);
  expect(metadata.duration).toBeGreaterThanOrEqual(5.7);
  expect(metadata.readyState).toBeGreaterThanOrEqual(1);
  return metadata.currentSrc;
}

async function sha256FromPage(page: Page, url: string): Promise<string> {
  return page.evaluate(async (source) => {
    const response = await fetch(source, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Public media returned ${response.status}.`);
    const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }, url);
}

function expectCleanLedger(ledger: BrowserLedger) {
  expect(
    ledger.externalRequests,
    'the public synthetic flow must have no cross-origin egress',
  ).toEqual([]);
  expect(ledger.pageErrors, 'the browser must not throw an unhandled error').toEqual([]);
  expect(ledger.consoleErrors, 'the browser console must stay free of errors').toEqual([]);
}

async function expectWithinViewport(page: Page, locator: Locator, label: string) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box, `${label} must have a rendered box`).not.toBeNull();
  expect(viewport, 'the browser project must define a viewport').not.toBeNull();
  expect(box?.x ?? -2, `${label} must not be clipped on the left`).toBeGreaterThanOrEqual(-1);
  expect(
    (box?.x ?? 0) + (box?.width ?? 0),
    `${label} must not be clipped on the right`,
  ).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
}

async function expectNoHorizontalClipping(locator: Locator, label: string) {
  const result = await locator.evaluate((root) => {
    const rootBox = root.getBoundingClientRect();
    const clipped = Array.from(root.querySelectorAll<HTMLElement>('*')).flatMap((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      const isInteractive = element.matches(
        'a, button, input, select, textarea, summary, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])',
      );
      let intentionallyClippedDecoration = false;
      for (let ancestor = element.parentElement; ancestor && ancestor !== root; ) {
        const ancestorStyle = getComputedStyle(ancestor);
        const ancestorBox = ancestor.getBoundingClientRect();
        if (
          !isInteractive &&
          ['hidden', 'clip'].includes(ancestorStyle.overflowX) &&
          ancestorBox.left >= rootBox.left - 1 &&
          ancestorBox.right <= rootBox.right + 1
        ) {
          intentionallyClippedDecoration = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        box.width === 0 ||
        box.height === 0 ||
        intentionallyClippedDecoration ||
        (box.left >= rootBox.left - 1 && box.right <= rootBox.right + 1)
      ) {
        return [];
      }
      return [
        {
          element: element.tagName.toLowerCase(),
          className: typeof element.className === 'string' ? element.className : null,
          slot: element.dataset.slot ?? null,
          testId: element.dataset.testid ?? null,
          left: Math.round(box.left * 10) / 10,
          right: Math.round(box.right * 10) / 10,
          rootLeft: Math.round(rootBox.left * 10) / 10,
          rootRight: Math.round(rootBox.right * 10) / 10,
        },
      ];
    });
    return {
      overflow: root.scrollWidth - root.clientWidth,
      clipped: clipped.slice(0, 10),
    };
  });

  expect(result.overflow, `${label} must not hide horizontal overflow`).toBeLessThanOrEqual(1);
  expect(result.clipped, `${label} descendants must remain horizontally reachable`).toEqual([]);
}

test.describe('NodeVideo public verified-worker release gate', () => {
  test('first run is clean, progressive, and explicit about privacy', async ({ page }) => {
    const ledger = observeBrowser(page);
    await openCleanRoot(page);

    const privacyBadge = page.getByTestId('privacy-badge');
    await expect(privacyBadge).toBeVisible();
    await expect(privacyBadge).toContainText(/local|device|browser/i);

    await expect(page.getByTestId('demo-load')).toBeVisible();
    await expect(page.getByTestId('demo-load')).toContainText(/verified synthetic worker/i);
    await expect(page.getByTestId('local-upload')).toBeVisible();

    const fileInput = page.locator(
      '[data-testid="local-upload"][type="file"], [data-testid="local-upload"] input[type="file"]',
    );
    await expect(fileInput).toHaveCount(1);
    await expect(fileInput).toHaveAttribute('accept', /video/i);

    await expect(page.getByTestId('stage-list')).toHaveCount(0);
    await expect(page.getByTestId('trace-panel')).toHaveCount(0);
    await expect(page.getByTestId('artifact-panel')).toHaveCount(0);
    await expect(page.getByTestId('proposal-card')).toHaveCount(0);
    await expect(page.getByTestId('version-history')).toHaveCount(0);

    expectCleanLedger(ledger);
  });

  test('verified demo stays pending until the deployed worker bundle is checked', async ({
    page,
  }) => {
    const ledger = observeBrowser(page);
    await openCleanRoot(page);

    let releaseVerification = () => {};
    const verificationGate = new Promise<void>((resolveGate) => {
      releaseVerification = resolveGate;
    });
    let heldReceipt = false;
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (
        !heldReceipt &&
        url.origin === targetOrigin &&
        url.pathname.toLowerCase().includes('receipt') &&
        url.pathname.toLowerCase().endsWith('.json')
      ) {
        heldReceipt = true;
        await verificationGate;
      }
      await route.continue();
    });

    const receiptRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.origin === targetOrigin &&
        url.pathname.toLowerCase().includes('receipt') &&
        url.pathname.toLowerCase().endsWith('.json')
      );
    });
    const demo = page.getByTestId('demo-load');
    await demo.click();

    try {
      await receiptRequest;
      await expect(demo).toBeDisabled();
      await expect(demo).toContainText(/verifying worker proof/i);
      await expect(page.getByTestId('privacy-badge')).toContainText(/local to this browser/i);
      await expect(page.getByTestId('stage-list')).toHaveCount(0);
      await expect(page.getByTestId('artifact-panel')).toHaveCount(0);
    } finally {
      releaseVerification();
    }

    await expect(page.getByTestId('run-plan')).toBeVisible();
    await expect(page.getByTestId('privacy-badge')).toContainText(/public synthetic worker/i);
    await expect
      .poll(() => ledger.publicWorkerRequests)
      .toEqual(
        expect.arrayContaining([
          expect.stringMatching(/receipt.*\.json$/i),
          expect.stringMatching(/result.*\.json$/i),
          expect.stringMatching(/comparison-side-by-side.*\.mp4$/i),
        ]),
      );
    expectCleanLedger(ledger);
  });

  test('tampered comparison media fails closed with a retryable first-run error', async ({
    page,
  }) => {
    const ledger = observeBrowser(page);
    await openCleanRoot(page);

    let tampered = false;
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (
        !tampered &&
        url.origin === targetOrigin &&
        url.pathname.toLowerCase().includes('comparison-side-by-side') &&
        url.pathname.toLowerCase().endsWith('.mp4')
      ) {
        tampered = true;
        await route.fulfill({
          body: 'tampered-public-synthetic-fixture',
          contentType: 'video/mp4',
          status: 200,
        });
        return;
      }
      await route.continue();
    });

    const demo = page.getByTestId('demo-load');
    await demo.click();
    const error = page.getByRole('alert');
    await expect(error).toBeVisible();
    await expect(error).toContainText(/did not match its deployed media and result/i);
    await expect(error).toContainText(/retry/i);
    await expect(demo).toBeEnabled();
    await expect(demo).toContainText(/load verified synthetic worker demo/i);
    await expect(page.getByTestId('privacy-badge')).toContainText(/local to this browser/i);
    await expect(page.getByTestId('run-plan')).toHaveCount(0);
    await expect(page.getByTestId('stage-list')).toHaveCount(0);
    await expect(page.getByTestId('artifact-panel')).toHaveCount(0);
    await expect(page.getByTestId('proposal-card')).toHaveCount(0);
    await expect(page.getByTestId('version-history')).toHaveCount(0);
    expect(tampered).toBe(true);
    expectCleanLedger(ledger);
  });

  test('comparison and difference are distinct verified same-origin media', async ({ page }) => {
    const ledger = observeBrowser(page);
    const { receipt } = await loadVerifiedDemo(page);

    const comparisonSrc = await expectPublicVideo(
      page,
      'comparison',
      'comparison-side-by-side',
      720,
      640,
    );
    expect(await sha256FromPage(page, comparisonSrc)).toBe(receipt.media.sideBySide.sha256);

    const differenceResponsePromise = waitForPublicAsset(page, 'comparison-difference');
    await page.getByRole('radio', { name: 'Show difference' }).click();
    const differenceResponse = await differenceResponsePromise;
    expect([200, 206]).toContain(differenceResponse.status());
    expect(differenceResponse.headers()['content-type']).toContain('video/mp4');
    expect(new URL(differenceResponse.url()).origin).toBe(targetOrigin);
    const differenceSrc = await expectPublicVideo(
      page,
      'difference',
      'comparison-difference',
      360,
      640,
    );
    expect(differenceSrc).not.toBe(comparisonSrc);
    expect(await sha256FromPage(page, differenceSrc)).toBe(receipt.media.difference.sha256);

    const referenceResponsePromise = waitForPublicAsset(page, 'reference-normalized');
    await page.getByRole('radio', { name: 'Show reference' }).click();
    const referenceResponse = await referenceResponsePromise;
    expect([200, 206]).toContain(referenceResponse.status());
    expect(referenceResponse.headers()['content-type']).toContain('video/mp4');
    const referenceSrc = await expectPublicVideo(
      page,
      'reference',
      'reference-normalized',
      360,
      640,
    );
    expect(referenceSrc).not.toBe(comparisonSrc);
    expect(referenceSrc).not.toBe(differenceSrc);
    expect(await sha256FromPage(page, referenceSrc)).toBe(receipt.media.reference.sha256);

    expect(ledger.publicMediaResponses.length).toBeGreaterThanOrEqual(3);
    expect(
      ledger.publicMediaResponses.every(
        (response) =>
          [200, 206].includes(response.status) && response.contentType.includes('video/mp4'),
      ),
    ).toBe(true);
    expectCleanLedger(ledger);
  });

  test('worker comparison exposes deterministic provenance before mutation', async ({ page }) => {
    const ledger = observeBrowser(page);
    const { receipt, result } = await runSyntheticComparison(page);

    await expect(page.getByTestId('stage-list')).toContainText(/complete|review/i);
    await expect(page.getByTestId('artifact-panel')).toContainText(receipt.worker.version);
    await expect(page.getByTestId('artifact-panel')).toContainText(/public-worker/i);
    await expect(page.getByTestId('artifact-panel')).toContainText(/worker-backed/i);
    await expect(page.getByTestId('worker-tool-card')).toContainText(
      new RegExp(`${receipt.validation.assertions.length} checks`, 'i'),
    );
    await expect(page.getByTestId('trace-panel')).toContainText(/complete|ok|review/i);
    await expect(page.getByTestId('trace-panel')).toContainText(/tutorial_compare/i);
    expect(receipt.worker.id).toBe('nodevideo.tutorial-compare');
    expect(receipt.boundary).toBe('public-worker');
    expect(result.artifacts.tutorialComparison.criticalMoments).toHaveLength(3);

    await showWorkspacePane(page, 'Canvas');
    await expect(page.getByText(/real worker run, synthetic source media/i)).toBeVisible();
    await expect(page.getByText(/not general human-pose accuracy/i)).toBeVisible();
    await expect(page.getByTestId('privacy-badge')).toContainText(/public synthetic worker/i);
    await showWorkspacePane(page, 'Inspect');

    const versionHistory = page.getByTestId('version-history');
    await expect(versionHistory).toBeVisible();
    const beforeAcceptance = (await versionHistory.innerText()).trim();

    await page.getByTestId('accept-proposal').click();

    await expect
      .poll(async () => (await versionHistory.innerText()).trim(), {
        message: 'accepting the proposal must append a recipe version',
      })
      .not.toBe(beforeAcceptance);
    await expect(versionHistory).toContainText(/version\s*2|v2/i);

    expectCleanLedger(ledger);
  });

  test('proposal acceptance is idempotent and survives reload', async ({ page }) => {
    const ledger = observeBrowser(page);
    await runSyntheticComparison(page);

    await page.getByTestId('accept-proposal').evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });

    const versionHistory = page.getByTestId('version-history');
    await expect(versionHistory).toContainText(/version\s*2|v2/i);
    await expect(versionHistory).not.toContainText(/version\s*3|v3/i);
    const acceptedHistory = (await versionHistory.innerText()).trim();

    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('version-history')).toBeVisible();
    await expect
      .poll(async () => (await page.getByTestId('version-history').innerText()).trim(), {
        message: 'the accepted version must be restored from the local checkpoint',
      })
      .toBe(acceptedHistory);

    expectCleanLedger(ledger);
  });

  test('verified worker review has no serious accessibility violations', async ({ page }) => {
    const ledger = observeBrowser(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await runSyntheticComparison(page);

    await expectWithinViewport(
      page,
      page.getByRole('button', { name: 'Download run receipt' }),
      'receipt action',
    );
    const workspaceNavigation = page.getByRole('radiogroup', { name: 'Workspace views' });
    const usesPaneNavigation = (page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) < 1280;
    if (usesPaneNavigation) await expect(workspaceNavigation).toBeVisible();
    const panes = [
      ['Project', page.locator('aside[aria-label="Project sources and pipeline"]')],
      ['Canvas', page.locator('section[aria-label="Video workbench"]')],
      ['Inspect', page.locator('aside[aria-label="Evidence inspector"]')],
    ] as const;
    for (const [label, pane] of panes) {
      if (usesPaneNavigation) await workspaceNavigation.getByRole('radio', { name: label }).click();
      await expect(pane).toBeVisible();
      await expectWithinViewport(page, pane, `${label} pane`);
      await expectNoHorizontalClipping(pane, `${label} pane`);
    }

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const releaseBlocking = results.violations
      .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.map((node) => ({
          failure: node.failureSummary,
          html: node.html,
          target: node.target,
        })),
      }));

    expect(releaseBlocking).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      'the active workspace must not overflow horizontally',
    ).toBeLessThanOrEqual(1);
    expectCleanLedger(ledger);
  });

  test('narrow mobile worker panes keep every control reachable without overflow', async ({
    page,
  }) => {
    test.skip(
      (page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) > 390,
      'covered by the mobile and compact-mobile projects',
    );
    const ledger = observeBrowser(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await runSyntheticComparison(page);

    const navigation = page.getByRole('radiogroup', { name: 'Workspace views' });
    await expect(navigation).toBeVisible();
    await expectWithinViewport(page, navigation, 'mobile workspace navigation');
    await expectNoHorizontalClipping(navigation, 'mobile workspace navigation');

    const panes = [
      ['Project', page.locator('aside[aria-label="Project sources and pipeline"]')],
      ['Canvas', page.locator('section[aria-label="Video workbench"]')],
      ['Inspect', page.locator('aside[aria-label="Evidence inspector"]')],
    ] as const;
    for (const [label, pane] of panes) {
      await navigation.getByRole('radio', { name: label }).click();
      await expect(pane).toBeVisible();
      await expectWithinViewport(page, pane, `${label} mobile pane`);
      await expectNoHorizontalClipping(pane, `${label} mobile pane`);
      if (label === 'Canvas') {
        await expectWithinViewport(
          page,
          page.getByRole('radiogroup', { name: 'Comparison view' }),
          'mobile comparison switcher',
        );
        await expectWithinViewport(page, page.getByTestId('run-plan'), 'mobile replay action');
      }
      if (label === 'Inspect') {
        await expectWithinViewport(page, page.getByTestId('proposal-card'), 'mobile review card');
      }
    }

    await expectWithinViewport(
      page,
      page.getByRole('button', { name: 'Download run receipt' }),
      'mobile receipt action',
    );
    await expectNoHorizontalClipping(page.getByTestId('app-shell'), 'mobile app shell');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      'the narrow document must not overflow horizontally',
    ).toBeLessThanOrEqual(1);
    expectCleanLedger(ledger);
  });

  test('keyboard activation reaches the review decision', async ({ page }) => {
    const ledger = observeBrowser(page);
    await openCleanRoot(page);

    const demo = page.getByTestId('demo-load');
    await demo.focus();
    await expect(demo).toBeFocused();
    await page.keyboard.press('Enter');

    const runPlan = page.getByTestId('run-plan');
    await runPlan.focus();
    await expect(runPlan).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('proposal-card')).toBeVisible();

    const accept = page.getByTestId('accept-proposal');
    await accept.focus();
    await expect(accept).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('version-history')).toContainText(/version\s*2|v2/i);

    expectCleanLedger(ledger);
  });

  test('local video preview stays on-device and expires honestly on reload', async ({ page }) => {
    const ledger = observeBrowser(page);
    await openCleanRoot(page);

    const fileInput = page.locator(
      '[data-testid="local-upload"][type="file"], [data-testid="local-upload"] input[type="file"]',
    );
    await fileInput.setInputFiles(publicSyntheticVideoPath);

    await expect(page.getByTestId('privacy-badge')).toContainText(/local|browser|device/i);
    await expect(page.locator('video')).toBeVisible();
    await expect(page.getByText(/no upload occurred/i)).toBeVisible();
    await expect(page.getByTestId('stage-list')).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId('demo-load')).toBeVisible();
    await expect(page.locator('video')).toHaveCount(0);

    expectCleanLedger(ledger);
  });
});
