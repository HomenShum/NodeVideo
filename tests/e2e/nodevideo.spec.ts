import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from 'playwright/test';

const caseBase = '/media/authorized-real-v1';
const targetOrigin = new URL(process.env.NODEVIDEO_URL ?? 'http://127.0.0.1:4317').origin;
const bundlePaths = {
  manifest: `${caseBase}/case-manifest.json`,
  result: `${caseBase}/result.json`,
  receipt: `${caseBase}/receipt.json`,
  adjudication: `${caseBase}/adjudication-v2.json`,
} as const;
const views = [
  { option: 'Target', path: `${caseBase}/target-web.mp4`, width: 360, height: 640 },
  {
    option: 'Reconstruction',
    path: `${caseBase}/reconstruction.mp4`,
    width: 720,
    height: 1280,
  },
  {
    option: 'Side-by-side',
    path: `${caseBase}/comparison-side-by-side.mp4`,
    width: 720,
    height: 640,
  },
  {
    option: 'Difference',
    path: `${caseBase}/comparison-difference.mp4`,
    width: 360,
    height: 640,
  },
  { option: 'Source A', path: `${caseBase}/source-a-web.mp4`, width: 640, height: 360 },
  { option: 'Source B', path: `${caseBase}/source-b-web.mp4`, width: 640, height: 360 },
] as const;

const v2CaseBase = '/media/authorized-real-v2';
const v2ManifestSha256 = '04f02098045273f5acf587bbbe177cd25664d474c68e32691b4ab8de45060cd2';
const v2Views = [
  {
    option: 'Corrected reconstruction',
    path: `${v2CaseBase}/corrected.mp4`,
    width: 720,
    height: 1280,
  },
  { option: 'Final target edit', path: `${caseBase}/target-web.mp4`, width: 360, height: 640 },
  {
    option: 'Target | corrected',
    path: `${v2CaseBase}/side-by-side.mp4`,
    width: 720,
    height: 640,
  },
  { option: 'Source A', path: `${caseBase}/source-a-web.mp4`, width: 640, height: 360 },
  { option: 'Source B', path: `${caseBase}/source-b-web.mp4`, width: 640, height: 360 },
] as const;

interface BrowserLedger {
  caseResponses: Array<{ contentType: string; path: string; status: number }>;
  consoleErrors: string[];
  crossOriginRequests: string[];
  pageErrors: string[];
  requestFailures: string[];
}

function observeBrowser(page: Page): BrowserLedger {
  const ledger: BrowserLedger = {
    caseResponses: [],
    consoleErrors: [],
    crossOriginRequests: [],
    pageErrors: [],
    requestFailures: [],
  };

  page.on('console', (message) => {
    if (message.type() === 'error') ledger.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => ledger.pageErrors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== targetOrigin) {
      ledger.crossOriginRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
    }
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'unknown';
    if (!/ERR_ABORTED/i.test(failure)) {
      ledger.requestFailures.push(`${new URL(request.url()).pathname}: ${failure}`);
    }
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === targetOrigin && url.pathname.startsWith('/media/authorized-real-v')) {
      ledger.caseResponses.push({
        contentType: response.headers()['content-type'] ?? '',
        path: url.pathname,
        status: response.status(),
      });
    }
  });
  return ledger;
}

async function openCleanCase(page: Page) {
  await page.goto('/');
  expect(new URL(page.url()).search).toBe('');
  expect(await page.evaluate(() => document.characterSet)).toBe('UTF-8');
  await expect(page.getByTestId('v2-proof-panel')).toBeVisible();
  const history = page.getByTestId('v1-history-trigger');
  await expect(history).toHaveAttribute('aria-expanded', 'false');
  await history.click();
  await expect(history).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('real-case-load')).toBeVisible();
  await expect(page.getByTestId('case-consent')).toBeVisible();
}

async function loadVerifiedCase(page: Page, keyboard = false) {
  const load = page.getByTestId('real-case-load');
  if (keyboard) {
    await load.focus();
    await expect(load).toBeFocused();
    await page.keyboard.press('Enter');
  } else {
    await load.click();
  }
  await expect(page.getByTestId('asset-integrity')).toContainText(/6\/6.*sha-256/i, {
    timeout: 90_000,
  });
  await expect(load).toBeEnabled();
  await expect(load).toContainText(/verify case again/i);
}

