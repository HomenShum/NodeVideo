// The load-bearing case is mislabelling: a generated mockup presented as the running application.
// It is the easy mistake because the mockup looks better than the real product.

import { describe, expect, it } from 'vitest';
import { evaluateFrameEvidence, formatFrameEvidence, parseFrameSet, type Frame } from './frame-evidence';

const hash = (c: string) => c.repeat(64);

const live = (over: Partial<Frame> = {}): Frame => ({
  frameId: 'f-live-1',
  kind: 'live-product',
  presentedAs: 'live-product',
  sha256: hash('a'),
  shotId: 'shot-2',
  bindings: {
    deploymentRevision: 'abc1234',
    browserTraceId: 'trace-9',
    journeyState: 'populated',
    screenshotSha256: hash('a'),
  },
  ...over,
});

const generated = (over: Partial<Frame> = {}): Frame => ({
  frameId: 'f-gen-1',
  kind: 'generated-illustration',
  presentedAs: 'generated-illustration',
  sha256: hash('b'),
  shotId: 'shot-5',
  provenance: { provider: 'local', model: 'sdxl', prompt: 'a calm dashboard', inputAssets: [] },
  ...over,
});

describe('frame evidence', () => {
  it('passes a bound capture beside a labelled illustration', () => {
    const verdict = evaluateFrameEvidence([live(), generated()]);
    expect(verdict.passed).toBe(true);
    expect(verdict.liveProduct).toBe(1);
    expect(verdict.generated).toBe(1);
  });

  it('refuses a generated frame presented as the running application', () => {
    const verdict = evaluateFrameEvidence([generated({ presentedAs: 'live-product' })]);
    expect(verdict.passed).toBe(false);
    expect(verdict.blockers.join(' ')).toMatch(/presented as the running application/);
    expect(verdict.failedShots).toEqual(['shot-5']);
  });

  it.each([...['deploymentRevision', 'browserTraceId', 'journeyState', 'screenshotSha256']])(
    'treats a live frame missing %s as unbound',
    (missing) => {
      const bindings = { ...live().bindings } as Record<string, string>;
      delete bindings[missing];
      const verdict = evaluateFrameEvidence([live({ bindings })]);
      expect(verdict.passed).toBe(false);
      expect(verdict.blockers.join(' ')).toContain(missing);
    },
  );

  it('refuses a screenshot binding that points at a different image', () => {
    const verdict = evaluateFrameEvidence([live({ bindings: { ...live().bindings, screenshotSha256: hash('c') } })]);
    expect(verdict.passed).toBe(false);
    expect(verdict.blockers.join(' ')).toMatch(/does not match the frame's own hash/);
  });

  it.each([...['provider', 'model', 'prompt', 'inputAssets']])(
    'refuses a generated frame missing %s, which makes it unauditable later',
    (missing) => {
      const provenance = { ...generated().provenance } as Record<string, unknown>;
      delete provenance[missing];
      const verdict = evaluateFrameEvidence([generated({ provenance })]);
      expect(verdict.passed).toBe(false);
      expect(verdict.blockers.join(' ')).toContain(missing);
    },
  );

  it('reports zero frames as insufficient rather than as a pass', () => {
    const verdict = evaluateFrameEvidence([]);
    expect(verdict.passed).toBe(false);
    expect(verdict.insufficient).toBe(true);
    expect(formatFrameEvidence(verdict)).toMatch(/nothing was checked/);
  });

  it('refuses a frame nobody hashed, or that never says what it is presented as', () => {
    expect(() => parseFrameSet([live({ sha256: 'nope' })])).toThrow(/needs its own sha256/);
    expect(() => parseFrameSet([{ ...live(), presentedAs: undefined }])).toThrow(/needs presentedAs/);
  });

  it('scopes repair to the shots that actually failed', () => {
    const verdict = evaluateFrameEvidence([live(), generated({ presentedAs: 'live-product' })]);
    expect(verdict.failedShots).toEqual(['shot-5']);
  });
});
