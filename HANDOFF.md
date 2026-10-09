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

## Finite contract-resource proof in normal CI (source candidate, 2026-10-08)

A developer should be able to check the built UI twice or alongside another caller without
leaving a browser, owned descendant, local listener or temporary consent input behind. A
missing browser or malformed served build receipt must still return its actual failure; a
cleanup proof must not recover the product error or turn an invalid measurement into success.

This four-owner follow-up adds a standard-library supervisor and passive Node preload to the
existing Quality job. It leaves the product verifier, package/lock, ordinary install, Chromium
installation, original single contract gate, UI/media gates, action versions and job timeouts
unchanged. The historical source-preparation and observed results above retain their original
scope and dates. This append proposes a new proof; it does not turn those earlier results into
resource-closure evidence.

Every normal current-source job requires seven launches: normal, repeat, two concurrent
callers with the same preferred preview port, missing Chromium, malformed served receipt and
wrong contract hash. The concurrent observation captures both roots' numeric birth identities
and owned listening ports within one bounded sampling window while both roots remain active.
The two AFTER port sets must be disjoint. This is a sampled overlap observation, not an atomic
kernel snapshot. Both final observations occur before deliberate supervisor cleanup.

For pull requests, the workflow reads the exact complete PR-base SHA and tests only the diff
of `scripts/quality/verify-ui-contract.mjs`. Native diff exit 1 selects a matched comparison;
exit 0 runs current-only seven with an explicit reason and `baseline=null`; any other exit
fails admission. Natural main jobs run current-only seven. Today's PR52 verifier delta requires
fourteen launches, authentic base first and the original actual job checkout second. AFTER
is never a permanently pinned legacy implementation. Future unchanged-verifier dependency
changes therefore still run the current seven rather than borrowing an old dependency graph.

The paired supervisor requires byte-identical package.json and package-lock.json at the two
commits before checking out either source. A combined verifier and dependency change remains
incomparable and fails; it needs a separately owned comparison plan rather than an override.
The normal installed graph is reused, without installation, resolution or package mutation.
Vite/Playwright installed versions must match the lock. Their package metadata and npm's
installed-lock metadata are hashed before/after; this is not a hash of every installed file.
The retained verifier profiles are the admitted legacy child-preview owner and current
in-process Vite preview owner. An unsupported acquisition profile fails admission.

The preload uses public Node diagnostic channels, server state, child spawn/exit/close events,
`beforeExit`, `uncaughtExceptionMonitor` and active-resource type counts. Its payload contract
is grounded in Node v22.23.3's net and child-process source. The job records its actual Node 22
version; absent, unsupported, oversized or inconsistent observations fail rather than passing
an empty listener map. It adds no child error recovery, method patch, timer, private-handle
inspection, process report or environment/argument dump. Kernel observation retains numeric
PID, parent/group, birth ticks, state and loopback port identities only. A child hint grants no
ownership without an immediately read birth identity and verified owned parent or group.

Each caller records its actual exit and bounded diagnostics. The missing-browser negative
must identify the own empty browser path and actual launch caller; malformed JSON must identify
SyntaxError/JSON.parse and the actual receipt caller. Wrong hash retains the verifier's explicit
failure. Natural success is distinguished from forced exit and uncaught failure. Baseline
product failures or leaked resources are evidence, but invalid baseline ownership, listener or
output observations fail the comparison. Every AFTER case must satisfy its intended verdict
and resource closure.

Closure requires zero retained owned process records, including zombies, no owned listener,
free observed acquired ports and an empty per-caller scratch directory at the final bounded
settlement observation. It does not claim that a five-second settlement proves all later
behavior. Cleanup may terminate only identities already admitted to an owned group; an unknown
member fails containment. Deliberate cleanup happens after the measurement and cannot convert
a failed AFTER observation into a passing one. Temporary receipt edits restore literal bytes;
source commit/tree, package/lock, installed metadata and the original normal build receipt must
be restored before a passing overall result.