async function expectCurrentVideo(page: Page, expected: (typeof views)[number]): Promise<string> {
  const video = page
    .getByLabel('Owner-authorized real-media reconstruction', { exact: true })
    .locator('video:visible');
  await expect(video).toHaveCount(1);
  await expect
    .poll(() => video.evaluate((node) => (node as HTMLVideoElement).currentSrc))
    .toContain(expected.path);
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
    .toMatchObject({
      error: null,
      height: expected.height,
      readyState: expect.any(Number),
      width: expected.width,
    });
  const media = await video.evaluate((node) => {
    const element = node as HTMLVideoElement;
    return { duration: element.duration, readyState: element.readyState, src: element.currentSrc };
  });
  expect(media.readyState).toBeGreaterThanOrEqual(1);
  expect(media.duration).toBeGreaterThan(40);
  expect(new URL(media.src).origin).toBe(targetOrigin);
  return media.src;
}

async function chooseView(page: Page, option: (typeof views)[number]['option']) {
  const select = page.getByRole('combobox', { name: 'Comparison view', exact: true });
  await select.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(select).toContainText(option);
}

async function waitForVerifiedV2(page: Page) {
  await expect(page.getByTestId('v2-integrity')).toContainText(
    /15 proof assets.*sha-256 verified/i,
    {
      timeout: 90_000,
    },
  );
  await expect(page.getByTestId('v2-verdict')).toContainText(
    /measured reconstruction gates passed/i,
  );
}

async function chooseV2View(page: Page, option: (typeof v2Views)[number]['option']) {
  const select = page.getByRole('combobox', { name: 'V2 comparison view', exact: true });
  await select.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(select).toContainText(option);
}

async function expectCurrentV2Video(
  page: Page,
  expected: (typeof v2Views)[number],
): Promise<string> {
  const video = page.getByLabel(`${expected.option} video`, { exact: true });
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((node) => (node as HTMLVideoElement).currentSrc))
    .toContain(expected.path);
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
    .toMatchObject({
      error: null,
      height: expected.height,
      readyState: expect.any(Number),
      width: expected.width,
    });
  const media = await video.evaluate((node) => {
    const element = node as HTMLVideoElement;
    return { duration: element.duration, readyState: element.readyState, src: element.currentSrc };
  });
  expect(media.readyState).toBeGreaterThanOrEqual(1);
  expect(media.duration).toBeGreaterThan(40);
  expect(new URL(media.src).origin).toBe(targetOrigin);
  return media.src;
}

async function verifyV2BundleIndependently(page: Page) {
  return page.evaluate(
    async ({ expectedManifestSha256, manifestPath }) => {
      const fetchBytes = async (path: string) => {
        const url = new URL(path, location.href);
        if (url.origin !== location.origin) throw new Error(`${path} is not same-origin.`);
        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`${path} returned ${response.status}.`);
        return {
          bytes: await response.arrayBuffer(),
          contentType: response.headers.get('content-type') ?? '',
        };
      };
      const digest = async (bytes: ArrayBuffer) => {
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      };
      const decode = (bytes: ArrayBuffer) => JSON.parse(new TextDecoder().decode(bytes));

      const manifestResponse = await fetchBytes(manifestPath);
      const manifestHash = await digest(manifestResponse.bytes);
      if (manifestHash !== expectedManifestSha256) throw new Error('Untrusted V2 manifest.');
      const manifest = decode(manifestResponse.bytes);
      const declared = [
        ...manifest.views,
        ...manifest.artifacts,
        { id: 'receipt', sha256: manifest.receiptSha256, url: manifest.receiptUrl },
      ];
      const decodedArtifacts = new Map<string, unknown>();
      for (const asset of declared) {
        const response = await fetchBytes(asset.url);
        if ((await digest(response.bytes)) !== asset.sha256) {
          throw new Error(`${asset.id} failed independent hashing.`);
        }
        if (asset.url.endsWith('.json')) decodedArtifacts.set(asset.id, decode(response.bytes));
      }
      const metrics = decodedArtifacts.get('render-metrics') as {
        audio: { referenceCorrelation: number; sourceLeakageCorrelation: number };
        global: { vmaf: number };
      };
      const events = decodedArtifacts.get('event-score-report') as {
        releaseReady: boolean;
        summary: { failed: number; passed: number; total: number };
      };
      return {
        assetCount: declared.length,
        eventSummary: events.summary,
        manifestHash,
        referenceCorrelation: metrics.audio.referenceCorrelation,
        permanentWindowPassed: manifest.permanentWindow.passed,
        releaseReady: events.releaseReady,
        sourceAudioMuted: manifest.soundtrack.sourceAudioMuted,
        sourceLeakage: metrics.audio.sourceLeakageCorrelation,
        textCueCount: manifest.textSummary.cueCount,
        vmaf: metrics.global.vmaf,
      };
    },
    {
      expectedManifestSha256: v2ManifestSha256,
      manifestPath: `${v2CaseBase}/manifest.json`,
    },
  );
}

