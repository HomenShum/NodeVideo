import AxeBuilder from '@axe-core/playwright';
import { expect, test } from 'playwright/test';
test('extension first run is accessible and does not overflow', async ({ page }) => {
  await page.goto('/apps/chrome-extension/sidepanel.html');

  await expect(
    page.getByRole('heading', { name: '10count choreography · UI preview' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Judge choreography' })).toBeVisible();
  await expect(page.getByText('processed on this laptop')).toBeVisible();
  await expect(
    page.getByText('It does not grade artistry, expression, identity, or safety.'),
  ).toBeVisible();

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
