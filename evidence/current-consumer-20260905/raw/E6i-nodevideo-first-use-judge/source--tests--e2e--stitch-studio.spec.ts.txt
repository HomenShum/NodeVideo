import { execFileSync } from 'node:child_process';
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
  const viewport = page.viewportSize();
  const compact = Boolean(viewport && viewport.width < 1024);

  await expect(page.getByRole('heading', { name: 'Sign · Cut v1' })).toBeVisible();
  await expect(page.getByText('Local', { exact: true })).toHaveCount(1);

  // The frozen plan loads and the bpm badge reflects its beat grid.
  await expect(page.getByText('107.7 bpm')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();

  // Undo is honestly disabled before any patch exists.
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeDisabled();

  // Agent: listing the cuts runs a real tool over the plan.
  if (compact) {
    await expect(page.getByTestId('canvas-surface')).toBeVisible();
    await expect(page.getByTestId('agent-surface')).toBeHidden();
    await expect(page.getByTestId('timeline-surface')).toBeHidden();
    await page.getByRole('button', { name: 'Agent', exact: true }).click();
    await expect(page.getByTestId('canvas-surface')).toBeHidden();
    await expect(page.getByTestId('agent-surface')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Show the cuts' }).click();
  await page.getByText(/History/).click();
  await expect(page.getByText('cuts across the two takes')).toBeVisible();
  await page.getByText(/History/).click();

  // Agent: a swap leaves accepted state untouched while a changed proposal
  // appears on the same timeline. Applying promotes it and arms undo.
  await expect(page.getByRole('group', { name: 'Agent proposal timeline' })).toHaveCount(0);
  await page.getByLabel('Ask the edit agent').fill('swap 2');
  await page.keyboard.press('Enter');
  if (compact) await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByLabel('Current clip 2 take A')).toBeVisible();
  await expect(page.getByLabel('Proposal clip 2 take B changed')).toBeVisible();
  await page.getByRole('button', { name: 'Apply to timeline' }).click();
  await expect(page.getByLabel('Current clip 2 take B')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Agent proposal timeline' })).toHaveCount(0);
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(undo).toBeDisabled();

  // Direct manipulation: overlay edit mode exposes the lyric box, selecting
  // it attaches real resize handles, and the text edit lands as an undoable
  // patch that re-renders the composition.
  if (compact) await page.getByRole('button', { name: 'Canvas', exact: true }).click();
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
  if (compact) await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await page.getByRole('button', { name: 'Current clip 1 take B' }).click();
  await expect(page.getByTestId('plan-preview')).toHaveAttribute('data-frame', /^[1-9]\d*$/);

  // On phone-width viewports the agent is its own reachable surface rather
  // than a composer covering the Canvas or Timeline.
  if (compact) {
    await page.getByRole('button', { name: 'Agent', exact: true }).click();
    const box = await page.getByLabel('Ask the edit agent').boundingBox();
    expect(box).not.toBeNull();
    if (box && viewport) expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }

  // A human reorder retires any pending agent proposal as stale. Move the
  // first chip one slot right; the strip re-lays contiguously and undo reverts.
  await page.getByLabel('Ask the edit agent').fill('swap 2');
  await page.keyboard.press('Enter');
  if (compact) await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByLabel('Proposal clip 2 take B changed')).toBeVisible();
  const firstChip = page.getByRole('button', { name: 'Current clip 0 take A' });
  await firstChip.focus();
  // dnd-kit's keyboard sensor advances one droppable per keypress and needs a
  // beat between events to announce and settle.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Current clip 0 take B' })).toBeVisible();
  await expect(page.getByText('Human · moved clip #0 to position #1')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Agent proposal timeline' })).toHaveCount(0);
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(page.getByRole('button', { name: 'Current clip 0 take A' })).toBeVisible();

  const geometry = await page.evaluate(() => {
    const isContainedByOverflowBoundary = (element: Element) => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const overflow = getComputedStyle(parent).overflowX;
        if (
          ['auto', 'scroll', 'hidden', 'clip'].includes(overflow) &&
          parent.getBoundingClientRect().right <= window.innerWidth + 1
        )
          return true;
      }
      return false;
    };
    return {
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      uncontainedWide: [...document.querySelectorAll('*')].filter(
        (element) =>
          element.getBoundingClientRect().right > window.innerWidth + 1 &&
          !isContainedByOverflowBoundary(element),
      ).length,
    };
  });
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.uncontainedWide).toBe(0);

  // Remotion's player internals and wavesurfer's canvas are third-party DOM;
  // audit everything we author.
  const accessibility = await new AxeBuilder({ page })
    .exclude('[data-testid="plan-preview"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

test('an exploring editor keeps one actionable proposal and can reject it without timeline drift', async ({
  page,
}) => {
  await page.goto('/edit.html');
  const compact = (page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) < 1024;
  await expect(page.getByText('107.7 bpm')).toHaveCount(1, { timeout: 15_000 });

  // An impatient creator asks for a second alternative before accepting the
  // first. Only the newest proposal may remain actionable on the timeline.
  if (compact) await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await page.getByRole('button', { name: 'Swap 2' }).click();
  if (compact) await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByLabel('Proposal clip 2 take B changed')).toBeVisible();
  if (compact) await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await page.getByLabel('Ask the edit agent').fill('swap 1');
  await page.keyboard.press('Enter');
  if (compact) await page.getByRole('button', { name: 'Timeline', exact: true }).click();

  await expect(page.getByRole('group', { name: 'Agent proposal timeline' })).toHaveCount(1);
  await expect(page.getByLabel('Proposal clip 1 take A changed')).toBeVisible();
  await expect(page.getByLabel('Current clip 1 take B')).toBeVisible();
  await expect(page.getByLabel('Current clip 2 take A')).toBeVisible();

  await page
    .getByTestId('shared-plan-timeline')
    .getByRole('button', { name: 'Dismiss', exact: true })
    .click();
  await expect(page.getByRole('group', { name: 'Agent proposal timeline' })).toHaveCount(0);
  await expect(page.getByLabel('Current clip 1 take B')).toBeVisible();
  await expect(page.getByLabel('Current clip 2 take A')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('a creator and NodeAgent manipulate the same selected timeline blocks', async ({ page }) => {
  await page.goto('/edit.html');
  const compact = (page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) < 1024;
  await expect(page.getByText('107.7 bpm')).toHaveCount(1, { timeout: 15_000 });
  if (compact) await page.getByRole('button', { name: 'Timeline', exact: true }).click();

  const currentBlocks = page.getByRole('button', { name: /^Current clip \d+ take [AB]$/ });
  await expect(currentBlocks).toHaveCount(5);
  await page.getByRole('button', { name: 'Current clip 2 take A' }).click();
  const commands = page.getByTestId('selected-clip-command-bar');
  await expect(commands).toContainText('Clip #2');
  await expect(commands).toContainText('Take A');

  // Human split: one command creates two source-contiguous real blocks, and
  // Undo restores the original five-block cut.
  await page.getByRole('button', { name: 'Split clip 2 on nearest beat' }).focus();
  await page.keyboard.press('Enter');
  await expect(currentBlocks).toHaveCount(6);
  await expect(page.getByText(/Human · split clip #2 on the beat/i)).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(currentBlocks).toHaveCount(5);

  // Contextual source and boundary edits affect the selected block directly.
  await page.getByRole('button', { name: 'Current clip 2 take A' }).click();
  await page.getByRole('button', { name: 'Swap clip 2 to other take' }).click();
  await expect(page.getByRole('button', { name: 'Current clip 2 take B' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const beforeTrim = await page
    .getByRole('button', { name: 'Current clip 2 take A' })
    .textContent();
  await page.getByRole('button', { name: 'Trim out clip 2 by one beat' }).click();
  await expect(page.getByText(/Human · trimmed out clip #2 by 1 beat/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Current clip 2 take A' })).not.toHaveText(
    beforeTrim ?? '',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();

  // The first and last clips expose honest boundary guards.
  await page.getByRole('button', { name: 'Current clip 0 take A' }).click();
  await expect(page.getByRole('button', { name: 'Trim in clip 0 by one beat' })).toBeDisabled();
  await page.getByRole('button', { name: 'Current clip 4 take A' }).click();
  await expect(page.getByRole('button', { name: 'Trim out clip 4 by one beat' })).toBeDisabled();

  // NodeAgent proposes the exact same split operation against the same row;
  // accepted state does not change until the creator applies it.
  if (compact) await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await page.getByLabel('Ask the edit agent').fill('split 2');
  await page.keyboard.press('Enter');
  if (compact) await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Agent proposal timeline' })).toBeVisible();
  await expect(currentBlocks).toHaveCount(5);
  await expect(page.getByLabel('Proposal clip 3 take A')).toBeVisible();
  await page.getByRole('button', { name: 'Apply to timeline' }).click();
  await expect(currentBlocks).toHaveCount(6);
  await expect(page.getByText(/NodeAgent · Split clip #2 on the beat/)).toBeVisible();

  const geometry = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport + 1);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test('a creator and NodeAgent manipulate the same timed caption block', async ({ page }) => {
  await page.goto('/edit.html');
  const compact = (page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) < 1024;
  await expect(page.getByText('107.7 bpm')).toHaveCount(1, { timeout: 15_000 });
  if (compact) await page.getByRole('button', { name: 'Timeline', exact: true }).click();

  const acceptedCaptions = page.getByRole('button', { name: /^Current caption \d+:/ });
  await expect(acceptedCaptions).toHaveCount(14);
  if (compact) {
    const smallestTarget = await acceptedCaptions.evaluateAll((buttons) => ({
      width: Math.min(...buttons.map((button) => button.getBoundingClientRect().width)),
      height: Math.min(...buttons.map((button) => button.getBoundingClientRect().height)),
    }));
    expect(smallestTarget.width).toBeGreaterThanOrEqual(24);
    expect(smallestTarget.height).toBeGreaterThanOrEqual(24);
  }
  const captionSix = page.getByRole('button', { name: /^Current caption 6: Take that as a sign/ });
  const originalLabel = await captionSix.getAttribute('aria-label');
  await captionSix.click();
  await expect(page.getByTestId('selected-caption-command-bar')).toContainText('Caption #6');
  await expect(page.getByText('Caption selection active')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Current clip 0 take A' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  // Human timing: the same caption moves one bounded beat and Undo restores
  // its exact accepted range.
  await page.getByRole('button', { name: 'Move selected caption earlier by one beat' }).click();
  await expect(captionSix).not.toHaveAttribute('aria-label', originalLabel ?? '');
  await expect(
    page.getByText(/Human · moved caption “Take that as a sign” earlier by 1 beat/i),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(captionSix).toHaveAttribute('aria-label', originalLabel ?? '');

  // Canvas direct manipulation uses the selected caption from Timeline and
  // commits a real pointer drag through the same bounded history.
  if (compact) await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  const overlayBox = page.getByTestId('overlay-box').filter({ hasText: 'Take that as a sign' });
  await expect(overlayBox).toBeVisible();
  const beforeDrag = await overlayBox.boundingBox();
  if (!beforeDrag) throw new Error('Selected caption has no rendered box');
  await page.mouse.move(beforeDrag.x + beforeDrag.width / 2, beforeDrag.y + beforeDrag.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    beforeDrag.x + beforeDrag.width / 2 + 14,
    beforeDrag.y + beforeDrag.height / 2 - 8,
    { steps: 4 },
  );
  await page.mouse.up();
  if (compact) await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByText(/Human · adjusted caption position/i)).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();

  // NodeAgent proposes against the same accepted overlay ID. The current lane
  // is unchanged until Apply, then the exact block is labelled and undoable.
  if (compact) await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await page.getByLabel('Ask the edit agent').fill('move caption 6 earlier 1 beat');
  await page.keyboard.press('Enter');
  if (compact) await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Agent caption change map' })).toContainText(
    'EARLIER 1 BEAT',
  );
  await expect(captionSix).toHaveAttribute('aria-label', originalLabel ?? '');
  await expect(page.getByLabel(/^Proposal caption 6: Take that as a sign.*changed$/)).toBeVisible();
  await page.getByRole('button', { name: 'Apply to timeline' }).click();
  await expect(captionSix).not.toHaveAttribute('aria-label', originalLabel ?? '');
  await expect(captionSix).toHaveAttribute('aria-describedby', /overlay-agent-label-/);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(captionSix).toHaveAttribute('aria-label', originalLabel ?? '');
  await expect(page.getByText('AI MOVED', { exact: true })).toHaveCount(0);

  // Adversarial boundary: caption #1 cannot move before frame zero and the
  // accepted range does not mutate.
  await page.getByRole('button', { name: /^Current caption 1: Wait a minute/ }).click();
  const firstLabel = await page
    .getByRole('button', { name: /^Current caption 1: Wait a minute/ })
    .getAttribute('aria-label');
  await page.getByRole('button', { name: 'Move selected caption earlier by one beat' }).click();
  await expect(page.getByRole('alert')).toContainText('leave the accepted timeline');
  await expect(
    page.getByRole('button', { name: /^Current caption 1: Wait a minute/ }),
  ).toHaveAttribute('aria-label', firstLabel ?? '');

  const geometry = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport + 1);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test('ripple duplicate and delete keep every timed track behind one accepted timeline', async ({
  page,
}) => {
  await page.goto('/edit.html');
  const compact = (page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) < 1024;
  await expect(page.getByText('107.7 bpm')).toHaveCount(1, { timeout: 15_000 });
  if (compact) await page.getByRole('button', { name: 'Timeline', exact: true }).click();

  const preview = page.getByTestId('plan-preview');
  const blocks = page.getByRole('button', { name: /^Current clip \d+ take [AB]$/ });
  await expect(preview).toHaveAttribute('data-duration-frames', '1335');
  await expect(blocks).toHaveCount(5);
  await page.getByRole('button', { name: 'Current clip 2 take A' }).click();
  await expect(page.getByRole('button', { name: 'Duplicate clip 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete clip 2' })).toBeVisible();

  // Keyboard Duplicate uses the same command as the contextual button and
  // extends the accepted plan by the selected 109-frame interval.
  await page.keyboard.press('Control+d');
  await expect(blocks).toHaveCount(6);
  await expect(preview).toHaveAttribute('data-duration-frames', '1444');
  await expect(
    page.getByText(/Human · duplicated clip #2 with a full timeline ripple/i),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(blocks).toHaveCount(5);
  await expect(preview).toHaveAttribute('data-duration-frames', '1335');

  // Backspace removes the selected interval across the full plan; Undo
  // restores the exact duration and source-block count.
  await page.getByRole('button', { name: 'Current clip 2 take A' }).click();
  await page.keyboard.press('Backspace');
  await expect(blocks).toHaveCount(4);
  await expect(preview).toHaveAttribute('data-duration-frames', '1226');
  await expect(
    page.getByText(/Human · deleted clip #2 with a full timeline ripple/i),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(blocks).toHaveCount(5);
  await expect(preview).toHaveAttribute('data-duration-frames', '1335');

  // NodeAgent receives the same typed operation. Its six-block result stays
  // pending and the accepted duration remains unchanged until Apply.
  if (compact) await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await page.getByLabel('Ask the edit agent').fill('duplicate 2');
  await page.keyboard.press('Enter');
  if (compact) await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Agent proposal timeline' })).toBeVisible();
  await expect(page.getByLabel('Proposal clip 3 take A changed')).toBeVisible();
  await expect(blocks).toHaveCount(5);
  await expect(preview).toHaveAttribute('data-duration-frames', '1335');
  await page.getByRole('button', { name: 'Apply to timeline' }).click();
  await expect(blocks).toHaveCount(6);
  await expect(preview).toHaveAttribute('data-duration-frames', '1444');
  await expect(
    page.getByText(/NodeAgent · Duplicate clip #2 with a full timeline ripple/),
  ).toBeVisible();

  const geometry = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport + 1);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test('agent proposals explain which real blocks are sourced, inserted, removed, and shifted', async ({
  page,
}) => {
  await page.goto('/edit.html');
  const compact = (page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) < 1024;
  await expect(page.getByText('107.7 bpm')).toHaveCount(1, { timeout: 15_000 });
  if (compact) await page.getByRole('button', { name: 'Agent', exact: true }).click();

  await page.getByLabel('Ask the edit agent').fill('duplicate 2');
  await page.keyboard.press('Enter');
  if (compact) await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  const duplicateMap = page.getByRole('group', { name: 'Agent change map' });
  await expect(duplicateMap).toContainText('A #2 · SOURCE');
  await expect(duplicateMap).toContainText('A #3 · + COPY');
  await expect(duplicateMap).toContainText('+3.6s');
  await expect(page.getByLabel(/Proposal clip 2 take A changed · SOURCE/)).toBeVisible();
  await expect(page.getByLabel(/Proposal clip 3 take A changed · \+ COPY/)).toBeVisible();

  await page.getByRole('button', { name: 'Apply to timeline' }).click();
  await expect(page.getByText('AI ADDED', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Current clip 3 take A' })).toHaveAttribute(
    'aria-describedby',
    /clip-agent-label-/,
  );
  await expect(page.getByText(/NodeAgent · Duplicate clip #2/)).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('AI ADDED', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/NodeAgent · Duplicate clip #2/)).toHaveCount(0);
  await expect(page.getByText('Clip #2 selected')).toBeVisible();

  if (compact) await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await page.getByLabel('Ask the edit agent').fill('delete 2');
  await page.keyboard.press('Enter');
  if (compact) await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  const deleteMap = page.getByRole('group', { name: 'Agent change map' });
  await expect(deleteMap).toContainText('A #2 · − REMOVE');
  await expect(deleteMap).toContainText('B #2 · SHIFT LEFT');
  await expect(deleteMap).toContainText('−3.6s');
  await expect(page.getByLabel(/Proposal clip 2 take B changed · SHIFT LEFT/)).toBeVisible();

  await page.getByRole('button', { name: 'Apply to timeline' }).click();
  await expect(page.getByText('AI SHIFTED', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Current clip 2 take B' })).toHaveAttribute(
    'aria-describedby',
    /clip-agent-label-/,
  );
  await expect(page.getByText(/NodeAgent · Delete clip #2/)).toBeVisible();

  const geometry = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport + 1);
  const accessibility = await new AxeBuilder({ page }).analyze();
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

  // Produce the artifact from accepted edits, not the untouched fixture: the
  // agent doubles the real source interval and the human rewrites the caption.
  await page.getByLabel('Ask the edit agent').fill('duplicate 0');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('group', { name: 'Agent proposal timeline' })).toBeVisible();
  await page.getByRole('button', { name: 'Apply to timeline' }).click();
  await expect(page.getByTestId('plan-preview')).toHaveAttribute('data-duration-frames', '60');
  await page.getByRole('button', { name: 'Edit overlays' }).click();
  await page.getByTestId('overlay-box').first().dispatchEvent('pointerdown');
  await page.getByLabel('Overlay text').fill('PROOF CUT');
  await page.getByLabel('Overlay text').press('Enter');
  await expect(page.getByTestId('overlay-box').first()).toHaveText('PROOF CUT');
  await page.getByRole('button', { name: 'Done editing overlays' }).click();

  const wasm = await page.request.get('/ffmpeg/0.12.10/mt/ffmpeg-core.wasm');
  expect(wasm.ok()).toBe(true);
  expect(wasm.headers()['content-type']).toContain('application/wasm');

  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));

  // Cancellation must tear down an active WASM job without emitting a partial
  // file, and the same UI must be immediately reusable for a clean retry.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByLabel('MP4 export progress')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel MP4 export' }).click();
  await expect(page.getByTestId('browser-export-status')).toContainText(
    'Export cancelled. No partial file was downloaded.',
  );
  expect(downloads).toEqual([]);

  const downloadStarted = page
    .waitForEvent('download', { timeout: 220_000 })
    .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  await page.getByRole('button', { name: 'Export', exact: true }).click();
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

  // Inspect the actual downloaded pixels and stream metadata. The accepted
  // two-second duration and rewritten caption must survive the WASM encoder.
  const probe = JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_name,width,height,codec_type',
        '-of',
        'json',
        downloadPath,
      ],
      { encoding: 'utf8' },
    ),
  ) as {
    format: { duration: string };
    streams: Array<{ codec_name: string; codec_type: string; width?: number; height?: number }>;
  };
  expect(Number(probe.format.duration)).toBeCloseTo(2, 1);
  expect(probe.streams).toEqual([
    expect.objectContaining({ codec_name: 'h264', codec_type: 'video', width: 180, height: 320 }),
  ]);
  const proofFrame = testInfo.outputPath('accepted-proof-frame.png');
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-ss',
    '0.4',
    '-i',
    downloadPath,
    '-frames:v',
    '1',
    '-vf',
    'scale=720:1280:flags=lanczos',
    '-y',
    proofFrame,
  ]);
  const ocr = execFileSync('tesseract', [proofFrame, 'stdout', '--psm', '11'], {
    encoding: 'utf8',
  });
  expect(ocr.toUpperCase()).toContain('PROOF CUT');
  await testInfo.attach('accepted edited export frame', {
    path: proofFrame,
    contentType: 'image/png',
  });
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
  const compact = (page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) < 1024;
  await expect(page.getByText('107.7 bpm')).toHaveCount(1, { timeout: 15_000 });
  if (compact) await page.getByRole('button', { name: 'Agent', exact: true }).click();

  // Enter a session key: badge flips to the in-browser mode, honestly labeled.
  await page.getByText(/Agent settings/).click();
  await page.getByLabel('OpenRouter API key').fill('sk-or-test-not-a-real-key');
  await expect(page.getByText('Browser model')).toBeVisible();

  await page.getByLabel('Ask the edit agent').fill('swap clip 1 to the other take');
  await page.keyboard.press('Enter');

  // The tool call is rendered, the prose lands, and the proposal is a real
  // applyable patch — same contract as the local rules and the worker.
  await page.getByText(/History · 2 messages/).click();
  await expect(page.getByText('swap_clip_source')).toBeVisible();
  await expect(page.getByText('apply the patch to make it real')).toBeVisible();
  const apply = page.getByRole('button', { name: 'Apply patch' });
  await expect(apply).toBeVisible();
  await apply.click();
  await expect(page.getByRole('button', { name: 'Patch applied' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  expect(calls).toBe(2);

  // The key never persists past the session store: reload in a fresh context
  // is out of scope here, but the input must be masked in the DOM.
  await expect(page.getByLabel('OpenRouter API key')).toHaveAttribute('type', 'password');
});

test('model proposals allow exactly one mutation per approval card', async ({ page }) => {
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
                      id: 'call_duplicate',
                      type: 'function',
                      function: { name: 'duplicate_clip', arguments: '{"clipIndex":0}' },
                    },
                    {
                      id: 'call_move_caption',
                      type: 'function',
                      function: {
                        name: 'move_overlay',
                        arguments: '{"overlayId":"overlay.lyric.06","beats":-1}',
                      },
                    },
                  ],
                },
              },
            ],
          }
        : { choices: [{ message: { content: 'One edit is ready for review.' } }] };
    await route.fulfill({ json: body });
  });

  await page.goto('/edit.html');
  const compact = (page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) < 1024;
  await expect(page.getByText('107.7 bpm')).toHaveCount(1, { timeout: 15_000 });
  if (compact) await page.getByRole('button', { name: 'Agent', exact: true }).click();

  await page.getByText(/Agent settings/).click();
  await page.getByLabel('OpenRouter API key').fill('sk-or-test-not-a-real-key');
  await page.getByLabel('Ask the edit agent').fill('duplicate clip 0 and move caption 6 earlier');
  await page.keyboard.press('Enter');
  await page.getByText(/History/).click();
  await expect(page.getByText('duplicate_clip')).toBeVisible();
  await page.getByText('move_overlay').click();
  await expect(page.getByText(/one_edit_per_proposal/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply patch' })).toHaveCount(1);
  expect(calls).toBe(2);
});

test('a sustained local-agent session keeps visible history bounded', async ({ page }) => {
  await page.goto('/edit.html');
  const compact = (page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) < 1024;
  await expect(page.getByText('107.7 bpm')).toHaveCount(1, { timeout: 15_000 });
  if (compact) await page.getByRole('button', { name: 'Agent', exact: true }).click();

  // A sustained local-agent session retains only the eight most recent
  // exchanges (16 rendered turns), preventing unbounded UI state growth.
  const composer = page.getByLabel('Ask the edit agent');
  for (let exchange = 0; exchange < 10; exchange += 1) {
    await composer.fill(`show the cuts follow-up ${exchange + 1}`);
    await page.keyboard.press('Enter');
  }
  await expect(page.getByText(/History.*16 messages/)).toBeVisible();
});
