import { expect, test } from 'playwright/test';

test.describe('NodeVideo tracking Artifact Atlas', () => {
  test('shows proof-backed artifacts, detector arena, harness comparison, and rights ledger', async ({
    page,
  }) => {
    await page.goto('/atlas');
    await expect(
      page.getByRole('heading', { name: /Every way NodeVideo knows how to follow the action/i }),
    ).toBeVisible();
    await expect(page.getByTestId('artifact-gallery').locator('article')).toHaveCount(8);
    await expect(page.getByText('Group performance', { exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Detector Arena' }).first().click();
    await expect(page.getByTestId('detector-arena')).toContainText('Manual seed + OpenCV');
    await expect(page.getByTestId('detector-arena')).toContainText('YOLO11n local');
    await page.getByRole('button', { name: 'Harness Compare' }).first().click();
    await expect(page.getByTestId('harness-compare')).toContainText('8 domain packs');
    await page.getByRole('button', { name: 'Proof & rights' }).first().click();
    await expect(page.getByTestId('proof-ledger').locator('article')).toHaveCount(8);
    await expect(page.getByTestId('proof-ledger')).toContainText('Creative Commons Attribution');
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/u);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
  });

  test('keeps the local Atlas guide usable without external egress', async ({ page }) => {
    await page.goto('/atlas');
    const composer = page.getByLabel('Ask the Atlas');
    await composer.fill('Why did this use a manual seed?');
    await page.getByRole('button', { name: 'Send Atlas question' }).click();
    await expect(page.getByLabel('NodeVideo Atlas guide')).toContainText('rights-cleared fixture');
    await expect(page.getByLabel('NodeVideo Atlas guide')).toContainText('no egress');
  });
});
