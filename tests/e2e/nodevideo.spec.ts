import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from 'playwright/test';

const caseBase = '/media/authorized-real-v1';
const targetOrigin = new URL(process.env.NODEVIDEO_URL ?? 'http://127.0.0.1:4317').origin;
const bundlePaths = {
  manifest: `${caseBase}/case-manifest.json`,
  result: `${caseBase}/result.json`,
  receipt: `${caseBase}/receipt.json`,
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
    if (url.origin === targetOrigin && url.pathname.startsWith(caseBase)) {
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
  const video = page.locator('video:visible');
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
  const select = page.getByRole('combobox', { name: 'Comparison view' });
  await select.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(select).toContainText(option);
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

      const [manifestResponse, resultResponse, receiptResponse] = await Promise.all([
        fetchBytes(jsonPaths.manifest),
        fetchBytes(jsonPaths.result),
        fetchBytes(jsonPaths.receipt),
      ]);
      const manifest = decode(manifestResponse.bytes);
      const result = decode(resultResponse.bytes);
      const receipt = decode(receiptResponse.bytes);
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
        ],
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

test.describe('NodeVideo authorized-real-v1 release gate', () => {
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
    await expect(page.getByTestId('target-usage')).toContainText(
      /soundtrack.*unmatched.*not copied/i,
    );
    await expect(page.getByTestId('quality-summary')).toContainText(/perceptually.?close/i);
    await expect(page.getByTestId('quality-summary')).toContainText(/single case|case-specific/i);
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

    const select = page.getByRole('combobox', { name: 'Comparison view' });
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
