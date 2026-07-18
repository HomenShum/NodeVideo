import AxeBuilder from '@axe-core/playwright';
import { expect, test } from 'playwright/test';

test('stitch studio loads the frozen plan and the edit agent applies a patch', async ({ page }) => {
  await page.goto('/edit.html');

  await expect(
    page.getByRole('heading', { name: 'Edit the Sign cut, on the beat.' }),
  ).toBeVisible();
  await expect(page.getByText('No cloud model')).toBeVisible();
  await expect(page.getByText('Nothing uploads.')).toBeVisible();

  // The frozen plan loads and the bpm badge reflects its beat grid.
  await expect(page.getByText('107.7 bpm')).toBeVisible({ timeout: 15_000 });

  // Undo is honestly disabled before any patch exists.
  const undo = page.getByRole('button', { name: 'Undo last patch' });
  await expect(undo).toBeDisabled();

  // Agent: listing the cuts runs a real tool over the plan.
  await page.getByRole('button', { name: 'Show the cuts' }).click();
  await expect(page.getByText('cuts across the two takes')).toBeVisible();

  // Agent: a swap request produces a patch card; applying it flips the lane
  // and arms undo — the patch is real state, not theater.
  await page.getByLabel('Ask the edit agent').fill('swap 2');
  await page.keyboard.press('Enter');
  const apply = page.getByRole('button', { name: 'Apply patch' });
  await expect(apply).toBeVisible();
  await apply.click();
  await expect(page.getByRole('button', { name: 'Patch applied' })).toBeVisible();
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(undo).toBeDisabled();

  // Direct manipulation: overlay edit mode exposes the lyric box, selecting
  // it attaches real resize handles, and the text edit lands as an undoable
  // patch that re-renders the composition.
  await page.getByRole('button', { name: 'Edit overlays' }).click();
  const overlayBox = page.getByTestId('overlay-box').first();
  await expect(overlayBox).toBeVisible();
  await overlayBox.dispatchEvent('pointerdown');
  await expect(page.locator('.moveable-control-box')).toBeAttached();
  await page.getByLabel('Overlay text').fill('Wait a second');
  await page.getByLabel('Overlay text').press('Enter');
  await expect(page.getByTestId('overlay-box').first()).toHaveText('Wait a second');
  await expect(undo).toBeEnabled();
  await undo.click();
  await page.getByRole('button', { name: 'Done editing overlays' }).click();

  // Clip reordering via keyboard (dnd-kit): pick up the first chip, move it
  // one slot right, drop — the strip re-lays contiguously and undo reverts.
  const firstChip = page.getByRole('button', { name: 'Clip 0 take A' });
  await firstChip.focus();
  // dnd-kit's keyboard sensor advances one droppable per keypress and needs a
  // beat between events to announce and settle.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Clip 0 take B' })).toBeVisible();
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(page.getByRole('button', { name: 'Clip 0 take A' })).toBeVisible();

  const geometry = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    wide: [...document.querySelectorAll('*')].filter(
      (element) => element.getBoundingClientRect().right > window.innerWidth + 1,
    ).length,
  }));
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.wide).toBe(0);

  // Remotion's player internals and wavesurfer's canvas are third-party DOM;
  // audit everything we author.
  const accessibility = await new AxeBuilder({ page })
    .exclude('[data-testid="plan-preview"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);
});
