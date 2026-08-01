import { describe, expect, test } from 'vitest';
import { decideCreatorAutoApproval } from './creator-autonomy';

describe('Creator Auto mode risk boundary', () => {
  test('a first-time creator gets a reversible local single-variant edit without an approval ceremony', () => {
    expect(
      decideCreatorAutoApproval({
        mode: 'auto-safe',
        route: 'auto',
        scope: 'selected-variant',
        pendingMeaningApprovals: 0,
      }),
    ).toMatchObject({ action: 'apply' });
  });

  test.each([
    ['external model egress', 'openrouter-free', 'selected-variant', 0],
    ['paid media executor', 'higgsfield', 'selected-variant', 0],
    ['campaign-wide mutation', 'local', 'campaign-variants', 0],
    ['meaning-sensitive removal', 'local', 'selected-variant', 2],
  ] as const)('keeps %s reviewable in default Auto mode', (_scenario, route, scope, pending) => {
    expect(
      decideCreatorAutoApproval({
        mode: 'auto-safe',
        route,
        scope,
        pendingMeaningApprovals: pending,
      }),
    ).toMatchObject({ action: 'review' });
  });

  test('an expert choosing Ask mode keeps an otherwise safe local edit pending', () => {
    expect(
      decideCreatorAutoApproval({
        mode: 'ask',
        route: 'local',
        scope: 'selected-variant',
        pendingMeaningApprovals: 0,
      }),
    ).toEqual({ action: 'review', reason: 'Ask mode keeps every proposal pending.' });
  });
});
