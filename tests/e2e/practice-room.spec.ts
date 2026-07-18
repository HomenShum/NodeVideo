import AxeBuilder from '@axe-core/playwright';
import { expect, test } from 'playwright/test';

test('practice room is honest before, during, and about the camera', async ({ page }) => {
  await page.goto('/practice.html');

  await expect(
    page.getByRole('heading', { name: 'Dance the Sign phrase with your camera.' }),
  ).toBeVisible();
  // Privacy and claim boundaries visible before any camera access.
  await expect(page.getByText('no video or pose data leaves your browser')).toBeVisible();
  await expect(page.getByText('not a score, a grade, or a judgment')).toBeVisible();
  await expect(page.getByText('silent beat clock')).toBeVisible();

  // With the fake camera, permission is auto-granted and the on-device model
  // loads from same-origin assets. The synthetic feed has no human in it, so
  // the honest outcome is the "step into frame" state — never fake readiness.
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByText('Step into frame')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Start the phrase' })).toBeDisabled();

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
