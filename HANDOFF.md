# Start here: NodeVideo developer and user handoff

A creator can inspect the supplied public comparison, ask for a local edit, review its proposal,
apply it, undo it and download a silent browser-rendered video. Start with this keyless journey
before configuring private media, durable jobs or model providers. Those are separate workflows.

The creator workflow below is local source-build proof. The landing repair separately merged in
[PR49](https://github.com/HomenShum/NodeVideo/pull/49) as
`ce538ccf83443832a324b1bf17a77ae52af75b1d`. Its [main Quality run](https://github.com/HomenShum/NodeVideo/actions/runs/33998416532)
passed 353 unit tests and 175 browser cases, with 25 explicit skips. The actual public build receipt
and delivered module identified that merge on September 5, 2026; rendered normal-text checks at
320x800 and 1440x960 showed the caption below the canvas and no document horizontal overflow.
These checks do not certify the public editor, providers, full-length exports, enlarged-text
production behavior or whole-product quality. Read this file first, then [the architecture](docs/architecture.md)
for layer ownership and [the agent execution policy](docs/engineering/AGENT_EXECUTION_POLICY.md) before changing code.

## Run the public local demo

Use a fresh checkout with Node.js 22.12+, npm 10+ and Git. No `.env` file, provider key, camera, private
media or model download is needed for this journey. The earlier ordinary `npm ci` succeeded with
its retained lock; the current development dependency follow-up is recorded at the end of this file.

```powershell
npm ci
npx playwright install chromium
npm run check
npm run preview -- --host 127.0.0.1 --port 4983 --strictPort
```

On a Linux runner missing browser system libraries, install Chromium with `--with-deps` where
appropriate. The normal check includes the build and a bounded contract browser probe, so install
Chromium before it. If 4983 is occupied, select another unused port; do not stop another project.
Open `http://127.0.0.1:4983/`. Stop your own preview with Ctrl+C when finished.

For source development, `npm run dev -- --host 127.0.0.1 --port 4983 --strictPort` uses Vite directly.
The checked-in README also describes optional `.env` and private-preview workflows; they are not
prerequisites for this public demo. Development can expose a configured private preview, whereas
the built preview used by this proof serves the checked-in silent public assets.

1. On `/`, observe the public pose and counts 1–8. Some source frames have no tracked landmarks;
   those brief blanks are honest tracking gaps. Reduced motion shows one static pose and count 1.
2. Follow **Studio**, open the integrated frame inspector and wait for **7/7** asset verification.
   Inspect frame 480, move to 481, then use ArrowLeft to return. Hash failure must block inspection;
   a full reload after restoring the correct source is the demonstrated recovery.
3. Open `/edit.html`, confirm **Local**, open **Agent** on a phone and submit `swap 2`. Review the proposal before **Apply to timeline**.
   Before applying, the accepted plan stays unchanged. Apply changes the selected clip; **Undo**
   restores its previous label and duration. These are local browser plan/history transitions,
   not evidence of a persisted Convex job, cross-device recovery or a model completing the task.
4. Browser export snapshots the accepted plan and produces silent H.264. The retained native
   caption/cancel/retry/download proof uses the existing shortened fixture: 60 frames, 2 seconds,
   180×320, no audio, with **PROOF CUT** in the decoded image. It does not certify a fresh export
   of the untouched 44.5-second 720×1280 calibration. Reopen proof used a fresh video document,
   not import back into the full editor.

## Current proof and what remains open

The [portable evidence index](evidence/current-consumer-20260905/README.md) distinguishes original
source/build evidence from the later landing repair, independent judgments and omitted operator
artifacts. Its standard-library verifier checks exact payload bytes. Historical raw reports keep
their original FAILED/PASS status; publication does not regenerate or reinterpret them.

The [44-criterion assessment](evidence/current-consumer-20260905/raw/E6i_NODEVIDEO_CRITERION_ASSESSMENT.md.txt)
records 11 scoped observed deductions and 33 NOT_RUN criteria. All eight dimension scores and the
overall grade stay null. It identifies the original enlarged-phone content loss; the separate reflow supplement below records its later repair;
its ratings cover the retained observations, not a full accessibility or user-readiness result.

- Ordinary local install and the reviewed lint/conformance changes passed their named checks.
  The reusable workflow still uses its original pinned revision, with the canonical NodeKit
  repository name. PR46 and exact merged1417d325 main CI passed; public bootstrap identity was
  separately observed. The dependency follow-on below passed its own shared checks in PR47.
- The original inspector/editor proof covered seven exact viewport pairs. The landing follow-up
  covered 320×800, 390×844 and 1440×960 in normal/reduced/computed-text200 modes. All full visual,
  interaction, responsive, accessibility, device and performance grades remain unassigned.
- The landing startup exception is repaired in the tested local build. Intermittent tracking
  gaps remain; continuous tracking is not claimed. The original computed-text doubling exposed 201px/131px
  phone overflow at 320/390. The later landing reflow below fixes those tested conditions. Neither
  observation substitutes for native browser zoom.
  The earlier editor evidence also retains caption/player overlap, compact clipping and native
  waiting spinners; seek identity does not prove smooth playback.
- The original dependency audit recorded 13 total findings (7 high, 6 moderate), including
  3 production findings (1 high, 2 moderate). The exact timestamp and reports are in the packet.
  Local `npm run check` does not include the audit. Later dependency results are recorded below.
- Optional clip tooling has separate known missing-export/data-path failures. Provider, durable
  Creator, private-media, native camera, human taste and full-duration export paths were not
  certified by this handoff. The architecture describes their contracts, not this proof's scope.

## Keep the clock regression in normal checks

`tests/unit/landing-clock.test.ts` is now part of the normal Vitest suite. Its nine cases passed
against the current actual landing owners. Two separate retained fixtures then ran the same exact
test and pose input: the original clock failed 6 of 9 cases, and the truthiness initializer failed
1 of 9 (timestamp zero). The other cases are expected to remain valid; the negative proof does not
require every test to fail. This persistent-test evidence is separate from the earlier external
callback harness's nine-scenario `ORIGINAL_FAILURES_REPRODUCED` report.

The test uses the existing TypeScript compiler and a controlled callback/lifecycle adapter. It
covers earlier-than-effect timestamps, timestamp zero, delayed first paint, wrap, 60 simulated
seconds of callbacks, reduced motion, early cleanup and same-context remount. These are callback
semantics, not a substitute for native browser pixels or real elapsed load.

The final ordinary `npm run check` passed with 353 tests in 74 files, types, lint, existing proof
gates, build and rendered contract in 49.032 seconds on this operator machine. Its contract retains
existing mock/synthetic boundaries and deferred camera controls. The first normal attempt failed
on two new-test lint rules; that raw failure and the exact test-only correction remain in the packet.
No timeout, rule, package, dependency, runtime owner or assertion was weakened.

Run `npm run test -- tests/unit/landing-clock.test.ts` for the focused regression, then normal
`npm run check`. No new production export, dependency, package command or clock service is needed.
The clock/handoff merge passed its actual shared checks; the dependency follow-on below has
separate local evidence and passed its own shared checks in PR47.


## Reviewed dependency patch

The earlier reviewed lock patch updated fast-uri to3.1.7, DOMPurify to3.4.14 and Mermaid to11.16.1, retaining
the existing direct constraints and NodeKit pin. A fresh exact source export plus this lock passed
ordinary install and353tests/74files with build/rendered-contract checks. Its production audit is0;
that lock's full audit retained10 development findings(6high/4moderate). The earlier13/3 audit remains an
honest historical record of the original lock. See [the patch evidence](evidence/dependency-patch-20260905/README.md).

Actual component prose/SVG rendering, fresh parse errors and schema accept/reject behavior were
observed. Replacing an existing diagram with malformed text still shows the old result after20s,
under both old and patched dependencies. That preexisting component failure remains open;
the patch neither claims a correct error transition nor changes the generated renderer.

PR46's main tests and public bootstrap identity are independently recorded in the patch packet.
They apply to merged1417d325, not this later lock change. PR47 passed 353 unit tests, 175 browser cases with 25 explicit skips, and a successful one-commit secret scan, then merged normally as 4a96473. These shared results concern the dependency patch; the following layout repair has its own local proof.


## Landing text enlargement and keyboard handoff

The [landing reflow supplement](evidence/landing-reflow-20260905/README.md) records twelve actual
before/after conditions: all seven viewport pairs, enlarged computed text at 320/390/1440 and
reduced motion. Header/count rows wrap, long action labels can grow vertically, and the unchanged
pose canvas has a separate caption below it. All tested after cells have zero horizontal text loss.
Both 390 and 1440 keyboard journeys traverse all ten links and open Studio and the agent contract.

The normal local check passes 353 tests / 74 files in 65.687 seconds. The supplement preserves
failed recorder setup and its corrected error/build-binding checks. It is a separate local source
proof; current layout shared checks and production interactions are not claimed here. Other app
panels, full quality dimensions, physical devices and native zoom remain unverified.

The existing malformed diagram update has a separate [tracked repair with reproduction and acceptance checks](https://github.com/HomenShum/NodeVideo/issues/48).

## Development dependency follow-up (2026-09-07)

The current lock refreshes 15 development-only entries within their existing parent ranges.
Direct dependency constraints and versions, production lock entries and the NodeKit pin remain
unchanged. Shadcn stays installed because the application imports its CSS during the build.

One fresh `npm ci`, one normal `npm run check` and one full `npm audit --json` passed on the
isolated local candidate. The check passed all 353 tests in 74 files with no test skips, plus
lint, types, existing receipt checks, build and the local browser contract, in 114.313 seconds.
The full audit reported zero findings for this installed lock, replacing the earlier lock's
10 development findings. Reproduce those three commands in that order; the Chromium prerequisite
above still applies. The install retained npm's integrity-check warning for the unchanged pinned
NodeKit Git dependency.

This follow-up changes no application or test behavior. The receipt readers verify historical
media evidence; they do not run a fresh model provider. The local contract retains its six deferred
camera/cancellation/export controls. There is no new provider, physical-device, full-export,
rendered-quality or public-deployment proof, and the existing quality limits above remain open.


## Compatible security lock repair (local capture, 2026-10-08)

Developers installing the current source should distinguish the earlier dated audit snapshots
above from this new lock-only security result. The repair was prepared on canonical source
`a38fa8d39fb13215951952020f9395c2cd1069f7`. It updates nine compatible targets: proxy-addr 2.0.8,
MCP SDK 1.31.0, brace-expansion 5.0.12, source-map-js 1.2.2, Vitest 4.1.11, fast-uri 3.1.8,
ip-address 10.7.1, postcss-selector-parser 7.1.6 and DOMPurify 3.4.16. Vitest's seven existing
family records follow its exact 4.1.11 pins. All 893 lock paths remain: 16 records change and
877 records remain identical. The root package, direct constraints, scripts, source, tests,
CI policy and pinned NodeKit Git dependency are unchanged.

SDK 1.31.0 widens its Hono node-server dependency to `^1.19.9 || ^2.0.5`; the retained 1.19.17
satisfies that range. No Hono, Express, Zod or other SDK transitive refresh was required.
The selected records use their exact published registry tarball and integrity identities.
One normal `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` completed
with exit 0 on Node 22.22.2/npm 10.9.7 and left the prepared lock bytes unchanged. This command
did not install an application graph or run lifecycle scripts.

One normal `npm audit --package-lock-only --json` per captured lock reported:

| Lock | Low | Moderate | High | Critical | Total | Actual exit |
|---|---:|---:|---:|---:|---:|---:|
| Original a38fa8d lock | 9 | 5 | 9 | 1 | 24 | 1 |
| Compatible repair candidate | 8 | 0 | 6 | 0 | 14 | 1 |

The after-audit completed at 14:53:36 UTC. Ten finding rows disappeared; no new finding row
was added. All six remaining high rows propagate from unpatched braces 3.0.3. Shadcn remains
because application CSS and the developer CLI workflow consume it; npm's suggested major
downgrade was not applied. The eight remaining low rows propagate from KaTeX 0.16.47. Its
published patched 0.18.2 falls outside the four current `^0.16` parent ranges and needs a
separate compatibility repair. These limitations are retained in the primary
[braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and
[KaTeX advisory](https://github.com/advisories/GHSA-238p-pmpm-9mq7).

At this local-proof capture, a fresh normal installed-tree/lifecycle check, typecheck, build,
scenario suite, browser check and new-source shared CI are NOT_RUN. The lock-only audit is
still nonzero and does not certify application compatibility, all-security, provider behavior,
visual quality or a public deployment. The original dated results and their limitations above
remain historical evidence; this append does not reinterpret them.


## Crawlable landing and contract cleanup (candidate, 2026-10-08)

A visitor should receive the homepage explanation, navigation and a real first pose before
JavaScript runs. A developer checking the built UI should receive an honest verdict without
leaving an owned browser, preview server, fixture listener or temporary consent input behind.
This ten-path candidate ports the retained intent of [draft PR52](https://github.com/HomenShum/NodeVideo/pull/52)
onto canonical main `5d2236942001ea3df50c90abb8e21e277e7b1cea`. The original PR52 head
`2953f3f7edaa9f1fd192f94b940489febd3cd20f` and all earlier evidence remain preserved.

The root-only Vite HTML transform renders the existing exported Landing component. A separate
client entry hydrates it, with the same initial reduced-motion state and a subscription to
later preference changes. Linked CSS and a first-pose SVG from the existing pose input keep
content available until the canvas paints. The four existing action cards now have a matching
"Four ways" heading. Clock arithmetic, pose data, public destinations and editor/provider flows
are unchanged. The existing single canonical and homepage-only XML sitemap are retained;
robots additionally declares `Disallow: /api/` and `Disallow: /creator/runs/`. Robots directives
are crawler guidance, not access control.

The contract verifier now acquires Vite through the installed 8.1.4 preview API, reads its
actual bound port, lets the OS assign the fixture listener port and awaits acquired-resource
cleanup in `finally`. Consent scratch input is also removed in `finally`; a rejected cleanup
records a failure. Main's canonical/XML and all existing rendered contract assertions remain,
with the exact robots rule list deliberately extended for the two declared exclusions.
Vite failures before its preview API returns remain outside the acquired-server claim.

The pre-edit operator capture used the public production root in the existing Chrome session
at 1440x900, on October 8, 2026. It records a rendered pose and navigation, four cards under
"Three ways", and extension warnings. This is one desktop BEFORE observation; it is not a
mobile, five-viewport, provider, full-product or visual-quality certificate. The separate
canonical raw production receipt still had an empty client root before this candidate.
The operator packet is `nodevideo-pr52-current-source-plan-20261008-01`, with the preserved
`root-public-landing-baseline-20261008-01` screenshot, DOM and console/state capture.

At this source-preparation checkpoint, this candidate's normal install, lint, typecheck,
build, unit suite, contract execution, browser/console/Axe/pixel matrix, resource-failure
and concurrent-caller checks, new-head CI and production adoption are **NOT_RUN**. The nine
clock lifecycle scenarios and all their existing assertions remain; only their canvas/import
adapter changes. The six new public-visitor scenarios are proposed checks, not a pass count.
The full local responsive/build/Playwright resource hold remains scoped to those jobs; one
existing-Chrome baseline does not lift it or certify those checks. No dependency, package
command, workflow, timeout, score gate or provider behavior changes in this source port.

After the source review and required environment prerequisites, use the existing normal
commands: `npm run check`, `npm run test -- tests/unit/landing-clock.test.ts`, and
`npx playwright test tests/e2e/public-landing.spec.ts`. Observe baseline and candidate HTML,
hydration and the actual owned-resource cleanup under matched inputs before declaring a
repair. Preserve negative startup/receipt failures and explicit skips. A later completed
deployment needs fresh raw homepage content and exact build identity plus hydrated pixels;
source or CI success alone cannot certify that production result or search ranking.

The locked dependency graph stays byte-identical to the merged PR61 result above. Its actual
14 residual audit rows remain separate: six HIGH [issue62](https://github.com/HomenShum/NodeVideo/issues/62)
and eight LOW [issue63](https://github.com/HomenShum/NodeVideo/issues/63). Neither this candidate
nor the historical zero-audit entries clear those issues. No all-security, all-CI-green,
responsive/interaction/SEO grade or whole-portfolio completion claim follows from this append.