Collections/read sizes are bounded: 256 owned process identities per launch, 64 server/child
records per preload, 64 acquired ports, 4,096 process/socket table rows, 512 descriptors per
owned process, 64 scratch entries, 16 KiB observer lines, 256 KiB per output stream and a 4 MiB
result. New case/build admission stops after seven minutes; settlement and owned cleanup have
separate bounded windows, and one necessary restoration build retains a 120-second budget.
The unchanged 15-minute outer job timeout remains the total CI ceiling. Admission failure or
an exceeded observation cap produces failure, not a truncated PASS. The existing artifact
action retains bounded raw logs and result.json under `.qa/evidence/contract-resources`.

At this source checkpoint, the new supervisor/preload, paired fourteen/current seven, natural
new-head CI and their resource outcome are **NOT_RUN**. Parser-only validation, when separately
recorded, can certify syntax alone. Local heavy build/browser work remains held; no local
runtime, dependency installation, provider call or held-action replay is part of this source
implementation. Failure during consent scratch acquisition, rejected close, interruption and
sustained state accumulation remain **NOT_RUN**. No universal cleanup, visual, SEO, security,
production adoption or whole-portfolio certificate follows. The six HIGH/eight LOW residual
findings in issues62/63 remain separate and open.

Primary observer contract: [Node v22.23.3 net source](https://github.com/nodejs/node/blob/v22.23.3/lib/net.js),
[child-process source](https://github.com/nodejs/node/blob/v22.23.3/lib/internal/child_process.js)
and [Node 22 process events](https://nodejs.org/docs/latest-v22.x/api/process.html).

## Resource observation and failed-launch ownership (source amendment, 2026-10-08)

A developer checking the built UI needs a failed launch to return its real error and release
its own files. The natural [Quality run37841481473](https://github.com/HomenShum/NodeVideo/actions/runs/37841481473)
recorded fourteen cases against authentic base5d223694 and the actual job checkout3822a275,
whose tree matches published9cb1a790. The resource proof was **FAIL**: all seven BEFORE
measurements were valid and had leaked resources; all seven AFTER exit expectations passed,
but every AFTER observation was invalid. Six AFTER cases had measured closure; the
missing-browser case additionally retained two Playwright temporary directories. Source,
package graph and original-build restoration passed. These scoped observations do not turn
the failed resource job into a passing Quality result.

The selected four-file amendment addresses the two observed causes. Vite8.1.4 probes TCP
availability using temporary wildcard listeners before binding the requested loopback preview.
The passive observer now retains each known TCP address, family, port and close state for
127.0.0.1/::1 and0.0.0.0/::. Null-before-bind and error-only references remain represented.
Unsupported addresses, mismatched families, IPC, malformed payloads, caps and failed writes
still make the observation invalid; the invalid flag is never cleared. A successfully bound
reference must have its close event and no listening state at exit to satisfy closure.

The existing kernel reader preserves numeric PID/birth/inode ownership and every sampled
loopback or wildcard listener. All retained endpoints require final same-family loopback
port availability, and no owned listener may remain. Wildcard probe rows cannot satisfy the
required loopback preview/fixture declarations or the two disjoint concurrent endpoint pairs.
The pair observation remains a bounded, non-atomic shared sampling window.

Playwright1.61.1 allocates its artifacts and Chromium profile before checking the executable.
The standalone verifier now creates one unique browser-launch scratch directory, scopes its
own TMPDIR/TEMP/TMP values to that directory only during the unchanged chromium.launch(),
and restores each previous value or absence in an inner finally. After acquired browser and
server cleanup completes, it validates the exact returned absolute directory before removing
only that directory, including when launch throws. Launch errors retain their original cause;
environment restoration errors retain both failures, and cleanup rejections remain visible.
A rejected acquired-resource close leaves the scratch directory rather than deleting files
while closure is unproved. Concurrent verifiers own different native temporary directories.

This source amendment leaves the workflow, package/lock, installed dependencies, seven case
inputs, default Chromium API, contract assertions, public UI and all timeouts unchanged.
The actual verifier delta continues to require paired fourteen at the PR base with the exact
same-package/lock admission. The prior source candidate, raw failed artifact and dated history
are preserved in the external resource-failure causal packet.

At this new source checkpoint, static lint/parser checks, contract execution, new fourteen-case
resource proof and natural new-head CI are **NOT_RUN**. A repair claim requires a fresh normal
job: all seven BEFORE observations must remain valid with their actual failures retained;
all seven AFTER observations must be valid, have the correct exits and injected causes, and
show zero owned process records/listeners/scratch before supervisor cleanup, free observed
ports, disjoint concurrent loopback endpoints and restored source/graph/build. No held local
runtime, dependency installation, browser or CI replay occurred here. Consent-scratch failure,
rejected close, interruption and sustained accumulation remain **NOT_RUN**; OS-wide orphan
guarantees, visual/SEO grades, production adoption, the six HIGH/eight LOW residual findings
and whole-portfolio completion remain outside this proof.

Primary causal owners: [Vite8.1.4 TCP probes](https://github.com/vitejs/vite/blob/v8.1.4/packages/vite/src/node/http.ts),
[Node22 TCP address contract](https://github.com/nodejs/node/blob/v22.23.3/doc/api/net.md),
[Playwright1.61.1 launch preparation](https://github.com/microsoft/playwright/blob/v1.61.1/packages/playwright-core/src/server/browserType.ts)
and [Node22 temporary-directory selection](https://github.com/nodejs/node/blob/v22.23.3/lib/os.js).

### Concurrent settlement source correction (same candidate, 2026-10-08)

The first frozen source amendment is retained separately. Its review identified a measurement
race: two callers can retain the same already-closed wildcard probe port, so one caller's
availability check could run while the other is still using that port. Concurrent availability
probes could also collide with each other. The supervisor now uses its existing settlement
owner for one or two actors. For the pair it waits for both root exits under the same60-second
case/deadline bound while retaining both owned inventories. At the retained cumulative
0/.5/2/5-second settlement steps it snapshots each actor sequentially; cleanup starts only
after both observations and verdicts. Early concurrent acquisition remains a shared bounded,
non-atomic observation. Timeouts, live descendants, unsupported/unknown observations and
every retained wildcard/loopback endpoint still fail their existing gates. No occupied port
is ignored or given a race exemption.

An expected-negative exit1 cannot excuse an additional reported cleanup failure. The result
owner checks bounded stderr once for the verifier's anchored resource-cleanup or launch-scratch
cleanup FAIL lines, records cleanupDiagnostic, and rejects closure if either was emitted,
even if the final inventory is empty. Rejected-close execution remains NOT_RUN; this is a
source honesty predicate, not a newly observed scenario result.

The observer and verifier bytes are unchanged from the first amendment. All current-source
runtime, next natural fourteen-case results and CI outcomes remain **NOT_RUN**. No workflow,
package/lock, input, timeout, dependency, ignored resource or new public knob changes here.

## Permission-error attribution (diagnostic source candidate, 2026-10-08)

A developer needs a failed resource comparison to identify the operation that could not be
observed, so a permission error cannot be mistaken for an empty process or scratch inventory.
The natural published70e comparison stopped with `EACCES: permission denied, opendir`.
Its actual result contains one completed BEFORE case: valid measurement and expected exit0,
but failed closure with two surviving descendants, an occupied preview port and nonempty
scratch. The repeat retained partial UI progress and no verdict; the other thirteen case
verdicts, including every AFTER case, are absent. Source, package graph and original-build
restoration passed. These observations remain a failed resource job, not a complete comparison.

The denied directory owner, PID and caller are unknown in that pathless result. Active browser
proc-fd sampling is a hypothesis; scratch inventory or cleanup remains possible. The selected
two-owner source patch adds at most one observation-failure record and one cleanup-failure
record. Directory open, iteration and close errors retain a fixed proc-fd or scratch owner,
native syscall/code/errno, an already-admitted numeric PID/birth or fixed case label, and up to
eight source-local numeric frame locations from at most4KiB of stack input. Arbitrary paths,
arguments, environment, native error messages and file contents are excluded from these new
records. Node22.23.3's native opendirSync error omits the path, so copying error.path alone
would not provide the missing attribution.

The original observation error is rethrown even when directory close, snapshot log writing
or actor cleanup also rejects; the first secondary cleanup diagnostic is retained separately.
Concurrent rejection retains
the first observed native error instead of replacing it with a generic message. Existing
proc disappearance races for ENOENT/ESRCH remain unchanged. Recursive owned scratch cleanup
has its own fixed diagnostic owner. The actual native errors remain failures; unreadable
live processes do not become empty observations, and no invalid flag is cleared.

All fourteen/current-seven case inputs, process birth/group ownership, containment, descriptor,
socket, stream and report caps, deadlines, expected exits, acquisition evidence, strict zero
resource closure and source/graph/build restoration remain. Observer, product verifier,
workflow, package/lock and installed graph are unchanged. No permission, capability, sudo,
sysctl, browser sandbox/debug option, generic retry or resource exception is introduced.
The entire earlier31,952-byte HANDOFF prefix and the original failed artifact remain preserved.

At this isolated source-only checkpoint, parser/lint checks, project imports, contract runtime,
the next naturally triggered resource comparison, new-head CI and publication are NOT_RUN.
The patch supplies missing failure evidence; it does not repair or prove the unknown permission
cause. Root owns the separate static review, expected-head publication and next unchanged
natural job. A repeated failure must remain FAIL with its actual owner retained before any
causal permission or sampling change is selected. A non-reproduced EACCES remains historical
and unresolved. Consent-scratch exception, rejected close, interruption and sustained-state
accumulation remain NOT_RUN; no visual, SEO, security, production or portfolio claim follows.

## 2026-10-08: SAME14-PROC-IDENTITY-DENIAL-01 (source-only, NOT_RUN)

A maintainer deciding why the resource comparison fails needs the admitted process's
state at the denied inventory, without collecting its executable, arguments or environment.
The actual natural f847 job `37853282869/113571332695` remains **FAIL**: one completed
BEFORE-normal observation and zero AFTER observations. The completed normal case had
native exit0 but failed resource closure. BEFORE-repeat stopped at the owned
`proc-fd-inventory` reader with `opendir/EACCES`. That source-bound artifact identified
the owner and caller; the denied process's state, thread count and underlying kernel
permission mechanism remain **UNKNOWN**, not a proven zombie or browser diagnosis.

This two-owner source amendment adds only fixed diagnostic data. The existing bounded
stat reader retains a positive safe-integer `numThreads`, or null when it is missing or
invalid. The first proc-FD observation denial retains the sampled validated state and
thread count, then makes exactly one same-PID, 4KiB-bounded stat readback. It records
`same-birth`, `gone`, `changed-identity` or `unreadable` plus validated state and
null-or-positive thread metadata. This readback neither admits ownership nor retries
descriptor access. A readback failure cannot replace the original EACCES, which remains
primary and fatal. Only the existing three listener callers pass their fixed actor case
labels; no generic actor wrapper, additional process list or permission exception is added.

The prior twelve protected bodies remain literal. The sole identity() metadata exception
does not alter birth, parent/group parsing, disappearance handling or admission rules.
The two failure-record slots, eight source-local frames and 4KiB stack cap remain.
All fourteen/current-seven case inputs, budgets, resource assertions and source/graph/build
restoration remain unchanged. The result still requires `last.live.length === 0`.
Cleanup's separate non-Z rejection is weaker and cannot certify zero remaining PID records.
No Z, low-thread, permission or unknown-state exemption is introduced.

At this checkpoint project/parser/lint/static checks, imports, resource runtime, browser
work, installed-tree validation, new natural CI and publication are **NOT_RUN**.
Root owns independent source review, pinned inert static review, ordinary publication
and the next unchanged natural job. A repeated denial must remain FAIL with its real
diagnostic data. This supplies evidence for a later cause decision; it is not the cause
repair, successful paired14, production adoption, visual/security grading or whole-portfolio
completion. Consent-scratch exception, rejected close, interruption and sustained-state
accumulation remain NOT_RUN. All preceding35,410 HANDOFF bytes and earlier failures stay preserved.


## 2026-10-08: SAME14-OWNED-THREAD-FD-INVENTORY-01 (source-only, NOT_RUN)

The CI operator needs to see resources held by surviving tasks after their group leader exits. The natural run for source `46d0962856b9f7c34b708bac86b192b681cf5b57` failed in `before-repeat`: opening the leader's descriptor directory returned EACCES. Its sample and one same-birth readback both reported state Z with two thread records. This does not identify Chrome, prove every task had stopped, or establish the runner's kernel version. One BEFORE-normal record completed with valid observation but closure false; repeat was interrupted, the other five BEFORE and all seven AFTER cases were NOT_RUN. Source, installed graph and build restoration were reported true.

The observer now inventories numeric task entries beneath each already-admitted group's `/proc/<pid>/task` directory. It validates each bounded task stat's numeric path, state, PGID and birth, and rechecks leader birth/group and task birth around descriptor inventory. Every observed non-Z task uses its own descriptor view. A specifically observed Z task is counted as terminal before descriptor access because Linux releases that task's file-table reference before its zombie state; surviving siblings are still inventoried. This never skips a zombie group, exempts a permission error, or treats an unavailable existing group/task view as empty.

The same 256-process ceiling bounds total enumerated task rows per inventory call. Task stats retain a 4-KiB read cap; descriptor, socket, TCP table and endpoint limits remain 512, 4,096, 4,096 and 64. Numeric TIDs are sorted. At most seventeen fixed counter records (fourteen scenarios and three existing build settlements) report calls started/completed, successful task-stat reads, completed nonterminal descriptor views, terminal observations and genuine disappearances. Counters are cumulative observations rather than distinct thread counts; overflow fails. Failure metadata can include only the admitted leader identity and bounded numeric task identity, fixed owner/case and existing safe source frames. Unknown identity, live task EACCES, malformed stat, capacity and close failures remain fatal.

The process admission, sampling, passive observer, acquisition, settlement, cleanup and result bodies are unchanged. Every remaining owned PID, including a zombie, still prevents AFTER closure. No policy, privilege, browser sandbox, timeout, dependency, installed graph, workflow or result waiver changed. The existing mandatory fourteen before/after cases and current-only seven admission remain intact. Next natural CI must establish those results and read the task counters; a leader-exit branch that is not exercised remains NOT_RUN. Close rejection, interruption, sustained accumulation, rendered pixels, production readiness and a full security certificate are not proved by this source change.

The Linux manual documents leader FD and task-view limitations; a still-present but unavailable task directory remains an observer failure. Kernel v6.11 is explanatory source, not the observed runner release. The exact permission ownership and sibling state of the failed run remain unknown. See [proc_pid_fd](https://man7.org/linux/man-pages/man5/proc_pid_fd.5.html), [proc_pid_task](https://man7.org/linux/man-pages/man5/proc_pid_task.5.html), and the kernel's [exit ordering](https://github.com/torvalds/linux/blob/v6.11/kernel/exit.c), [file-table release](https://github.com/torvalds/linux/blob/v6.11/fs/file.c) and [task membership lookup](https://github.com/torvalds/linux/blob/v6.11/fs/proc/base.c).

## 2026-10-08: SAME-TID-DENIAL-01 (source-only, NOT_RUN)

The maintainer needs the exact denied thread's state before deciding whether the resource observer can be repaired. Source 56b7373e50f8aad77a5aa1ce05402a5aaf196151 naturally failed run 37860991389 / core 113596379233: six BEFORE records completed with valid observation and failed closure; the wrong-hash case was interrupted and all seven AFTER cases were NOT_RUN. Concurrent1 also failed its expected exit with EADDRINUSE4339. The denied task was sampled R while its leader was S with fourteen threads; the later leader readback was same-birth Z with two thread records. The denied task's own state at denial remains UNKNOWN. A separate cleanup refusal reported an unowned process in the group; its cause remains unresolved.

This diagnostic amendment wraps only the existing task-FD read. After the first EACCES/opendir has been recorded, the exact original error object and matching admitted case/PID/birth/TID/task birth/state permit at most one existing, 4-KiB-bounded same-TID stat decode. One fixed taskReadback reports same-birth, gone, changed-identity or unreadable, with validated state or null. Decoder failure is recorded as unreadable and cannot replace the original operation error. The original error is rethrown in every path. No descriptor retry, successful recovery, terminal/gone admission, leader-Z exemption, permission waiver or cleanup change is introduced.

All twelve protected bodies plus identity(), fixed seventeen counter labels, caps, budgets, source/graph/build restoration and strict zero-owned-PID AFTER gate remain unchanged. A successful diagnostic read adds one existing task-stat observation; it does not certify resource closure. The full preceding 41,866 HANDOFF bytes and all historical failures are preserved. Source review, root's pinned static checks, ordinary publication and a new natural mandatory fourteen-case comparison remain pending at this source-only capture. No local runtime, new CI result, rendered pixels, production readiness or whole-portfolio completion is claimed. Only actual same-TID evidence can support a later causal decision; unknown task views and real permission failures stay fatal.
