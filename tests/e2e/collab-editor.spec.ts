import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from 'playwright/test';

test('collab editor is immediately usable, honest, and does not overflow', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('/collab.html');

  await expect(page.getByRole('heading', { name: 'Dance next to the original.' })).toBeVisible();
  await expect(page.getByText('nothing ever leaves your browser')).toBeVisible();
  await expect(page.getByText('only export collabs you have permission to make')).toBeVisible();

  // Both actions stay gated until the two files exist — no fake readiness.
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export collab video' })).toBeDisabled();
  await expect(page.getByText('Drop a video here, or tap to browse').first()).toBeVisible();

  // Real intake: choosing files renders a decoded thumbnail frame with the
  // file's name and duration, and arms both gated actions.
  await page
    .locator('#reference-video')
    .setInputFiles('fixtures/media/authorized-real-v1/source-a-web.mp4');
  await page
    .locator('#take-video')
    .setInputFiles('fixtures/media/authorized-real-v1/source-b-web.mp4');
  await expect(page.getByAltText('First frames of source-a-web.mp4')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByAltText('First frames of source-b-web.mp4')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('tap or drop to replace').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Export collab video' })).toBeEnabled();

  // Layout toggle reflects pressed state for keyboard and agent users.
  const sideBySide = page.getByRole('button', { name: 'Side by side' });
  const topBottom = page.getByRole('button', { name: 'Top and bottom' });
  await expect(sideBySide).toHaveAttribute('aria-pressed', 'true');
  await topBottom.click();
  await expect(topBottom).toHaveAttribute('aria-pressed', 'true');
  await expect(sideBySide).toHaveAttribute('aria-pressed', 'false');

  // Direct manipulation: dragging the preview sideways scrubs the reference
  // offset (4ms/px), the tactile twin of the nudge buttons.
  const canvas = page.getByRole('img', { name: /drag sideways to nudge/ });
  await canvas.scrollIntoViewIfNeeded();
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  if (canvasBox) {
    // Drag near the canvas top: in top-bottom layout the canvas can be taller
    // than the viewport, putting its midpoint outside the clickable area.
    const y = canvasBox.y + Math.min(60, canvasBox.height / 4);
    await page.mouse.move(canvasBox.x + canvasBox.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 100, y, { steps: 5 });
    await page.mouse.up();
  }
  await expect(page.getByText('0.40s')).toBeVisible();

  const geometry = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    wide: [...document.querySelectorAll('*')].filter(
      (element) => element.getBoundingClientRect().right > window.innerWidth + 1,
    ).length,
  }));
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.wide).toBe(0);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('native Chromium records the collab canvas as a non-empty WebM', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium',
    'One real MediaRecorder smoke is sufficient; orchestration coverage runs in every project.',
  );
  test.setTimeout(45_000);

  await page.goto('/collab.html');
  await page
    .locator('#reference-video')
    .setInputFiles('fixtures/media/tutorial-compare-v1/source-reference.mp4');
  await page
    .locator('#take-video')
    .setInputFiles('fixtures/media/tutorial-compare-v1/source-attempt.mp4');
  await expect(page.getByAltText('First frames of source-reference.mp4')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByAltText('First frames of source-attempt.mp4')).toBeVisible({
    timeout: 15_000,
  });

  const downloadStarted = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Export collab video' }).click();
  const download = await downloadStarted;
  expect(download.suggestedFilename()).toBe('nodevideo-collab.webm');

  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  if (!downloadPath) throw new Error('Playwright did not retain the downloaded WebM');
  const bytes = readFileSync(downloadPath);
  expect(bytes.byteLength).toBeGreaterThan(1_000);
  expect(bytes.subarray(0, 4).toString('hex')).toBe('1a45dfa3');
  await expect(page.getByTestId('collab-export-status')).toContainText('Collab exported');
});

