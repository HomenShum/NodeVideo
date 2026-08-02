import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const cwd = fileURLToPath(new URL('../..', import.meta.url));
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4188'],
  { cwd, stdio: 'ignore', windowsHide: true },
);
const baseUrl = 'http://127.0.0.1:4188/edit.html';

async function ready() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Vite did not become ready');
}

async function openReady(browser, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseUrl);
  await page.getByText('107.7 bpm').waitFor({ state: 'attached' });
  return { page, errors };
}

try {
  await ready();
  const browser = await chromium.launch({ headless: true });

  const loading = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let releasePlan;
  const heldPlan = new Promise((resolve) => {
    releasePlan = resolve;
  });
  await loading.route('**/media/integrated-source-only-v1/edit-plan.json', async (route) => {
    await heldPlan;
    await route.continue();
  });
  await loading.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await loading.getByText('Loading the frozen edit plan…').waitFor();
  if ((await loading.getByTestId('selected-clip-command-bar').count()) !== 0)
    throw new Error('Ripple controls rendered before the accepted plan loaded');
  await loading.screenshot({ path: 'evidence/editor-ripple-commands-v3/after-loading.png' });
  releasePlan();
  await loading.close();

  const desktop = await openReady(browser, { width: 1440, height: 900 });
  await desktop.page.getByRole('button', { name: 'Current clip 2 take A' }).click();
  await desktop.page.getByRole('button', { name: 'Duplicate clip 2' }).waitFor();
  await desktop.page.screenshot({
    path: 'evidence/editor-ripple-commands-v3/after-desktop-selected.png',
  });
  await desktop.page.getByLabel('Ask the edit agent').fill('duplicate 2');
  await desktop.page.keyboard.press('Enter');
  await desktop.page.getByRole('group', { name: 'Agent proposal timeline' }).waitFor();
  await desktop.page.screenshot({
    path: 'evidence/editor-ripple-commands-v3/after-agent-proposal.png',
  });
  await desktop.page.getByRole('button', { name: 'Apply to timeline' }).click();
  await desktop.page.getByText(/NodeAgent · Duplicate clip #2/).waitFor();
  await desktop.page.screenshot({
    path: 'evidence/editor-ripple-commands-v3/after-agent-applied.png',
  });
  const desktopGeometry = await desktop.page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  if (desktopGeometry.document > desktopGeometry.viewport + 1)
    throw new Error(`Desktop document overflow: ${JSON.stringify(desktopGeometry)}`);
  if (desktop.errors.length)
    throw new Error(`Desktop browser errors: ${desktop.errors.join('\n')}`);
  await desktop.page.close();

  const guard = await openReady(browser, { width: 1440, height: 900 });
  for (let remaining = 5; remaining > 1; remaining -= 1) {
    await guard.page.getByRole('button', { name: /^Current clip 0 take [AB]$/ }).click();
    await guard.page.keyboard.press('Backspace');
  }
  await guard.page.keyboard.press('Backspace');
  await guard.page.getByRole('alert').waitFor();
  await guard.page.screenshot({
    path: 'evidence/editor-ripple-commands-v3/after-last-delete-guard.png',
  });
  if (guard.errors.length) throw new Error(`Guard browser errors: ${guard.errors.join('\n')}`);
  await guard.page.close();

  const mobile = await openReady(browser, { width: 390, height: 844 });
  await mobile.page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await mobile.page.getByRole('button', { name: 'Current clip 2 take A' }).click();
  await mobile.page.getByRole('button', { name: 'Duplicate clip 2' }).waitFor();
  await mobile.page.screenshot({
    path: 'evidence/editor-ripple-commands-v3/after-mobile-selected.png',
  });
  const mobileGeometry = await mobile.page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  if (mobileGeometry.document > mobileGeometry.viewport + 1)
    throw new Error(`Mobile document overflow: ${JSON.stringify(mobileGeometry)}`);
  if (mobile.errors.length) throw new Error(`Mobile browser errors: ${mobile.errors.join('\n')}`);

  await browser.close();
} finally {
  server.kill();
}
