import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:4173/edit.html';
const browser = await chromium.launch({ headless: true });

async function readyPage(viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(baseUrl);
  await page.getByText('107.7 bpm').waitFor({ state: 'attached' });
  return page;
}

try {
  const loading = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await loading.route('**/media/integrated-source-only-v1/edit-plan.json', async (route) => {
    await held;
    await route.continue();
  });
  await loading.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await loading.getByText('Loading the frozen edit plan…').waitFor();
  await loading.screenshot({ path: 'evidence/editor-overlay-shared-lane-v5/after-loading.png' });
  release();
  await loading.close();

  const desktop = await readyPage({ width: 1440, height: 900 });
  await desktop.screenshot({ path: 'evidence/editor-overlay-shared-lane-v5/after-empty.png' });
  await desktop.getByRole('button', { name: /^Current caption 6:/ }).click();
  await desktop.screenshot({
    path: 'evidence/editor-overlay-shared-lane-v5/after-desktop-selected.png',
  });
  await desktop.getByLabel('Ask the edit agent').fill('move caption 6 earlier 1 beat');
  await desktop.keyboard.press('Enter');
  await desktop.getByRole('group', { name: 'Agent caption change map' }).waitFor();
  await desktop.screenshot({
    path: 'evidence/editor-overlay-shared-lane-v5/after-desktop-proposal.png',
  });
  await desktop.getByRole('button', { name: 'Apply to timeline' }).click();
  await desktop.getByText('AI MOVED', { exact: true }).waitFor();
  await desktop.screenshot({
    path: 'evidence/editor-overlay-shared-lane-v5/after-desktop-accepted.png',
  });
  await desktop.screenshot({
    path: 'evidence/editor-overlay-shared-lane-v5/after-canvas-readable.png',
  });
  await desktop.getByRole('button', { name: 'Undo', exact: true }).click();
  await desktop.screenshot({ path: 'evidence/editor-overlay-shared-lane-v5/after-undo.png' });
  await desktop.getByRole('button', { name: /^Current caption 1:/ }).click();
  await desktop.getByRole('button', { name: 'Move selected caption earlier by one beat' }).click();
  await desktop.getByRole('alert').waitFor();
  await desktop.screenshot({ path: 'evidence/editor-overlay-shared-lane-v5/after-error.png' });
  await desktop.close();

  const mobile = await readyPage({ width: 390, height: 844 });
  await mobile.getByRole('button', { name: 'Agent', exact: true }).click();
  await mobile.getByLabel('Ask the edit agent').fill('move caption 6 earlier 1 beat');
  await mobile.keyboard.press('Enter');
  await mobile.getByRole('button', { name: 'Timeline', exact: true }).click();
  await mobile.getByRole('group', { name: 'Agent caption change map' }).waitFor();
  await mobile.screenshot({
    path: 'evidence/editor-overlay-shared-lane-v5/after-mobile-proposal.png',
  });
  const geometry = await mobile.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  if (geometry.document > geometry.viewport + 1)
    throw new Error(`Mobile document overflow: ${JSON.stringify(geometry)}`);
  await mobile.getByRole('button', { name: 'Apply to timeline' }).click();
  await mobile.getByText('AI MOVED', { exact: true }).waitFor();
  await mobile.screenshot({
    path: 'evidence/editor-overlay-shared-lane-v5/after-mobile-accepted.png',
  });
  await mobile.getByRole('button', { name: 'Canvas', exact: true }).click();
  await mobile.getByTestId('overlay-box').filter({ hasText: 'Take that as a sign' }).waitFor();
  await mobile.screenshot({
    path: 'evidence/editor-overlay-shared-lane-v5/after-mobile-canvas.png',
  });
  await mobile.close();
} finally {
  await browser.close();
}
