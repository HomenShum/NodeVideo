import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { ConvexHttpClient } from 'convex/browser';
import { type Page, expect, test } from 'playwright/test';
import { api } from '../../convex/_generated/api';

function convexUrl() {
  if (process.env.NODEVIDEO_CONVEX_URL) return process.env.NODEVIDEO_CONVEX_URL;
  if (!existsSync('.env.local')) return null;
  const match = /^VITE_CONVEX_URL=(.+)$/mu.exec(readFileSync('.env.local', 'utf8'));
  return match?.[1]?.trim() || null;
}

async function startCreatorWithDemo(page: Page, template?: string) {
  await page.goto('/creator.html');
  await expect(page.getByRole('heading', { name: 'What are you trying to make?' })).toBeVisible();
  await expect(page.getByText('execution graph')).toHaveCount(0);
  await expect(page.getByText('provider configuration')).toHaveCount(0);
  if (template) await page.getByRole('button', { name: new RegExp(template, 'iu') }).click();
  await page.getByRole('button', { name: 'Use rights-cleared demo' }).click();
  await expect(page.getByText(/nodevideo-demo\.mp4 · ready in this browser/u)).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: /Start creating/u }).click();
  if ((page.viewportSize()?.width ?? 1000) <= 760) {
    await page.getByRole('button', { name: 'Agent', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'NodeAgent' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('current-action')).toBeVisible();
}

test('creator pipeline compiles one source into reviewable variants', async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await startCreatorWithDemo(page);

  const deploymentConfig = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  };
  const creatorCsp = deploymentConfig.headers
    .find(({ source }) => source === '/creator(\\.html)?')
    ?.headers.find(({ key }) => key === 'Content-Security-Policy')?.value;
  expect(creatorCsp).toContain('https://*.convex.cloud');
  expect(creatorCsp).toContain('wss://*.convex.cloud');

  if ((page.viewportSize()?.width ?? 1000) <= 760) {
    await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  }
  await expect(page.getByText('Primary video artifact')).toBeVisible();
  await expect(page.getByTestId('video-canvas')).toBeVisible();
  if ((page.viewportSize()?.width ?? 1000) <= 760) {
    await page.getByRole('button', { name: 'Agent', exact: true }).click();
  }
  await expect(page.getByText('Private media collaborator')).toBeVisible();

  await page.getByRole('button', { name: 'Send message' }).click();
  if ((page.viewportSize()?.width ?? 1000) > 760) {
    await expect(
      page.getByText('2 variants compiled from one shared MediaIndex. Review before export.'),
    ).toBeVisible();
  }
  await expect(page.getByTestId('agent-tool-activity')).toBeVisible();
  await expect(page.getByTestId('agent-proposal-card')).toBeVisible();

  const evidenceDir = '.qa/evidence/creator-pipeline';
  mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({
    path: `${evidenceDir}/${testInfo.project.name}-agent-chat.png`,
    fullPage: true,
  });

  if ((page.viewportSize()?.width ?? 1000) <= 760) {
    await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  }
  await expect(page.getByTestId('artifact-timeline')).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Artifact stage' })
      .getByRole('heading', { name: 'launch landscape' }),
  ).toBeVisible();

  if ((page.viewportSize()?.width ?? 1000) <= 760) {
    await page
      .getByRole('navigation', { name: 'Creator workspace surfaces' })
      .getByRole('button', { name: 'Review', exact: true })
      .click();
  } else {
    await page.getByRole('button', { name: 'Proposal', exact: true }).click();
  }

  const exportButton = page.getByRole('button', { name: 'Export local MP4' });
  await expect(exportButton).toBeDisabled();
  await page.getByRole('button', { name: 'Approve exact variant' }).click();
  await expect(exportButton).toBeEnabled();
  if ((page.viewportSize()?.width ?? 1000) > 760) {
    await expect(page.getByText('Project v2')).toBeVisible();
  }

  await page.getByRole('button', { name: 'Run Inspector', exact: true }).click();
  await expect(page.getByText('Run Inspector · technical proof')).toBeVisible();
  await page.getByRole('button', { name: 'Proof', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download EditPlan v2' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('launch-landscape-edit-plan-v2.json');
  const downloadedPlan = JSON.parse(readFileSync(await download.path(), 'utf8')) as {
    approvals: Array<{ status: string }>;
  };
  expect(downloadedPlan.approvals.every((approval) => approval.status === 'approved')).toBe(true);

  const receiptPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download run receipt' }).click();
  const receiptDownload = await receiptPromise;
  const receipt = JSON.parse(readFileSync(await receiptDownload.path(), 'utf8')) as {
    schemaVersion: string;
    status: string;
    limitations: string[];
  };
  expect(receipt).toMatchObject({
    schemaVersion: 'nodevideo.creator-run-receipt.v1',
    status: 'accepted',
  });
  expect(receipt.limitations).toContain('Browser export omits audio.');

  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    offenders: [...document.querySelectorAll<HTMLElement>('body *')]
      .filter(
        (element) =>
          element.getBoundingClientRect().right > document.documentElement.clientWidth + 1,
      )
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        right: element.getBoundingClientRect().right,
        width: element.getBoundingClientRect().width,
      })),
  }));
  expect(dimensions.scrollWidth, JSON.stringify(dimensions.offenders)).toBeLessThanOrEqual(
    dimensions.clientWidth + 1,
  );
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  expect(pageErrors).toEqual([]);

  await page.screenshot({ path: `${evidenceDir}/${testInfo.project.name}.png`, fullPage: true });
});

