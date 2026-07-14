import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { type Locator, type Page, expect, test } from 'playwright/test';

const syntheticVideoPath = resolve('fixtures/media/nodevideo-proof-v1.mp4');
const targetOrigin = new URL(process.env.NODEVIDEO_URL ?? 'http://127.0.0.1:4317').origin;

interface BrowserLedger {
  consoleErrors: string[];
  externalRequests: string[];
  pageErrors: string[];
}

function observeBrowser(page: Page): BrowserLedger {
  const ledger: BrowserLedger = {
    consoleErrors: [],
    externalRequests: [],
    pageErrors: [],
  };

  page.on('console', (message) => {
    if (message.type() === 'error') ledger.consoleErrors.push(message.text());
  });

  page.on('pageerror', (error) => ledger.pageErrors.push(error.message));

  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return;
    if (url.origin === targetOrigin || ['127.0.0.1', 'localhost'].includes(url.hostname)) return;

    // Deliberately omit query strings: a failed privacy assertion must not print a token.
    ledger.externalRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
  });

  return ledger;
}

async function openCleanRoot(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  expect(await page.evaluate(() => document.characterSet)).toBe('UTF-8');
}

async function runSyntheticComparison(page: Page) {
  await openCleanRoot(page);

  const demo = page.getByTestId('demo-load');
  await expect(demo).toBeVisible();
  await expect(demo).toContainText(/synthetic|demo/i);
  await demo.click();

  await expect(page.getByTestId('privacy-badge')).toContainText(/synthetic|public demo/i);

  const runPlan = page.getByTestId('run-plan');
  await expect(runPlan).toBeVisible();
  await expect(runPlan).toBeEnabled();
  await runPlan.click();

  await expect(page.getByTestId('stage-list')).toBeVisible();
  await expect(page.getByTestId('trace-panel')).toBeVisible();
  await expect(page.getByTestId('artifact-panel')).toBeVisible();
  await expect(page.getByTestId('proposal-card')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId('accept-proposal')).toBeEnabled();
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
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        box.width === 0 ||
        box.height === 0 ||
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

test.describe('NodeVideo public synthetic release gate', () => {
  test('first run is clean, progressive, and explicit about privacy', async ({ page }) => {
    const ledger = observeBrowser(page);
    await openCleanRoot(page);

    const privacyBadge = page.getByTestId('privacy-badge');
    await expect(privacyBadge).toBeVisible();
    await expect(privacyBadge).toContainText(/local|device|browser/i);

    await expect(page.getByTestId('demo-load')).toBeVisible();
    await expect(page.getByTestId('demo-load')).toContainText(/synthetic|demo/i);
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

  test('synthetic comparison produces inspectable evidence before mutation', async ({ page }) => {
    const ledger = observeBrowser(page);
    await runSyntheticComparison(page);

    await expect(page.getByTestId('stage-list')).toContainText(/complete|review/i);
    await expect(page.getByTestId('artifact-panel')).toContainText(/synthetic/i);
    await expect(page.getByTestId('trace-panel')).toContainText(/complete|ok|review/i);

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

  test('synthetic review has no serious accessibility violations', async ({ page }) => {
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
        targets: violation.nodes.map((node) => node.target),
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
    await fileInput.setInputFiles(syntheticVideoPath);

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
