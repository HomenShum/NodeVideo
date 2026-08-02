import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const cwd = fileURLToPath(new URL('../..', import.meta.url));
const baseUrl = 'http://127.0.0.1:4188/edit.html';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4188'],
  { cwd, stdio: 'ignore', windowsHide: true },
);

async function ready() {
  for (let attempt = 0; attempt < 160; attempt += 1) {
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
  await page.waitForTimeout(800);
  return { page, errors };
}

function assertNoErrors(label, errors) {
  if (errors.length) throw new Error(`${label} browser errors: ${errors.join('\n')}`);
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
  if ((await loading.getByLabel('Agent change map').count()) !== 0)
    throw new Error('Agent change map rendered before the accepted plan loaded');
  await loading.screenshot({ path: 'evidence/editor-agent-causality-v4/after-loading.png' });
  releasePlan();
  await loading.close();

  const desktop = await openReady(browser, { width: 1440, height: 900 });
  await desktop.page.screenshot({ path: 'evidence/editor-agent-causality-v4/after-empty.png' });
  await desktop.page.getByLabel('Ask the edit agent').fill('duplicate 2');
  await desktop.page.keyboard.press('Enter');
  await desktop.page.getByLabel('Agent change map').waitFor();
  await desktop.page.screenshot({
    path: 'evidence/editor-agent-causality-v4/after-duplicate-proposal.png',
  });
  await desktop.page.getByRole('button', { name: 'Apply to timeline' }).click();
  await desktop.page.getByText('AI ADDED', { exact: true }).waitFor();
  await desktop.page.screenshot({
    path: 'evidence/editor-agent-causality-v4/after-duplicate-accepted.png',
  });
  await desktop.page.getByRole('button', { name: 'Undo', exact: true }).click();
  await desktop.page.getByText('AI ADDED', { exact: true }).waitFor({ state: 'detached' });
  await desktop.page.screenshot({ path: 'evidence/editor-agent-causality-v4/after-undo.png' });
  await desktop.page.getByLabel('Ask the edit agent').fill('delete 2');
  await desktop.page.keyboard.press('Enter');
  await desktop.page.getByLabel('Agent change map').waitFor();
  await desktop.page.screenshot({
    path: 'evidence/editor-agent-causality-v4/after-delete-proposal.png',
  });
  await desktop.page.getByRole('button', { name: 'Apply to timeline' }).click();
  await desktop.page.getByText('AI SHIFTED', { exact: true }).waitFor();
  await desktop.page.screenshot({
    path: 'evidence/editor-agent-causality-v4/after-delete-accepted.png',
  });
  const desktopGeometry = await desktop.page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  if (desktopGeometry.document > desktopGeometry.viewport + 1)
    throw new Error(`Desktop overflow: ${JSON.stringify(desktopGeometry)}`);
  assertNoErrors('Desktop', desktop.errors);
  await desktop.page.close();

  const guard = await openReady(browser, { width: 1440, height: 900 });
  for (let remaining = 5; remaining > 1; remaining -= 1) {
    await guard.page.getByRole('button', { name: /^Current clip 0 take [AB]$/ }).click();
    await guard.page.keyboard.press('Backspace');
  }
  await guard.page.keyboard.press('Backspace');
  await guard.page.getByRole('alert').waitFor();
  await guard.page.screenshot({ path: 'evidence/editor-agent-causality-v4/after-error.png' });
  assertNoErrors('Guard', guard.errors);
  await guard.page.close();

  const mobile = await openReady(browser, { width: 390, height: 844 });
  await mobile.page.getByRole('button', { name: 'Agent', exact: true }).click();
  await mobile.page.getByLabel('Ask the edit agent').fill('duplicate 2');
  await mobile.page.keyboard.press('Enter');
  await mobile.page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await mobile.page.getByLabel('Agent change map').waitFor();
  await mobile.page.screenshot({
    path: 'evidence/editor-agent-causality-v4/after-mobile-proposal.png',
  });
  const mobileGeometry = await mobile.page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  if (mobileGeometry.document > mobileGeometry.viewport + 1)
    throw new Error(`Mobile overflow: ${JSON.stringify(mobileGeometry)}`);
  assertNoErrors('Mobile', mobile.errors);
  await browser.close();
} finally {
  server.kill();
}
