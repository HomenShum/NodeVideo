import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const DEFAULT_URL = 'https://nodevideo-pi.vercel.app/creator.html';
const DEFAULT_CDP = 'http://127.0.0.1:9222';
const DEFAULT_ARTIFACT_DIR = resolve('.qa', 'android-emulator');
const ALLOWED_ORIGIN = 'https://nodevideo-pi.vercel.app';
const RUN_TIMEOUT_MS = 150_000;
const MAX_CONSOLE_ERRORS = 20;
const MAX_AGENT_RESPONSE_BYTES = 1_000_000;

export function sanitizePageUrl(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

export function parseArgs(argv) {
  const options = {
    cdp: DEFAULT_CDP,
    external: false,
    vision: false,
    url: DEFAULT_URL,
    artifactDir: DEFAULT_ARTIFACT_DIR,
  };

  for (const argument of argv) {
    if (argument === '--external') {
      options.external = true;
    } else if (argument === '--vision') {
      options.vision = true;
    } else if (argument.startsWith('--cdp=')) {
      options.cdp = argument.slice('--cdp='.length);
    } else if (argument.startsWith('--url=')) {
      options.url = argument.slice('--url='.length);
    } else if (argument.startsWith('--artifact-dir=')) {
      options.artifactDir = resolve(argument.slice('--artifact-dir='.length));
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  const target = new URL(options.url);
  if (target.origin !== ALLOWED_ORIGIN) {
    throw new Error(`Refusing non-production NodeVideo origin: ${target.origin}`);
  }
  const cdp = new URL(options.cdp);
  if (!['127.0.0.1', 'localhost'].includes(cdp.hostname)) {
    throw new Error(`Refusing non-local Chrome debugging endpoint: ${cdp.hostname}`);
  }
  if (options.external && options.vision) {
    throw new Error('Choose either --external or --vision for one bounded journey.');
  }
  return options;
}

async function runVisionQa(options) {
  const browser = await chromium.connectOverCDP(options.cdp);
  const context = browser.contexts()[0];
  if (!context) throw new Error('Android Chrome did not expose a browser context.');
  await context.grantPermissions(['camera'], { origin: ALLOWED_ORIGIN });
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(30_000);
  const consoleErrors = [];
  const consoleDiagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && consoleErrors.length < MAX_CONSOLE_ERRORS) {
      const entry = message.text().slice(0, 500);
      if (/^INFO: Created TensorFlow Lite/u.test(entry)) consoleDiagnostics.push(entry);
      else consoleErrors.push(entry);
    }
  });

  await page.goto(`${ALLOWED_ORIGIN}/vision.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Start live vision' }).click();
  await page.waitForFunction(
    () => {
      const text = document.querySelector('[data-testid="nodevision-live"]')?.textContent ?? '';
      return /Live\s*·\s*[1-9]\d*\s*FPS/iu.test(text) && /[1-9]\d*\s*ms/iu.test(text);
    },
    undefined,
    { timeout: RUN_TIMEOUT_MS },
  );
  const bodyText = await page.getByTestId('nodevision-live').innerText();
  const latencyMs = Number.parseInt(/([1-9]\d*)\s*ms/iu.exec(bodyText)?.[1] ?? '', 10);
  if (!Number.isFinite(latencyMs) || latencyMs <= 0) {
    throw new Error('Pose inference telemetry did not report a positive latency.');
  }
  if (/\[(?:CAMERA|POSE_MODEL|CAMERA_PLAYBACK)[A-Z_]*\]/u.test(bodyText)) {
    throw new Error('Vision entered a camera or pose-model failure state after startup.');
  }

  await mkdir(options.artifactDir, { recursive: true });
  await page.screenshot({
    path: resolve(options.artifactDir, 'vision-live-latest.png'),
    timeout: 15_000,
  });
  const receipt = {
    schemaVersion: 'nodevideo.android-device-qa.v1',
    generatedAt: new Date().toISOString(),
    mode: 'vision-on-device-pose',
    page: sanitizePageUrl(page.url()),
    modelStatus: 'loaded-and-inferring',
    latencyMs,
    poseAcquired: bodyText.includes('1 person · pose acquired'),
    consoleDiagnostics,
    consoleErrors,
  };
  await writeFile(
    resolve(options.artifactDir, 'vision-live-latest.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
    'utf8',
  );
  await browser.close();
  return receipt;
}

export async function runAndroidQa(options) {
  if (options.vision) return runVisionQa(options);
  const browser = await chromium.connectOverCDP(options.cdp);
  const context = browser.contexts()[0];
  if (!context) throw new Error('Android Chrome did not expose a browser context.');
  const pages = context.pages();
  const page = pages[0] ?? (await context.newPage());
  page.setDefaultTimeout(30_000);

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && consoleErrors.length < MAX_CONSOLE_ERRORS) {
      consoleErrors.push(message.text().slice(0, 500));
    }
  });

  await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.getByRole('button', { name: 'Use rights-cleared demo' }).click();
  await page.getByText(/nodevideo-demo\.mp4 .* ready in this browser/u).waitFor();
  await page.getByRole('button', { name: /Start creating/u }).click();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('heading', { name: 'NodeAgent' }).waitFor();
  await page.getByText('nodevideo-demo.mp4', { exact: true }).first().waitFor();

  await mkdir(options.artifactDir, { recursive: true });
  await page.screenshot({
    path: resolve(options.artifactDir, 'before-empty-latest.png'),
    timeout: 15_000,
  });

  const auto = page.getByRole('button', { name: 'Auto', exact: true });
  if ((await auto.getAttribute('aria-pressed')) !== 'true') {
    throw new Error('Auto mode was not enabled by default on Android.');
  }

  let provider = 'nodevideo';
  let model = 'deterministic-founder-variant-compiler-v2';
  let depthMode = 'deterministic';
  let iterations = 0;
  let operations = [];
  let httpStatus = null;

  if (options.external) {
    const optionsPanel = page.getByTestId('agent-options');
    if (await optionsPanel.count()) {
      await optionsPanel.locator('summary').click();
    } else {
      await page.getByText('Routing', { exact: true }).click();
    }
    await page.getByRole('combobox', { name: 'Executor route' }).click();
    await page.getByRole('option', { name: 'OpenRouter Free · external', exact: true }).click();
    const consent = page.getByRole('checkbox', {
      name: 'Consent to send prompt and transcript context to OpenRouter',
    });
    await consent.check();
    await page
      .getByRole('textbox', { name: 'Message NodeAgent' })
      .fill(
        "Remove safe silence, review filler cuts, create a second launch variant, and preserve the speaker's exact meaning.",
      );
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/creator-agent'),
      { timeout: RUN_TIMEOUT_MS },
    );
    await page.getByRole('button', { name: 'Send message' }).click();
    const response = await responsePromise;
    httpStatus = response.status();
    if (!response.ok()) throw new Error(`Creator agent returned HTTP ${httpStatus}.`);
    const responseBody = await response.body();
    if (responseBody.byteLength > MAX_AGENT_RESPONSE_BYTES) {
      throw new Error(`Creator agent response exceeded ${MAX_AGENT_RESPONSE_BYTES} bytes.`);
    }
    const payload = JSON.parse(responseBody.toString('utf8'));
    provider = payload.provider;
    model = payload.model;
    depthMode = payload.depthMode;
    iterations = payload.iterations;
    operations = payload.plan?.operations?.map((operation) => operation.kind) ?? [];
    const required = ['remove_silence', 'review_fillers', 'compose_variants', 'preserve_meaning'];
    const missing = required.filter((operation) => !operations.includes(operation));
    if (missing.length > 0)
      throw new Error(`Agent omitted required operations: ${missing.join(', ')}`);
    await page.getByText('Free model router', { exact: true }).waitFor();
    if (await consent.isChecked())
      throw new Error('OpenRouter consent did not reset after the run.');
  } else {
    await page.getByRole('button', { name: 'Send message' }).click();
    await page.getByText(/completed · deterministic local/u).waitFor({ timeout: RUN_TIMEOUT_MS });
  }

  await page.getByText('Edit proposal ready', { exact: true }).waitFor();
  const proposalText = await page.getByTestId('agent-proposal-card').innerText();
  const receipt = {
    schemaVersion: 'nodevideo.android-device-qa.v1',
    generatedAt: new Date().toISOString(),
    mode: options.external ? 'openrouter-free' : 'local-deterministic',
    page: sanitizePageUrl(page.url()),
    viewport: await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    })),
    autoModeDefault: true,
    provider,
    model,
    depthMode,
    iterations,
    operations,
    httpStatus,
    proposal: proposalText.replace(/digest sha256:[a-f0-9]+/u, 'digest [redacted]'),
    consoleErrors,
  };

  const prefix = options.external ? 'openrouter' : 'local';
  await page.screenshot({
    path: resolve(options.artifactDir, `${prefix}-latest.png`),
    timeout: 15_000,
  });
  await writeFile(
    resolve(options.artifactDir, `${prefix}-latest.json`),
    `${JSON.stringify(receipt, null, 2)}\n`,
    'utf8',
  );
  await browser.close();
  return receipt;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const receipt = await runAndroidQa(options);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