async function verifyBundleIndependently(page: Page) {
  return page.evaluate(
    async ({ jsonPaths, mediaPaths }) => {
      const fetchBytes = async (path: string) => {
        const url = new URL(path, location.href);
        if (url.origin !== location.origin) throw new Error(`${path} is not same-origin.`);
        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`${path} returned ${response.status}.`);
        return {
          bytes: await response.arrayBuffer(),
          contentType: response.headers.get('content-type') ?? '',
          status: response.status,
        };
      };
      const digest = async (bytes: ArrayBuffer) => {
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      };
      const decode = (bytes: ArrayBuffer) => JSON.parse(new TextDecoder().decode(bytes));

      const [manifestResponse, resultResponse, receiptResponse, adjudicationResponse] =
        await Promise.all([
          fetchBytes(jsonPaths.manifest),
          fetchBytes(jsonPaths.result),
          fetchBytes(jsonPaths.receipt),
          fetchBytes(jsonPaths.adjudication),
        ]);
      const manifest = decode(manifestResponse.bytes);
      const result = decode(resultResponse.bytes);
      const receipt = decode(receiptResponse.bytes);
      const adjudication = decode(adjudicationResponse.bytes);
      const viewHashes: string[] = [];
      for (const path of mediaPaths) {
        const media = await fetchBytes(path);
        if (!media.contentType.includes('video/mp4')) {
          throw new Error(`${path} was served as ${media.contentType}.`);
        }
        const declared = manifest.views.find((view: { path: string }) => path.endsWith(view.path));
        if (!declared) throw new Error(`${path} is absent from the case manifest.`);
        const actual = await digest(media.bytes);
        if (actual !== declared.sha256) throw new Error(`${path} failed independent hashing.`);
        viewHashes.push(actual);
      }
      const resultHash = await digest(resultResponse.bytes);
      return {
        authorization: manifest.authorization.status,
        jsonContentTypes: [
          manifestResponse.contentType,
          resultResponse.contentType,
          receiptResponse.contentType,
          adjudicationResponse.contentType,
        ],
        adjudication: adjudication.status,
        renderInputs: result.renderSourceAssetIds,
        resultHashMatches: resultHash === receipt.result.sha256,
        targetUsage: receipt.lineage.targetUsage,
        verifiedAssets: viewHashes.length,
      };
    },
    {
      jsonPaths: bundlePaths,
      mediaPaths: views.map((view) => view.path),
    },
  );
}

function expectCleanLedger(ledger: BrowserLedger) {
  expect(ledger.crossOriginRequests, 'the published case must have no cross-origin egress').toEqual(
    [],
  );
  expect(ledger.pageErrors, 'the page must not throw').toEqual([]);
  expect(ledger.consoleErrors, 'the console must stay free of errors').toEqual([]);
  expect(ledger.requestFailures, 'same-origin case requests must not fail').toEqual([]);
  expect(
    ledger.caseResponses.filter((response) => response.status >= 400),
    'case assets must not return HTTP errors',
  ).toEqual([]);
}

async function expectNoHorizontalClipping(page: Page) {
  const project = test.info().project.name;
  const report = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const selector = [
      'button',
      'a[href]',
      'video',
      '[role="combobox"]',
      '[data-testid="case-consent"]',
      '[data-testid="target-usage"]',
      '[data-testid="asset-integrity"]',
      '[data-testid="quality-summary"]',
    ].join(',');
    const clipped = [...document.querySelectorAll<HTMLElement>(selector)].flatMap((element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        box.width === 0 ||
        box.height === 0 ||
        (box.left >= -1 && box.right <= viewportWidth + 1)
      ) {
        return [];
      }
      return [
        {
          label: element.dataset.testid ?? element.getAttribute('aria-label') ?? element.tagName,
          left: box.left,
          right: box.right,
        },
      ];
    });
    return {
      clipped,
      documentOverflow: document.documentElement.scrollWidth - viewportWidth,
    };
  });
  expect(report.documentOverflow, `${project} must not overflow horizontally`).toBeLessThanOrEqual(
    1,
  );
  expect(
    report.clipped,
    `${project} controls and evidence must remain horizontally reachable`,
  ).toEqual([]);
}

