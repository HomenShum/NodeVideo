import AxeBuilder from '@axe-core/playwright';
import { expect, test } from 'playwright/test';

test('hash-verifies and synchronizes the frame inspector', async ({ page }) => {
  const productionPreview = Boolean(process.env.NODEVIDEO_URL || process.env.CI);
  await page.goto('/');
  const inspector = page.getByTestId('integrated-frame-inspector');
  await inspector.getByRole('button', { name: /inspect the calibration cut/i }).click();

  const verified = page.getByTestId('verified-frame-inspector');
  await expect(verified).toContainText('7/7 SHA-256 verified', { timeout: 90_000 });
  await expect(verified).toContainText(/Frame 480 .* 16\.000 s .* take-a .* fit/);
  await expect(verified.getByText('Original choreography pose')).toBeVisible();
  await expect(verified.getByText('Creator take A', { exact: true })).toBeVisible();
  await expect(verified.getByText('Creator take B', { exact: true })).toBeVisible();
  await expect(verified.getByText('Frozen generated edit', { exact: true })).toBeVisible();
  await expect(verified.getByText('Manual final MP4', { exact: true })).toBeVisible();

  const generated = verified.getByTestId('outcome-comparison').locator('video').first();
  if (productionPreview) {
    const privateRoute = await page.request.get('/__nodevideo_local/full-preview.mp4');
    expect(privateRoute.headers()['content-type']).not.toContain('video');
    await expect(verified).toContainText('Public proof · silent');
    expect(
      await generated.evaluate((node) => {
        const video = node as HTMLVideoElement;
        return { muted: video.muted, src: video.currentSrc };
      }),
    ).toMatchObject({
      muted: true,
      src: expect.stringContaining('/media/integrated-source-only-v1/preview-silent.mp4'),
    });
  } else {
    const range = await page.request.get('/__nodevideo_local/full-preview.mp4', {
      headers: { Range: 'bytes=0-1023' },
    });
    expect(range.status()).toBe(206);
    expect(range.headers()['content-range']).toMatch(/^bytes 0-1023\//);
    await expect(verified).toContainText('Local soundtrack enabled');
    expect(
      await generated.evaluate((node) => {
        const video = node as HTMLVideoElement;
        return { controls: video.controls, muted: video.muted, src: video.currentSrc };
      }),
    ).toMatchObject({
      controls: true,
      muted: false,
      src: expect.stringContaining('/__nodevideo_local/full-preview.mp4'),
    });
    await generated.evaluate(async (node) => {
      const video = node as HTMLVideoElement;
      await video.play();
      video.currentTime = 16.5;
    });
    await expect(verified).toContainText(/Frame 495 .* 16\.500 s/);
    await generated.evaluate((node) => (node as HTMLVideoElement).pause());
  }

  const expectedFrame = productionPreview ? 480 : 495;
  await verified.getByRole('button', { name: 'Next output frame' }).click();
  await expect(verified).toContainText(new RegExp(`Frame ${expectedFrame + 1}`));
  await page.keyboard.press('ArrowLeft');
  await expect(verified).toContainText(new RegExp(`Frame ${expectedFrame}`));

  const overflow = await page.evaluate(() => ({
    pixels: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    elements: [...document.querySelectorAll<HTMLElement>('*')]
      .filter(
        (element) =>
          element.getBoundingClientRect().right > document.documentElement.clientWidth + 1,
      )
      .slice(0, 8)
      .map((element) => ({
        className: element.className,
        tag: element.tagName,
        text: element.textContent,
      })),
  }));
  expect(overflow.pixels, JSON.stringify(overflow.elements)).toBeLessThanOrEqual(1);

  const accessibility = await new AxeBuilder({ page })
    .include('[data-testid="verified-frame-inspector"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);
});