test('creator topology keeps the artifact dominant and mobile surfaces mode-based', async ({
  page,
}, testInfo) => {
  const evidenceDir = '.qa/evidence/creator-topology';
  mkdirSync(evidenceDir, { recursive: true });
  await page.goto('/creator.html');
  await expect(page.getByRole('heading', { name: 'What are you trying to make?' })).toBeVisible();
  await expect(page.getByTestId('caseflow-progress')).toHaveCount(0);
  await expect(page.getByText(/executor\.local/u)).toHaveCount(0);
  await page.screenshot({ path: `${evidenceDir}/${testInfo.project.name}-first-arrival.png` });

  await page.getByRole('button', { name: 'Use rights-cleared demo' }).click();
  await expect(page.getByText(/nodevideo-demo\.mp4 · ready in this browser/u)).toBeVisible();
  await page.getByRole('button', { name: /Start creating/u }).click();

  const mobile = (page.viewportSize()?.width ?? 1000) <= 760;
  const actionBox = await page.getByTestId('current-action').boundingBox();
  expect(actionBox?.y ?? 999).toBeLessThan(150);
  if (mobile) {
    await expect(
      page.getByRole('navigation', { name: 'Creator workspace surfaces' }),
    ).toBeVisible();
    await expect(page.getByTestId('video-canvas')).toBeVisible();
    await page.screenshot({ path: `${evidenceDir}/${testInfo.project.name}-canvas.png` });
    await page.getByRole('button', { name: 'Agent', exact: true }).click();
  } else {
    const artifact = await page.getByRole('region', { name: 'Artifact stage' }).boundingBox();
    expect((artifact?.width ?? 0) / (page.viewportSize()?.width ?? 1)).toBeGreaterThan(0.55);
  }

  await expect(page.getByRole('heading', { name: 'NodeAgent' })).toBeVisible();
  await expect(page.getByLabel('Executor route')).toBeHidden();
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByTestId('agent-proposal-card')).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/${testInfo.project.name}-agent.png` });

  if (mobile) {
    await page
      .getByRole('navigation', { name: 'Creator workspace surfaces' })
      .getByRole('button', { name: 'Review', exact: true })
      .click();
  } else {
    await page.getByRole('button', { name: 'Proposal', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Approve exact variant' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export local MP4' })).toBeDisabled();
  await page.screenshot({ path: `${evidenceDir}/${testInfo.project.name}-review.png` });

  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    offenders: [...document.querySelectorAll<HTMLElement>('body *')]
      .filter(
        (element) =>
          element.getBoundingClientRect().right > document.documentElement.clientWidth + 1,
      )
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        right: element.getBoundingClientRect().right,
        width: element.getBoundingClientRect().width,
      })),
  }));
  expect(dimensions.scrollWidth, JSON.stringify(dimensions.offenders)).toBeLessThanOrEqual(
    dimensions.clientWidth + 1,
  );
});

test('creator pipeline exposes cleanup and quote workflows', async ({ page }) => {
  await startCreatorWithDemo(page, 'Golden quote campaign');
  await expect(page.getByLabel('Message NodeAgent')).toHaveValue(
    /strongest source-grounded quote/u,
  );
  await page.getByRole('button', { name: 'Send message' }).click();
  if ((page.viewportSize()?.width ?? 1000) > 760) {
    await expect(
      page.getByText('3 variants compiled from one shared MediaIndex. Review before export.'),
    ).toBeVisible();
  }
  if ((page.viewportSize()?.width ?? 1000) <= 760) {
    await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  }
  const stage = page.getByRole('region', { name: 'Artifact stage' });
  await expect(stage.getByRole('heading', { name: 'golden short' })).toBeVisible();
  await expect(stage.getByRole('tab', { name: /social square/u })).toBeVisible();
  await expect(stage.getByRole('tab', { name: /long cut/u })).toBeVisible();
});

test('agent rail gates cloud execution and supports inline proposal decisions', async ({
  page,
}, testInfo) => {
  await startCreatorWithDemo(page);

  await page.getByLabel('Agent write scope').click();
  await page.getByRole('option', { name: 'All variants' }).click();
  await page.getByText('Routing', { exact: true }).click();
  await page.getByLabel('Executor route').click();
  await page.getByRole('option', { name: 'Higgsfield · gated' }).click();
  await expect(page.getByText(/cost and egress approval required/u)).toBeVisible();
  await page.getByRole('button', { name: 'Send message' }).click();

  await expect(page.getByText(/Higgsfield is only a proposed executor/u)).toBeVisible();
  await expect(page.getByTestId('executor-proposal-card')).toContainText('7.5 credits');
  await expect(page.getByTestId('executor-proposal-card')).toContainText('nodevideo-demo.mp4');
  await page.getByRole('button', { name: 'Approve exact 7.5 credits' }).click();
  if ((page.viewportSize()?.width ?? 1000) > 760) {
    await expect(page.getByText(/No job was submitted and no credits were spent/u)).toBeVisible();
  } else {
    await expect(page.getByTestId('executor-proposal-card')).toContainText('approved');
  }
  const executorEvidenceDir = '.qa/evidence/creator-executor';
  mkdirSync(executorEvidenceDir, { recursive: true });
  await page.screenshot({
    path: `${executorEvidenceDir}/${testInfo.project.name}-exact-quote-approved-no-submit.png`,
    fullPage: true,
  });
  await expect(
    page.getByText(/proposal-only · Higgsfield gated · all campaign variants/u),
  ).toBeVisible();
  await page.getByTestId('agent-proposal-card').getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByText('revision requested', { exact: true })).toBeVisible();
  await expect(
    page.getByTestId('agent-proposal-card').getByRole('button', { name: 'Accept' }),
  ).toBeDisabled();
  await page
    .getByLabel('Message NodeAgent')
    .fill('Revise the founder launch proposal while preserving the approved source scope.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(/Higgsfield is only a proposed executor/u)).toHaveCount(2);
  await page.getByTestId('agent-proposal-card').getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByText('Project v2')).toHaveText('Project v2');
  await expect(page.getByText('approved', { exact: true })).toBeVisible();
});

test('live OpenRouter free planner resolves a model before deterministic compilation', async ({
  page,
}) => {
  test.skip(
    process.env.NODEVIDEO_LIVE_FREE_ROUTER !== '1',
    'Live free-router proof is opt-in and runs only against the configured production endpoint.',
  );
  await startCreatorWithDemo(page);
  await page.getByText('Routing', { exact: true }).click();
  await page.getByLabel('Executor route').click();
  await page.getByRole('option', { name: 'OpenRouter Free · external' }).click();
  await expect(page.getByText(/prompt and transcript context leave this device/u)).toBeVisible();
  await page
    .getByLabel('Message NodeAgent')
    .fill(
      'Create a 30-second founder launch cut around the strongest source-grounded quote. Preserve meaning and identify the exact human review points.',
    );
  await page.getByRole('checkbox', { name: /Consent to send prompt/u }).check();
  const sendButton = page.getByRole('button', { name: 'Send message' });
  await expect(sendButton).toBeEnabled({ timeout: 30_000 });
  await sendButton.click();
  await expect(page.getByText(/planned · openrouter\/free →/u)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId('agent-proposal-card')).toBeVisible();
  await expect(page.getByText('Project v1')).toHaveText('Project v1');
});

test('creator template selection and restore are real state transitions', async ({ page }) => {
  await startCreatorWithDemo(page, 'Golden quote campaign');
  await expect(page.getByLabel('Message NodeAgent')).toHaveValue(
    /strongest source-grounded quote/u,
  );
  await page.getByRole('button', { name: 'Send message' }).click();
  if ((page.viewportSize()?.width ?? 1000) > 760) {
    await expect(
      page.getByText('3 variants compiled from one shared MediaIndex. Review before export.'),
    ).toBeVisible();
  }
  await expect(page.getByTestId('agent-tool-activity')).toBeVisible();
  await expect(page.getByTestId('agent-proposal-card')).toBeVisible();
  await page.getByRole('button', { name: 'Proposal', exact: true }).click();
  await page.getByRole('button', { name: 'Approve exact variant' }).click();
  await page.getByRole('button', { name: 'Restore draft' }).click();
  if ((page.viewportSize()?.width ?? 1000) > 760) {
    await expect(page.getByText('Project v2')).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Approve exact variant' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Export local MP4' })).toBeDisabled();
});

test('two sessions react to the same Caseflow and stale approval fails closed', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One two-session proof is sufficient.');
  const backendUrl = convexUrl();
  test.skip(
    !backendUrl,
    'Caseflow proof requires NODEVIDEO_CONVEX_URL or a local VITE_CONVEX_URL.',
  );
  if (!backendUrl) return;
  const baseURL = testInfo.project.use.baseURL as string;
  const contextA = await browser.newContext({ baseURL });
  const pageA = await contextA.newPage();
  await startCreatorWithDemo(pageA);
  await pageA.getByRole('button', { name: 'Send message' }).click();
  await expect(pageA.getByTestId('agent-proposal-card')).toBeVisible();

  const locator = JSON.parse(
    (await pageA.evaluate(() => localStorage.getItem('nodevideo.creator.caseflow-locator.v1'))) ??
      'null',
  );
  expect(locator?.caseId).toBeTruthy();
  const client = new ConvexHttpClient(backendUrl);
  const initial = await client.query(api.caseflow.getCampaign, {
    caseId: locator.caseId,
    ownerKey: locator.ownerKey,
  });
  const firstProposal = initial.proposals.sort((a, b) => a.createdAt - b.createdAt)[0];
  expect(firstProposal).toBeTruthy();
  const secondProposal = await client.mutation(api.caseflow.createEditProposal, {
    caseId: locator.caseId,
    ownerKey: locator.ownerKey,
    runId: locator.runId,
    expectedArtifactVersion: 1,
    snapshot: { schemaVersion: 'nodevideo.test-proposal/v1', variant: 'heldout-second' },
    planningReceipt: {
      requestedRoute: 'local/deterministic',
      resolvedProvider: 'nodevideo',
      resolvedModel: 'caseflow-test',
      promptDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      inputScope: {
        prompt: true,
        transcript: false,
        sourceMetadata: false,
        rawMediaUploaded: false,
      },
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      latencyMs: 0,
      result: 'proposal_created',
    },
  });

  const contextB = await browser.newContext({ baseURL });
  await contextB.addInitScript(
    ({ value }) => localStorage.setItem('nodevideo.creator.caseflow-locator.v1', value),
    { value: JSON.stringify(locator) },
  );
  const pageB = await contextB.newPage();
  await pageB.goto('/creator.html');
  await expect(pageB.getByText('Project v1')).toBeVisible();
  await client.mutation(api.caseflow.decideProposal, {
    caseId: locator.caseId,
    ownerKey: locator.ownerKey,
    runId: locator.runId,
    proposalId: secondProposal.proposalId,
    expectedDigest: secondProposal.proposalDigest,
    decision: 'approved',
    actorRef: 'browser-b',
  });
  await expect(pageB.getByText('Project v2')).toBeVisible();
  const replay = await client.mutation(api.caseflow.decideProposal, {
    caseId: locator.caseId,
    ownerKey: locator.ownerKey,
    runId: locator.runId,
    proposalId: secondProposal.proposalId,
    expectedDigest: secondProposal.proposalDigest,
    decision: 'approved',
    actorRef: 'browser-b',
  });
  expect(replay.reused).toBe(true);
  const staleDecision = await client.mutation(api.caseflow.decideProposal, {
    caseId: locator.caseId,
    ownerKey: locator.ownerKey,
    runId: locator.runId,
    proposalId: firstProposal._id,
    expectedDigest: firstProposal.payloadDigest,
    decision: 'approved',
    actorRef: 'browser-a',
  });
  expect(staleDecision).toMatchObject({ applied: false, conflicted: true, version: 2 });
  const finalState = await client.query(api.caseflow.getCampaign, {
    caseId: locator.caseId,
    ownerKey: locator.ownerKey,
  });
  expect(finalState.case.currentArtifactVersion).toBe(2);
  expect(finalState.timeline.some((entry) => entry.kind === 'proposal.conflicted')).toBe(true);
  await expect(pageA.getByText('Project v2')).toBeVisible();
  await expect(pageA.getByText(/Stale proposal rejected/u)).toBeVisible();
  await pageB.reload();
  await expect(pageB.getByText('Project v2')).toBeVisible();
  await expect(pageB.getByText(/I analyzed the source once/u)).toBeVisible();
  const evidenceDir = '.qa/evidence/creator-two-session';
  mkdirSync(evidenceDir, { recursive: true });
  await pageA.screenshot({ path: `${evidenceDir}/browser-a-stale-rejected.png`, fullPage: true });
  await pageB.screenshot({ path: `${evidenceDir}/browser-b-reload-preserved.png`, fullPage: true });
  await contextA.close();
  await contextB.close();
});

test('approved creator variant exports a real local H.264 MP4', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One codec smoke is sufficient.');
  await page.goto('/creator.html');
  await page
    .locator('input[type="file"]')
    .setInputFiles(
      fileURLToPath(
        new URL(
          '../../fixtures/media/song-conditioned-auto-edit-v1/creator-take-a.mp4',
          import.meta.url,
        ),
      ),
    );
  await expect(page.getByText(/creator-take-a\.mp4 · ready in this browser/u)).toBeVisible();
  await page.getByRole('button', { name: /Start creating/u }).click();
  await expect(page.getByRole('heading', { name: 'NodeAgent' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(
    page.getByText('2 variants compiled from one shared MediaIndex. Review before export.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Proposal', exact: true }).click();
  await page.getByRole('button', { name: 'Approve exact variant' }).click();

  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Export local MP4' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('launch-landscape.mp4');
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = readFileSync(path ?? '');
  expect(bytes.subarray(4, 8).toString('ascii')).toBe('ftyp');
});
