import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:4173/edit.html';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(baseUrl);
  await page.getByText('107.7 bpm').waitFor();
  await page.getByRole('button', { name: 'Edit overlays' }).click();
  await page.getByTestId('overlay-box').first().click();
  await page.screenshot({ path: 'evidence/editor-overlay-shared-lane-v5/before.png' });
  await page.evaluate(() => {
    const regions = [
      ['CHANGE A · CANVAS OVERLAY EDITOR', document.querySelector('.studio-preview-card')],
      [
        'CHANGE B · SHARED TIMELINE',
        document.querySelector('[data-testid="shared-plan-timeline"]'),
      ],
    ];
    for (const [title, target] of regions) {
      if (!(target instanceof HTMLElement)) throw new Error(`${title} region missing`);
      const rect = target.getBoundingClientRect();
      const box = document.createElement('div');
      box.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;left:${rect.left - 4}px;top:${rect.top - 4}px;width:${rect.width + 8}px;height:${rect.height + 8}px;border:3px solid #ff3b30;box-sizing:border-box`;
      const label = document.createElement('div');
      label.textContent = title;
      label.style.cssText =
        'position:absolute;left:0;top:0;background:#ff3b30;color:white;padding:4px 8px;font:700 12px ui-monospace,monospace;white-space:nowrap';
      box.append(label);
      document.body.append(box);
    }
  });
  await page.screenshot({ path: 'evidence/editor-overlay-shared-lane-v5/change-boundary.png' });
} finally {
  await browser.close();
}
