import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseArgs, sanitizePageUrl } from './android-nodevideo-qa.mjs';

describe('Android device QA scenarios', () => {
  test('a first-time family tester stays local unless external routing is explicit', () => {
    expect(parseArgs([])).toMatchObject({
      external: false,
      url: 'https://nodevideo-pi.vercel.app/creator.html',
    });
    expect(parseArgs(['--external'])).toMatchObject({ external: true });
    expect(parseArgs(['--vision'])).toMatchObject({ vision: true, external: false });
  });

  test('an adversarial invocation cannot send the QA journey to another origin', () => {
    expect(() => parseArgs(['--url=https://example.com/creator.html'])).toThrow(
      /Refusing non-production NodeVideo origin/u,
    );
    expect(() => parseArgs(['--cdp=http://192.168.1.9:9222'])).toThrow(
      /Refusing non-local Chrome debugging endpoint/u,
    );
    expect(() => parseArgs(['--unknown'])).toThrow(/Unknown argument/u);
    expect(() => parseArgs(['--external', '--vision'])).toThrow(/one bounded journey/u);
  });

  test('a resumed cross-session capability URL never leaks its case token into receipts', () => {
    expect(
      sanitizePageUrl(
        'https://nodevideo-pi.vercel.app/creator#case=private-case&access=private-access',
      ),
    ).toBe('https://nodevideo-pi.vercel.app/creator');
  });

  test('a family tester can play the rights-cleared demo audio under production CSP', () => {
    const deployment = JSON.parse(readFileSync('vercel.json', 'utf8'));
    const creatorRoutes = deployment.headers.filter(({ source }) => source.startsWith('/creator'));

    expect(creatorRoutes).toHaveLength(2);
    for (const route of creatorRoutes) {
      const csp = route.headers.find(({ key }) => key === 'Content-Security-Policy')?.value;
      expect(csp).toContain("media-src 'self' data: blob:");
    }
  });
});