test.describe('NodeVideo authorized-real-v2 release gate', () => {
  test('independently verifies the full audiovisual proof and all five views', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-chromium', 'desktop V2 bundle gate');
    const ledger = observeBrowser(page);
    await page.goto('/');
    await waitForVerifiedV2(page);

    const independent = await verifyV2BundleIndependently(page);
    expect(independent).toMatchObject({
      assetCount: 15,
      eventSummary: { failed: 0, passed: 56, total: 56 },
      manifestHash: v2ManifestSha256,
      permanentWindowPassed: true,
      releaseReady: true,
      sourceAudioMuted: true,
      textCueCount: 31,
      vmaf: 25.94982,
    });
    expect(independent.referenceCorrelation).toBeGreaterThanOrEqual(0.97);
    expect(Math.abs(independent.sourceLeakage)).toBeLessThanOrEqual(0.05);
    await expect(page.getByTestId('v2-permanent-window')).toContainText(/source a frame 942/i);
    await expect(page.getByTestId('v2-soundtrack')).toContainText(/target soundtrack correlation/i);
    await expect(page.getByTestId('v2-soundtrack')).toContainText(/source leakage 0\.039134/i);
    await expect(page.getByTestId('v2-text-summary')).toContainText(/31 typed plan cues/i);
    await expect(page.getByTestId('v2-claim-boundary')).toContainText(/vmaf/i);

    const mediaUrls = new Set<string>();
    for (const view of v2Views) {
      await chooseV2View(page, view.option);
      mediaUrls.add(await expectCurrentV2Video(page, view));
    }
    expect(mediaUrls.size).toBe(5);
    expectCleanLedger(ledger);
  });

  test('fails closed when the deployment-trusted V2 manifest is tampered', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-chromium', 'desktop V2 tamper gate');
    const ledger = observeBrowser(page);
    await page.route(`**${v2CaseBase}/manifest.json`, async (route) => {
      await route.fulfill({
        body: '{"tampered":true}',
        contentType: 'application/json',
        status: 200,
      });
    });
    await page.goto('/');
    await expect(page.getByTestId('v2-verification-error')).toContainText(
      /failed trusted sha-256 verification/i,
    );
    await expect(page.getByTestId('v2-proof-badge')).toContainText(/release blocked/i);
    await expect(page.getByTestId('v2-verdict')).toHaveCount(0);
    await expect(page.locator('video')).toHaveCount(0);
    expectCleanLedger(ledger);
  });

  test('supports keyboard comparison and evidence disclosure', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-chromium', 'desktop V2 keyboard gate');
    const ledger = observeBrowser(page);
    await page.goto('/');
    await waitForVerifiedV2(page);

    const select = page.getByRole('combobox', { name: 'V2 comparison view', exact: true });
    await select.focus();
    await expect(select).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('option', { name: 'Final target edit', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(select).toBeFocused();

    const disclosure = page.getByRole('button', { name: /what the system understood/i });
    await disclosure.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('v2-understanding')).toContainText(/target-asset derivation/i);
    await expect(page.getByTestId('v2-artifacts').getByRole('link')).toHaveCount(10);
    expectCleanLedger(ledger);
  });
});

