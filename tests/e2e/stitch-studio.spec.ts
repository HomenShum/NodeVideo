import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from 'playwright/test';

const committedEditPlan = JSON.parse(
  readFileSync(
    new URL('../../fixtures/media/integrated-source-only-v1/edit-plan.json', import.meta.url),
    'utf8',
  ),
) as {
  canvas: { width: number; height: number };
  durationFrames: number;
  tracks: Array<{ id: string; kind: string; role?: string; clips: Array<Record<string, unknown>> }>;
  audio: { routing: Array<Record<string, unknown>>; events: Array<Record<string, unknown>> };
};

function quickBrowserExportPlan() {
  const plan = structuredClone(committedEditPlan);
  plan.canvas = { width: 180, height: 320 };
  plan.durationFrames = 30;
  const video = plan.tracks.find((track) => track.kind === 'video' && track.role === 'primary');
  if (!video) throw new Error('committed plan is missing its primary video track');
  video.clips = [
    {
      ...video.clips[0],
      timelineRange: { startFrame: 0, endFrameExclusive: 30 },
      // Keep the real-codec smoke fast: seeking through 15 seconds of source
      // inside ffmpeg.wasm would test decoder throughput, not export wiring.
      sourceRange: { startFrame: 0, endFrameExclusive: 30 },
    },
  ];
  const overlay = plan.tracks.find((track) => track.kind === 'overlay');
  if (!overlay) throw new Error('committed plan is missing its overlay track');
  overlay.clips = [
    {
      ...overlay.clips[0],
      timelineRange: { startFrame: 0, endFrameExclusive: 30 },
    },
  ];
  plan.tracks = plan.tracks.filter((track) => track.kind !== 'audio');
  plan.audio = {
    routing: [
      {
        id: 'route.mute.asset.take-a',
        sourceKind: 'asset-audio',
        sourceId: 'asset.take-a',
        bus: 'program',
        muted: true,
        gainDb: 0,
      },
    ],
    events: [
      {
        id: 'event.silence',
        kind: 'silence',
        targetStartMs: 0,
        targetEndMs: 1000,
      },
    ],
  };
  return plan;
}

