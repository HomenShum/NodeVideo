import AxeBuilder from '@axe-core/playwright';
import { expect, test } from 'playwright/test';

test('collab editor is immediately usable, honest, and does not overflow', async ({ page }) => {
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
});
