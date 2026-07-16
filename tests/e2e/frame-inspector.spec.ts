import AxeBuilder from '@axe-core/playwright';
import { expect, test } from 'playwright/test';

test('hash-verifies and synchronizes the frame inspector', async ({ page }) => {
  await page.goto('/');
  const inspector = page.getByTestId('integrated-frame-inspector');
  await inspector.getByRole('button', { name: /inspect the autonomous cut/i }).click();

  const verified = page.getByTestId('verified-frame-inspector');
  await expect(verified).toContainText('7/7 SHA-256 verified', { timeout: 90_000 });
  await expect(verified).toContainText(/Frame 480 .* 16\.000 s .* take-a .* fit/);
  await expect(verified.getByText('Original choreography pose')).toBeVisible();
  await expect(verified.getByText('Creator take A', { exact: true })).toBeVisible();
  await expect(verified.getByText('Creator take B', { exact: true })).toBeVisible();
  await expect(verified.getByText('Frozen generated edit', { exact: true })).toBeVisible();
  await expect(verified.getByText('Manual final MP4', { exact: true })).toBeVisible();

  await verified.getByRole('button', { name: 'Next output frame' }).click();
  await expect(verified).toContainText(/Frame 481 .* 16\.033 s/);
  await page.keyboard.press('ArrowLeft');
  await expect(verified).toContainText(/Frame 480 .* 16\.000 s/);

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
