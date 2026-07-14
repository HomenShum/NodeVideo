# NodeVideo

NodeVideo is a privacy-first workspace for comparing a reference video with a practice take. The public release combines a checked-in deterministic worker proof over synthetic known-marker media with browser-local handling for user-selected files: analysis is inspectable, proposed recipe changes require review, and accepted changes create restorable versions.

The public inputs are generated, but the worker result is not simulated. FFmpeg decoded and normalized two videos, PCM analysis detected known onsets, a purpose-built color-marker extractor produced tracks, deterministic tools aligned and compared them, and FFmpeg rendered playable outputs. This proves the bounded worker/orchestration contract; it does not prove generic human pose or production-music accuracy.

## Live release

[Open NodeVideo on Vercel](https://nodevideo-pi.vercel.app). The release is anonymous and responsive across laptop, tablet, and phone layouts.

What is live: a public synthetic-source worker bundle with a completed receipt and result, playable side-by-side and difference renders, three critical moments, immutable worker events, trace spans, review-before-mutation, append-only recipe versions, restore, and local checkpoint recovery. The browser verifies the deployed comparison hash and receipt/result verdict before enabling replay. It also performs a read-only health query against the production Convex control plane. User-selected media stays in the current browser session and is not uploaded.

The Vercel app serves and replays a completed proof bundle; it does not run FFmpeg for visitors. The Convex schema/functions are deployed, but this public UI intentionally has no unauthenticated mutation bridge, so worker jobs and recipe changes still use the checked-in receipt and browser-local checkpoints. Not yet claimed: arbitrary uploaded-media analysis, generic human pose, production-music beat accuracy, private human tutorial comparison, live AI/model analysis, shared multi-user persistence, or collaboration.

## Run locally

Requirements: Node.js 22+, npm 10+, Chromium for the end-to-end suite, and FFmpeg/FFprobe to regenerate or independently verify media-worker proof.

```bash
npm ci
npm run dev
```

Open `http://localhost:4173`.

The public demo can be loaded without private media. Local upload controls accept user-selected files for the current browser session only; they must not upload bytes or place object URLs/file paths in traces, checkpoints, logs, or test artifacts.

Verify the checked-in public worker receipt without regenerating it:

```powershell
node scripts/workers/tutorial-compare.mjs --verify-public
```

The verifier is part of `npm run check`; it validates checked-in media hashes, FFprobe decodability, receipt status, critical-moment count, event ordering, and the capability pack's input/output schemas.

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

1. Load and verify the public synthetic-source worker bundle, or select local videos for session-only preview.
2. Review the explicit deterministic worker plan and disclosure.
3. Replay the receipt's immutable job events and inspect worker-backed artifacts and trace spans.
4. Play the actual FFmpeg side-by-side or difference render and inspect its three known-marker moments.
5. Review a recipe proposal before it can change state.
6. Accept the exact proposal to create a new restorable version, or decline it without mutation.
7. Reload and recover the latest local checkpoint without implying that session-only video bytes were persisted.

The public worker path is deterministic and publication-safe because both inputs are generated. Private human-video inspection and reconstruction proof remains only under ignored `.qa/evidence/private/` on the laptop. That private evidence proves codec, rotation, color, cut, and render handling—not this pack's human pose or coaching accuracy.

## Reuse strategy

NodeVideo reuses proven primitives from our own repositories by responsibility, not by copying an entire application:

- **Parity Studio / AI Elements:** React shell, composer, activity-card, inspector, proposal, and version-history interaction patterns.
- **NodeAgent:** typed tool registry, durable execution, idempotency, receipts, and independent validation patterns.
- **NodeRoom:** append-only event streams, checkpoint/retry/cancel semantics, trace contracts, and artifact-to-span navigation.
- **react-o11y:** headless trace hierarchy and timing presentation.
- **FeatureClipStudio:** Playwright-to-video proof workflow and FFmpeg-based render verification for release evidence.

The production Convex control-plane contract is deployed with durable jobs, monotonic events, lease fencing, artifacts, digest-bound proposals, and runtime-source records. Sensitive writes are internal-only until an authenticated worker/client wrapper exists. The public media-plane proof still comes from a versioned deterministic worker and checked-in receipt; hosted FFmpeg execution is not active. See [`docs/architecture.md`](docs/architecture.md).

### Primitive-first UI

NodeVideo uses Tailwind CSS 4 and generated shadcn/ui primitives for generic presentation and
interaction. Feature code composes those primitives around video-domain behavior; it does not
rebuild buttons, cards, tabs, progress, scroll areas, or responsive navigation.

Generated files in `src/components/ui/**` and `src/components/ai-elements/**` are an immutable vendor zone. Their exact upstream
snapshots are recorded in `.ui/ui-policy.json`; refresh them through the pinned shadcn CLI, never
by hand. Only primitives reachable from the app are retained.

`npm run check:ui` rejects raw generic controls, direct Radix imports, inline layout styles,
arbitrary Tailwind dimensions, extra authored stylesheets, and custom media queries. The final
budget is enforced at 900 authored UI lines and 120 CSS lines; the current release is below both. See
[`docs/ui-primitives.md`](docs/ui-primitives.md) for the selection order and exception process.

Selected source-distributed AI Elements surfaces are ported only as Vite-safe presentation for
real worker tool, checkpoint, and artifact records. Their presence is not evidence of an AI/model
call, and domain state remains independent of `useChat`, Next.js, and Vercel AI Gateway. NodeVideo
does not add the component catalog merely for visual styling.

## Privacy and truthfulness rules

- User media stays local unless a future, separately consented action explicitly names an external destination and scope.
- The hosted/public path uses generated assets only and replays a completed public-worker receipt.
- Synthetic-source artifacts carry explicit disclosure and deterministic-worker provenance. A playable render is shown only when the worker produced and hashed that media.
- Browser object URLs are session-only capabilities; never persist or log them.
- Trace and checkpoint records contain IDs, hashes, ranges, versions, timings, status, and artifact references—not raw media or credentials.
- Deterministic analysis is not labeled as a live AI/model run. Any future model egress must be private by default and produce a server-authored receipt matching its preflight.
- Agent output is a reviewable proposal. Mutation occurs only after digest-bound acceptance and creates a restorable version.

## Repository guide

- `src/lib/contracts.ts` — serializable runtime, artifact, stage, event, and provenance contracts.
- `convex/` — deployed durable jobs, events, artifacts, proposals, and runtime-source proof.
- `.qa/profile.md` — canonical agentic UI journey and selector contract.
- `.qa/memory/` — append-only QA history and baseline notes.
- `tests/e2e/` — public synthetic-demo and privacy-boundary journeys.
- `docs/architecture.md` — layer boundaries, dependency flow, and release gates.

The public worker contract and excluded claims live in [`packs/tutorial-compare/`](packs/tutorial-compare/); its generated source pair, playable renders, typed result, and receipt live in [`fixtures/media/tutorial-compare-v1/`](fixtures/media/tutorial-compare-v1/).

## Status

The public P0 known-marker slice has real worker evidence: 22 monotonic job events, 10 worker spans, 13 passing in-run checks, 12 independent receipt checks, schema-valid output, two playable FFmpeg comparison renders, and three seven-frame-per-input burst artifacts. Convex dev and production schemas are deployed and browser connectivity is checked, while 5 durability-kernel tests cover idempotency, leases/fencing, event ordering, and digest-bound approval. The live frontend replays the checked-in worker result; it is not a hosted on-demand worker and does not expose public mutations. Generic human pose, production music, private human tutorial comparison, and end-to-end remote retry/resume remain blocked until their own held-out and integration proof exists.
