import AxeBuilder from '@axe-core/playwright';
import { type Page, type TestInfo, expect, test } from 'playwright/test';

const canonical = 'https://nodevideo-pi.vercel.app/';
const heading = 'Learn the dance you admire.';

async function capture(page: Page, testInfo: TestInfo, name: string, errors: string[]) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await testInfo.attach(`${name}-dom`, { body: await page.content(), contentType: 'text/html' });
  await testInfo.attach(`${name}-console`, {
    body: JSON.stringify(errors),
    contentType: 'application/json',
  });
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  expect(errors).toEqual([]);
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test('search visitor receives the public explanation in the initial HTML', async ({ request }) => {
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('data-testid="landing"');
  expect(html).toMatch(/<h1\b[^>]*>Learn the dance you admire\.<\/h1>/);
  expect(html).toContain('href="/studio.html"');
  expect(html).toContain('Four ways to use NodeVideo today');
  expect(html).toContain(`rel="canonical" href="${canonical}"`);
});

test('crawler receives a text policy and a sitemap for the public homepage', async ({
  request,
  page,
}) => {
  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(robots.headers()['content-type']).toContain('text/plain');
  expect(await robots.text()).toContain(`Sitemap: ${canonical}sitemap.xml`);
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()['content-type']).toMatch(/xml/);
  const parsed = await page.evaluate(
    (xml) => {
      const document = new DOMParser().parseFromString(xml, 'application/xml');
      return {
        errors: document.querySelectorAll('parsererror').length,
        urls: [...document.querySelectorAll('loc')].map((node) => node.textContent),
      };
    },
    await sitemap.text(),
  );
  expect(parsed).toEqual({ errors: 0, urls: [canonical] });
});

test('visitor with JavaScript unavailable can read the page and follow a keyboard link', async ({
  browser,
  page,
}, testInfo) => {
  const viewport = page.viewportSize();
  const baseURL = testInfo.project.use.baseURL;
  if (!viewport || !baseURL)
    throw new Error('Public visitor proof requires a viewport and baseURL.');
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport,
    reducedMotion: 'reduce',
  });
  try {
    const visitor = await context.newPage();
    const errors = collectErrors(visitor);
    await visitor.goto(baseURL, { waitUntil: 'load' });
    expect(await visitor.getByRole('heading', { name: heading, exact: true }).count()).toBe(1);
    await expect(visitor.locator('.pose-fallback')).toBeVisible();
    await capture(visitor, testInfo, 'no-javascript-landing', errors);
    await visitor.keyboard.press('Tab');
    const studio = visitor.getByRole('link', { name: 'Studio', exact: true });
    await expect(studio).toBeFocused();
    await studio.press('Enter');
    await expect(visitor).toHaveURL(/\/studio(?:\.html)?\/?$/);
  } finally {
    await context.close();
  }
});

test('slow connection shows useful content and a pose before scripts hydrate', async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  let release = () => {};
  const scriptsReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() === 'script') await scriptsReady;
    await route.continue();
  });
  const navigation = page.goto('/', { waitUntil: 'load' });
  try {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.locator('.pose-fallback')).toBeVisible();
    await expect(page.locator('.pose-replay')).toBeHidden();
    await page.evaluate(() => document.fonts.ready);
    await capture(page, testInfo, 'delayed-javascript', errors);
  } finally {
    release();
    await navigation;
  }
  await expect(page.locator('.pose-replay')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.pose-fallback')).toBeHidden();
  await expect(page.getByTestId('landing')).toHaveCount(1);
  await capture(page, testInfo, 'hydrated-landing', errors);
  const audit = await new AxeBuilder({ page }).analyze();
  await testInfo.attach('landing-accessibility', {
    body: JSON.stringify(audit),
    contentType: 'application/json',
  });
  expect(audit.violations).toEqual([]);
});

test('visitor changes motion preferences and returns repeatedly without duplicate hydration', async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  await page.goto('/');
  const ticker = page.locator('[aria-label^="Count "]');
  const canvas = page.locator('.pose-replay');
  await expect(canvas).toHaveAttribute('data-ready', 'true');
  for (let visit = 0; visit < 3; visit++) {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(page.locator('.count-cell[data-live="true"]')).toHaveCount(1);
    const start = await ticker.getAttribute('aria-label');
    await expect.poll(() => ticker.getAttribute('aria-label')).not.toBe(start);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.count-cell[data-live="true"]')).toHaveCount(0);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const steadyCount = await ticker.getAttribute('aria-label');
    const steadyPose = await canvas.evaluate((element) =>
      (element as HTMLCanvasElement).toDataURL(),
    );
    // More than two actual beats: reduced-motion state must stay steady.
    await page.waitForTimeout(1400);
    expect(await ticker.getAttribute('aria-label')).toBe(steadyCount);
    expect(await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).toBe(
      steadyPose,
    );
    await page.getByRole('link', { name: 'Studio', exact: true }).click();
    await expect(page).toHaveURL(/\/studio(?:\.html)?\/?$/);
    await page.goBack();
    await expect(page.getByTestId('landing')).toHaveCount(1);
    await expect(canvas).toHaveAttribute('data-ready', 'true');
  }
  await capture(page, testInfo, 'return-visitor', errors);
});

test('visitor without a canvas context retains the real first pose and public navigation', async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await expect(page.locator('.pose-fallback')).toBeVisible();
  await expect(page.locator('.pose-replay')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Studio', exact: true })).toHaveAttribute(
    'href',
    '/studio.html',
  );
  await capture(page, testInfo, 'canvas-unavailable', errors);
});
