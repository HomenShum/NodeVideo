// Deterministic frame checks, run before any model looks at anything.
//
// The rule this exists to enforce: do not judge a clip by watching the finished MP4. A person or a
// vision model reviewing final output is the weakest instrument available and the first one everyone
// reaches for. These checks are cheap, deterministic and bindable, and a model's opinion never
// overturns one of the hard zeros below.
//
// Two frame kinds, and conflating them is the failure:
//
//   live-product  a capture of the real application. Binds to the deployment revision, the browser
//                 trace, the journey state, and its own screenshot hash. Unbound: 0.
//   generated     an illustration. Carries provider, model, prompt and input assets, and may never
//                 be presented as the running application. Mislabelled: 0.
//
// `presentedAs` is what makes the second zero checkable at all. Without a field recording what the
// AUDIENCE is told a frame is, a generated mockup and a real capture are just pixels — and the
// mockup usually looks better, which is why it gets shipped by accident.

export type FrameKind = 'live-product' | 'generated';

export const FRAME_KINDS: readonly FrameKind[] = ['live-product', 'generated'] as const;

export const LIVE_PRODUCT_BINDINGS = [
  'deploymentRevision',
  'browserTraceId',
  'journeyState',
  'screenshotSha256',
] as const;

export const GENERATED_PROVENANCE = ['provider', 'model', 'prompt', 'inputAssets'] as const;

export interface Frame {
  frameId: string;
  kind: FrameKind;
  /** What the viewer is told this frame is. May differ from `kind` — that difference is the fraud. */
  presentedAs: FrameKind;
  sha256: string;
  shotId?: string;
  bindings?: Partial<Record<(typeof LIVE_PRODUCT_BINDINGS)[number], string>>;
  provenance?: {
    provider?: string;
    model?: string;
    prompt?: string;
    inputAssets?: string[];
  };
}

export interface FrameEvidenceVerdict {
  passed: boolean;
  insufficient: boolean;
  blockers: string[];
  checked: number;
  liveProduct: number;
  generated: number;
  /** Shots with at least one blocker, so repair can be scoped to the failed shot only. */
  failedShots: string[];
}

const SHA256 = /^[0-9a-f]{64}$/;
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function parseFrameSet(frames: unknown): Frame[] {
  if (!Array.isArray(frames)) throw new Error('frames must be a list');
  frames.forEach((frame, index) => {
    const at = `frames[${index}]`;
    if (!frame || typeof frame !== 'object') throw new Error(`${at} must be an object`);
    const candidate = frame as Frame;
    if (!FRAME_KINDS.includes(candidate.kind)) {
      throw new Error(`${at} kind must be one of ${FRAME_KINDS.join(', ')}`);
    }
    if (!FRAME_KINDS.includes(candidate.presentedAs)) {
      throw new Error(`${at} needs presentedAs — what the audience is told this frame is`);
    }
    if (!isNonEmptyString(candidate.frameId)) throw new Error(`${at} needs a frameId`);
    if (!SHA256.test(candidate.sha256 ?? '')) {
      throw new Error(`${at} needs its own sha256; a frame nobody hashed is not evidence`);
    }
  });
  return frames as Frame[];
}

export function evaluateFrameEvidence(input: unknown): FrameEvidenceVerdict {
  const frames = parseFrameSet(input);
  const blockers: string[] = [];
  const failedShots = new Set<string>();

  const blame = (frame: Frame, message: string) => {
    blockers.push(message);
    if (frame.shotId) failedShots.add(frame.shotId);
  };

  for (const frame of frames) {
    if (frame.kind === 'live-product') {
      const missing = LIVE_PRODUCT_BINDINGS.filter((key) => !isNonEmptyString(frame.bindings?.[key]));
      if (missing.length > 0) {
        blame(frame, `unbound live-product frame ${frame.frameId}: missing ${missing.join(', ')}`);
      }
      // Every field present, pointing at a different image. Looks bound; binds nothing.
      const shot = frame.bindings?.screenshotSha256;
      if (shot && shot !== frame.sha256) {
        blame(frame, `live-product frame ${frame.frameId}: screenshotSha256 does not match the frame's own hash`);
      }
    }

    if (frame.kind === 'generated') {
      const missing = GENERATED_PROVENANCE.filter((key) => {
        const value = frame.provenance?.[key];
        return key === 'inputAssets' ? !Array.isArray(value) : !isNonEmptyString(value);
      });
      if (missing.length > 0) {
        blame(frame, `generated frame ${frame.frameId} without provenance: missing ${missing.join(', ')}`);
      }
      if (frame.presentedAs === 'live-product') {
        blame(frame, `frame ${frame.frameId} is generated but presented as the running application`);
      }
    }
  }

  return {
    // Zero frames measured nothing, and must not read like a pass.
    passed: blockers.length === 0 && frames.length > 0,
    insufficient: frames.length === 0,
    blockers,
    checked: frames.length,
    liveProduct: frames.filter((frame) => frame.kind === 'live-product').length,
    generated: frames.filter((frame) => frame.kind === 'generated').length,
    failedShots: [...failedShots].sort(),
  };
}

export function formatFrameEvidence(verdict: FrameEvidenceVerdict): string {
  if (verdict.insufficient) return 'FRAME EVIDENCE: no frames supplied — nothing was checked.';
  const head =
    `FRAME EVIDENCE ${verdict.passed ? 'PASS' : 'BLOCKED'}: ${verdict.checked} frame(s) — ` +
    `${verdict.liveProduct} live-product, ${verdict.generated} generated.`;
  if (verdict.passed) return head;
  return [
    head,
    ...verdict.blockers.map((blocker) => `  ${blocker}`),
    verdict.failedShots.length > 0 ? `  repair scope: ${verdict.failedShots.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
