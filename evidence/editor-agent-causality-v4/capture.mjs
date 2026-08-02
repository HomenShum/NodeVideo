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

try {
  await ready();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(baseUrl);
  await page.getByText('107.7 bpm').waitFor();
  await page.getByLabel('Ask the edit agent').fill('duplicate 2');
  await page.keyboard.press('Enter');
  await page.getByRole('group', { name: 'Agent proposal timeline' }).waitFor();
  await page.screenshot({ path: 'evidence/editor-agent-causality-v4/before.png' });
  await page.evaluate(() => {
    const target = document.querySelector('[data-testid="shared-plan-timeline"]');
    if (!(target instanceof HTMLElement)) throw new Error('Shared timeline missing');
    const rect = target.getBoundingClientRect();
    const box = document.createElement('div');
    box.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;left:${rect.left - 4}px;top:${rect.top - 4}px;width:${rect.width + 8}px;height:${rect.height + 8}px;border:3px solid #ff3b30;box-sizing:border-box`;
    const label = document.createElement('div');
    label.textContent = 'CHANGE A · SHARED TIMELINE PROPOSAL + ACCEPTANCE';
    label.style.cssText =
      'position:absolute;left:0;top:-27px;background:#ff3b30;color:white;padding:4px 8px;font:700 12px ui-monospace,monospace;white-space:nowrap';
    box.append(label);
    document.body.append(box);
  });
  await page.screenshot({ path: 'evidence/editor-agent-causality-v4/change-boundary.png' });
  await browser.close();
} finally {
  server.kill();
}
