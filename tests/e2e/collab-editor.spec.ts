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

  // Layout toggle reflects pressed state for keyboard and agent users.
  const sideBySide = page.getByRole('button', { name: 'Side by side' });
  const topBottom = page.getByRole('button', { name: 'Top and bottom' });
  await expect(sideBySide).toHaveAttribute('aria-pressed', 'true');
  await topBottom.click();
  await expect(topBottom).toHaveAttribute('aria-pressed', 'true');
  await expect(sideBySide).toHaveAttribute('aria-pressed', 'false');

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
