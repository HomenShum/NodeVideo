# NodeVideo

NodeVideo is a privacy-first workspace for comparing a reference video with a practice take. The first release proves the product contract with a public synthetic demo and browser-local media handling: inputs stay on the device, analysis is inspectable, proposed recipe changes require review, and accepted changes create restorable versions.

The synthetic demo is a product-flow fixture, not evidence that a real media model or renderer ran. NodeVideo labels synthetic and browser-local provenance separately and fails closed when evidence is missing.

## Live release

[Open NodeVideo on Vercel](https://nodevideo-pi.vercel.app). The release is anonymous and responsive across laptop, tablet, and phone layouts.

What is live: the verified public synthetic journey, browser-local video preview, inspectable stages/artifacts/trace, review-before-mutation, append-only recipe versions, restore, and local checkpoint recovery. User-selected media stays in the current browser session and is not uploaded.

What is not yet claimed: cloud media processing, live AI analysis, real beat/pose/difference extraction, a rendered reconstruction from uploaded clips, shared server persistence, or collaboration. Those capabilities require the planned Convex control plane and versioned media workers before their UI can be labeled live.

## Run locally

Requirements: Node.js 20+, npm 10+, and Chromium for the end-to-end suite.

```bash
npm ci
npm run dev
```

Open `http://localhost:4173`.

The public demo can be loaded without private media. Local upload controls accept user-selected files for the current browser session only; they must not upload bytes or place object URLs/file paths in traces, checkpoints, logs, or test artifacts.

## Quality gates

```bash
npm run lint
npm run typecheck
npm run test
npm run check:ui
npm run build
npx playwright install chromium
npm run test:e2e
```

To run the same journeys against production:

```powershell
$env:NODEVIDEO_URL='https://nodevideo-pi.vercel.app'; npm run test:e2e
```

`npm run check` runs the static, unit, and build gates. Pull requests run the full sequence, including the synthetic-demo Playwright journey, in [`.github/workflows/quality.yml`](.github/workflows/quality.yml).

The browser suite runs every journey at 1440, the 1280 desktop breakpoint, 834, 390, and 320 CSS pixels. Its accessibility
gate also rejects document-level horizontal overflow.

The stable automation contract is documented in [`.qa/profile.md`](.qa/profile.md). In particular, `data-testid` values are a versioned public interface for agents and tests; they must not be renamed casually or used to bypass product code.

## Release slice

The first honest vertical slice is:

1. Enter through the public synthetic demo or select two local videos.
2. Review an explicit run plan.
3. Observe stage-derived progress and inspect artifacts and trace spans as they appear.
4. Review a recipe proposal before it can change state.
5. Accept the exact proposal to create a new restorable version, or decline it without mutation.
6. Reload and recover the latest local checkpoint without implying that session-only video bytes were persisted.

The synthetic path is deterministic and CI-safe. Real uploaded media is local-only and never belongs in the public demo, repository, CI fixtures, screenshots, or hosted preview.

## Reuse strategy

NodeVideo reuses proven primitives from our own repositories by responsibility, not by copying an entire application:

- **Parity Studio / AI Elements:** React shell, composer, activity-card, inspector, proposal, and version-history interaction patterns.
- **NodeAgent:** typed tool registry, durable execution, idempotency, receipts, and independent validation patterns.
- **NodeRoom:** append-only event streams, checkpoint/retry/cancel semantics, trace contracts, and artifact-to-span navigation.
- **react-o11y:** headless trace hierarchy and timing presentation.
- **FeatureClipStudio:** Playwright-to-video proof workflow and FFmpeg-based render verification for release evidence.

The current browser-local runtime is a bounded first slice. The target architecture keeps the same serializable event/artifact contracts while moving durable semantic state into Convex and deterministic media work into versioned workers. See [`docs/architecture.md`](docs/architecture.md).

### Primitive-first UI

NodeVideo uses Tailwind CSS 4 and generated shadcn/ui primitives for generic presentation and
interaction. Feature code composes those primitives around video-domain behavior; it does not
rebuild buttons, cards, tabs, progress, scroll areas, or responsive navigation.

Generated files in `src/components/ui/**` are an immutable vendor zone. Their exact upstream
snapshots are recorded in `.ui/ui-policy.json`; refresh them through the pinned shadcn CLI, never
by hand. Only primitives reachable from the app are retained.

`npm run check:ui` rejects raw generic controls, direct Radix imports, inline layout styles,
arbitrary Tailwind dimensions, extra authored stylesheets, and custom media queries. It also
ratchets authored UI and CSS totals downward so maintenance cost cannot silently grow. See
[`docs/ui-primitives.md`](docs/ui-primitives.md) for the selection order and exception process.

AI Elements is reserved for a real agent/model path with streamed tasks, tools, plans, or
artifacts. Its documented setup is Next.js-oriented, so a copied component must first prove it
builds in this Vite application without Next-specific imports. NodeVideo does not add an AI
component catalog merely for visual styling.

## Privacy and truthfulness rules

- User media stays local unless a future, separately consented action explicitly names an external destination and scope.
- The hosted/public path uses synthetic assets only.
- Synthetic artifacts always say they are synthetic and never claim a playable render without one.
- Browser object URLs are session-only capabilities; never persist or log them.
- Trace and checkpoint records contain IDs, hashes, ranges, versions, timings, status, and artifact references—not raw media or credentials.
- Deterministic analysis is not labeled as a live AI/model run. Any future model egress must be private by default and produce a server-authored receipt matching its preflight.
- Agent output is a reviewable proposal. Mutation occurs only after digest-bound acceptance and creates a restorable version.

## Repository guide

- `src/lib/contracts.ts` — serializable runtime, artifact, stage, event, and provenance contracts.
- `.qa/profile.md` — canonical agentic UI journey and selector contract.
- `.qa/memory/` — append-only QA history and baseline notes.
- `tests/e2e/` — public synthetic-demo and privacy-boundary journeys.
- `docs/architecture.md` — layer boundaries, dependency flow, and release gates.

## Status

The public P0 vertical slice is deployed and production-tested. Passing the synthetic demo proves the UI/runtime contract only. A real media-analysis claim additionally requires worker goldens, FFprobe/render verification, trace evidence, and held-out evaluation fixtures for normalization, beat mapping, pose extraction, alignment, differences, and critical moments.