test('collab export falls back when animation frames stall and discards interrupted files', async ({
  page,
}) => {
  await page.addInitScript(() => {
    type UrlEvent = { kind: 'create' | 'revoke'; type?: string; url: string };
    const testWindow = window as typeof window & {
      __nodeVideoHidden: boolean;
      __nodeVideoUrlEvents: UrlEvent[];
    };

    testWindow.__nodeVideoHidden = false;
    testWindow.__nodeVideoUrlEvents = [];
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => testWindow.__nodeVideoHidden,
    });

    // Model the browser behavior behind the regression: visible page timers
    // still run, but requestAnimationFrame no longer delivers compositor work.
    let animationFrameId = 0;
    window.requestAnimationFrame = () => ++animationFrameId;
    window.cancelAnimationFrame = () => undefined;

    // Keep this focused on export orchestration instead of codec timing. The
    // real fixture videos still decode and feed the canvas.
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: () => Promise.resolve(),
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: () => undefined,
    });

    class FakeMediaRecorder {
      static isTypeSupported() {
        return true;
      }

      state: RecordingState = 'inactive';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onstop: ((event: Event) => void) | null = null;

      start() {
        this.state = 'recording';
      }

      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        queueMicrotask(() => {
          this.ondataavailable?.({
            data: new Blob(['test-webm'], { type: 'video/webm' }),
          });
          this.onstop?.(new Event('stop'));
        });
      }
    }

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: FakeMediaRecorder,
    });

    const createObjectUrl = URL.createObjectURL.bind(URL);
    const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: (object: Blob | MediaSource) => {
        const url = createObjectUrl(object);
        testWindow.__nodeVideoUrlEvents.push({
          kind: 'create',
          type: object instanceof Blob ? object.type : '',
          url,
        });
        return url;
      },
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: (url: string) => {
        testWindow.__nodeVideoUrlEvents.push({ kind: 'revoke', url });
        revokeObjectUrl(url);
      },
    });
  });

  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  await page.goto('/collab.html');
  await page
    .locator('#reference-video')
    .setInputFiles('fixtures/media/authorized-real-v1/source-a-web.mp4');
  await page
    .locator('#take-video')
    .setInputFiles('fixtures/media/authorized-real-v1/source-b-web.mp4');
  await expect(page.getByAltText('First frames of source-a-web.mp4')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByAltText('First frames of source-b-web.mp4')).toBeVisible({
    timeout: 15_000,
  });

  const exportButton = page.getByRole('button', { name: 'Export collab video' });
  const cancelButton = page.getByRole('button', { name: 'Cancel export' });
  const status = page.getByTestId('collab-export-status');

  await exportButton.click();
  await expect(cancelButton).toBeVisible();
  await expect(status).toHaveAttribute('data-pump', 'timer-fallback');
  await expect(status).toContainText('timer safety pump is keeping the canvas fresh');

  await cancelButton.click();
  await expect(status).toContainText('No partial file was downloaded');
  await expect(exportButton).toBeEnabled();
  expect(downloads).toEqual([]);

  // If the visible page's main thread pauses long enough to starve both rAF
  // and the independent timer, fail closed instead of trusting a stale frame.
  await exportButton.click();
  await expect(cancelButton).toBeVisible();
  await page.evaluate(() => {
    const until = performance.now() + 1_100;
    while (performance.now() < until) Math.sqrt(144);
  });
  await expect(status).toContainText('paused both compositor pumps');
  await expect(exportButton).toBeEnabled();
  expect(downloads).toEqual([]);

  // A hidden tab fails closed even though the independent timer could keep
  // firing. Resetting visibility and exporting again proves cleanup is reusable.
  await exportButton.click();
  await expect(cancelButton).toBeVisible();
  await page.evaluate(() => {
    const testWindow = window as typeof window & { __nodeVideoHidden: boolean };
    testWindow.__nodeVideoHidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(status).toContainText('tab was hidden');
  await expect(exportButton).toBeEnabled();
  expect(downloads).toEqual([]);
  await page.evaluate(() => {
    const testWindow = window as typeof window & { __nodeVideoHidden: boolean };
    testWindow.__nodeVideoHidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });

  const downloadStarted = page.waitForEvent('download');
  await exportButton.click();
  await expect(cancelButton).toBeVisible();
  await page.locator('video').first().dispatchEvent('ended');
  const download = await downloadStarted;
  expect(download.suggestedFilename()).toBe('nodevideo-collab.webm');
  await expect(status).toContainText('Collab exported');
  expect(downloads).toEqual(['nodevideo-collab.webm']);

  // The download URL must survive the click handoff; its 60-second cleanup is
  // intentionally later (and component unmount also revokes it).
  const downloadUrlState = await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __nodeVideoUrlEvents: Array<{
        kind: 'create' | 'revoke';
        type?: string;
        url: string;
      }>;
    };
    const created = [...testWindow.__nodeVideoUrlEvents]
      .reverse()
      .find((event) => event.kind === 'create' && event.type === 'video/webm');
    return {
      created: Boolean(created),
      revoked: Boolean(
        created &&
          testWindow.__nodeVideoUrlEvents.some(
            (event) => event.kind === 'revoke' && event.url === created.url,
          ),
      ),
    };
  });
  expect(downloadUrlState).toEqual({ created: true, revoked: false });
});