test.describe('NodeVideo authorized-real-v1 release gate', () => {
  test('shows the V2 proof boundary first and keeps invalidated V1 history accessible', async ({
    page,
  }) => {
    const ledger = observeBrowser(page);
    await page.goto('/');
    await expect(page.getByTestId('v2-proof-panel')).toBeVisible();
    await expect(page.getByText('Reference understanding', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Authorized target-guided reconstruction', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Blind creative taste not claimed', { exact: true })).toBeVisible();

    const history = page.getByTestId('v1-history-trigger');
    await expect(history).toHaveAttribute('aria-expanded', 'false');
    await history.focus();
    await page.keyboard.press('Enter');
    await expect(history).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('case-invalidated')).toBeVisible();
    await expectNoHorizontalClipping(page);
    expectCleanLedger(ledger);
  });

  test('verifies the same-origin bundle, honest claims, and all six distinct views', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'desktop-chromium', 'desktop bundle gate');
    const ledger = observeBrowser(page);
    await openCleanCase(page);
    await loadVerifiedCase(page);

    const independent = await verifyBundleIndependently(page);
    expect(independent).toMatchObject({
      authorization: 'owner-authorized-publication',
      adjudication: 'invalidated',
      resultHashMatches: true,
      targetUsage: 'analysis-and-evaluation-only',
      verifiedAssets: 6,
    });
    expect(independent.jsonContentTypes.every((type) => type.includes('application/json'))).toBe(
      true,
    );
    expect(independent.renderInputs).toEqual([
      'asset.source-a-original',
      'asset.source-b-original',
    ]);

    await expect(page.getByTestId('case-consent')).toContainText(/owner-authorized publication/i);
    await expect(page.getByTestId('target-usage')).toContainText(/analysis.+evaluation-only/i);
    await expect(page.getByTestId('target-usage')).toContainText(/soundtrack.*excluded/i);
    await expect(page.getByTestId('case-invalidated')).toContainText(/reconstruction pass/i);
    await expect(page.getByTestId('case-invalidated')).toContainText(/wrong source motion/i);
    await expect(page.getByTestId('quality-summary')).toContainText(/not a pass/i);
    await expect(page.getByTestId('quality-summary')).toContainText(/16\.067.*19\.633/i);
    await expect(page.getByTestId('metric-ssim')).toContainText('0.946873');
    await expect(page.getByTestId('metric-psnr')).toContainText(/26\.311718\s*dB/i);
    await page.getByRole('button', { name: /recorded worker trace/i }).click();
    await expect(page.getByTestId('real-case-receipt')).toHaveAttribute(
      'href',
      bundlePaths.receipt,
    );

    const mediaUrls = new Set<string>();
    for (const view of views) {
      await chooseView(page, view.option);
      mediaUrls.add(await expectCurrentVideo(page, view));
    }
    expect(mediaUrls.size).toBe(6);
    for (const path of [...Object.values(bundlePaths), ...views.map((view) => view.path)]) {
      expect(
        ledger.caseResponses.some((response) => response.path === path),
        path,
      ).toBe(true);
    }
    expectCleanLedger(ledger);
  });

  test('fails closed when reconstruction bytes are tampered', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-chromium', 'desktop tamper gate');
    const ledger = observeBrowser(page);
    await openCleanCase(page);
    let tampered = false;
    await page.route(`**${caseBase}/reconstruction.mp4`, async (route) => {
      tampered = true;
      await route.fulfill({
        body: 'tampered-reconstruction',
        contentType: 'video/mp4',
        status: 200,
      });
    });

    await page.getByTestId('real-case-load').click();
    const verificationError = page.getByRole('alert').filter({ hasText: /verification stopped/i });
    await expect(verificationError).toContainText(/verification stopped/i, {
      timeout: 90_000,
    });
    await expect(verificationError).toContainText(/reconstruction.*sha-256 verification/i);
    await expect(page.getByTestId('asset-integrity')).toContainText(/not.*checked/i);
    await expect(page.getByTestId('real-case-load')).toBeEnabled();
    await expect(page.locator('video')).toHaveCount(0);
    expect(tampered).toBe(true);
    expectCleanLedger(ledger);
  });

  test('has no serious accessibility failures or horizontal clipping at this viewport', async ({
    page,
  }) => {
    const ledger = observeBrowser(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openCleanCase(page);
    await loadVerifiedCase(page);
    await expectNoHorizontalClipping(page);

    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = axe.violations
      .filter(({ impact }) => impact === 'critical' || impact === 'serious')
      .map(({ help, id, impact, nodes }) => ({
        help,
        id,
        impact,
        nodes: nodes.map(({ failureSummary, target }) => ({ failureSummary, target })),
      }));
    expect(blocking).toEqual([]);
    expectCleanLedger(ledger);
  });

  test('keyboard activates verification and opens the comparison choices', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-chromium', 'desktop keyboard gate');
    const ledger = observeBrowser(page);
    await openCleanCase(page);
    await loadVerifiedCase(page, true);

    const select = page.getByRole('combobox', { name: 'Comparison view', exact: true });
    await select.focus();
    await expect(select).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('option', { name: 'Target', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(select).toBeFocused();
    await expectCurrentVideo(page, views[2]);
    expectCleanLedger(ledger);
  });
});