test('stitch studio loads the frozen plan and the edit agent applies a patch', async ({ page }) => {
  await page.goto('/edit.html');

  await expect(
    page.getByRole('heading', { name: 'Edit the Sign cut, on the beat.' }),
  ).toBeVisible();
  await expect(page.getByText('No cloud model')).toBeVisible();
  await expect(page.getByText('Nothing uploads.')).toBeVisible();
  await expect(page.getByText('the private song master is omitted')).toBeVisible();

  // The frozen plan loads and the bpm badge reflects its beat grid.
  await expect(page.getByText('107.7 bpm')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Export silent MP4' })).toBeEnabled();

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

  // Tap-to-seek: a plain click on a chip (below the 6px drag threshold) jumps
  // the player to that clip's first frame — observable via data-frame.
  await page.getByRole('button', { name: 'Clip 1 take B' }).click();
  await expect(page.getByTestId('plan-preview')).toHaveAttribute('data-frame', /^[1-9]\d*$/);

  // On phone-width viewports the ask bar pins to the bottom edge — reachable
  // without scrolling, always under the thumb.
  const viewport = page.viewportSize();
  if (viewport && viewport.width < 1024) {
    const box = await page.getByLabel('Ask the edit agent').boundingBox();
    expect(box).not.toBeNull();
    if (box) expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }

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

test('browser exporter produces a real local H.264 MP4 download', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium',
    'One real WASM encode covers the shared browser exporter without multiplying CI time.',
  );
  test.setTimeout(240_000);

  await page.route('**/media/integrated-source-only-v1/edit-plan.json', async (route) => {
    await route.fulfill({ json: quickBrowserExportPlan() });
  });
  await page.goto('/edit.html');
  await expect(page.getByText('107.7 bpm')).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  const wasm = await page.request.get('/ffmpeg/0.12.10/mt/ffmpeg-core.wasm');
  expect(wasm.ok()).toBe(true);
  expect(wasm.headers()['content-type']).toContain('application/wasm');

  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));

  // Cancellation must tear down an active WASM job without emitting a partial
  // file, and the same UI must be immediately reusable for a clean retry.
  await page.getByRole('button', { name: 'Export silent MP4' }).click();
  await expect(page.getByLabel('MP4 export progress')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel MP4 export' }).click();
  await expect(page.getByTestId('browser-export-status')).toContainText(
    'Export cancelled. No partial file was downloaded.',
  );
  expect(downloads).toEqual([]);

  const downloadStarted = page
    .waitForEvent('download', { timeout: 220_000 })
    .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  await page.getByRole('button', { name: 'Export silent MP4' }).click();
  await expect(page.getByLabel('MP4 export progress')).toBeVisible();
  const terminalStatus = await page.waitForFunction(
    () => {
      const status = document.querySelector('[data-testid="browser-export-status"]');
      if (!status || status.querySelector('[role="progressbar"]')) return null;
      return status.textContent?.trim() || null;
    },
    undefined,
    { timeout: 220_000 },
  );
  expect(await terminalStatus.jsonValue()).toContain('Silent MP4 ready');
  const download = await downloadStarted;
  if (download instanceof Error) throw download;
  expect(download.suggestedFilename()).toBe('nodevideo-sign-edit.mp4');
  expect(downloads).toEqual(['nodevideo-sign-edit.mp4']);

  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  if (!downloadPath) throw new Error('Playwright did not retain the downloaded MP4');
  const bytes = readFileSync(downloadPath);
  expect(bytes.byteLength).toBeGreaterThan(1_000);
  expect(bytes.subarray(4, 8).toString('ascii')).toBe('ftyp');
  await expect(page.getByTestId('browser-export-status')).toContainText('Silent MP4 ready');
  await expect(page.getByRole('link', { name: 'Download again' })).toBeVisible();
});

test('in-browser BYOK agent runs the tool loop against a mocked OpenRouter', async ({ page }) => {
  // Deterministic provider: first call returns a swap tool call, second call
  // returns closing prose. The loop, tool execution, and patch card are real.
  let calls = 0;
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    calls += 1;
    const body =
      calls === 1
        ? {
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'swap_clip_source', arguments: '{"clipIndex":1}' },
                    },
                  ],
                },
              },
            ],
          }
        : {
            choices: [
              {
                message: {
                  content: 'Swapped clip 1 to the other take — apply the patch to make it real.',
                },
              },
            ],
          };
    await route.fulfill({ json: body });
  });

  await page.goto('/edit.html');
  await expect(page.getByText('107.7 bpm')).toBeVisible({ timeout: 15_000 });

  // Enter a session key: badge flips to the in-browser mode, honestly labeled.
  await page.getByText('Connect a model — key stays in this browser').click();
  await page.getByLabel('OpenRouter API key').fill('sk-or-test-not-a-real-key');
  await expect(page.getByText('Model in browser')).toBeVisible();

  await page.getByLabel('Ask the edit agent').fill('swap clip 1 to the other take');
  await page.keyboard.press('Enter');

  // The tool call is rendered, the prose lands, and the proposal is a real
  // applyable patch — same contract as the local rules and the worker.
  await expect(page.getByText('swap_clip_source')).toBeVisible();
  await expect(page.getByText('apply the patch to make it real')).toBeVisible();
  const apply = page.getByRole('button', { name: 'Apply patch' });
  await expect(apply).toBeVisible();
  await apply.click();
  await expect(page.getByRole('button', { name: 'Patch applied' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo last patch' })).toBeEnabled();
  expect(calls).toBe(2);

  // The key never persists past the session store: reload in a fresh context
  // is out of scope here, but the input must be masked in the DOM.
  await expect(page.getByLabel('OpenRouter API key')).toHaveAttribute('type', 'password');
});
