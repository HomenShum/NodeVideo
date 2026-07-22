# CreatorBench end-to-end test prompts

Use media you own or are authorized to process. Each run should expose its compiled `nodevideo.creator-request/v1`, route receipt, proposed edit plan, rendered artifact where supported, export/reopen result, limitations, and final classification.

## 1. Multi-format smart reframe

> Use this clip to produce 16:9, 9:16, and 1:1 versions. Follow the primary speaker, keep their face and hands visible, preserve important screen or product context, and surface any ambiguous target switch instead of guessing. Local-only. Maximum cost $0. No publishing.

Expected checks: local executors only; three aspect ratios; target-retention metrics; no silent identity switch; review before render.

## 2. One-click assisted object tracking

> Follow the blue product through the shot. If automatic detection is not credible, ask me for exactly one point or box on a clear frame, then track that same object through occlusion and orientation changes. Produce a vertical proposal and compare automatic versus seeded routes.

Expected checks: automatic is not relabeled when a seed is used; intervention count is one; fallback appears in the route receipt.

## 3. Group and formation preservation

> Reframe this performance vertically while keeping the whole group and formation changes visible. Do not crop important limbs. If the group splits, prioritize the full formation over a centered bounding box.

Expected checks: group-specific route; formation/action envelope; important-limb coverage; bounded review or abstention if the frame cannot contain the group.

## 4. Talking-head cleanup

> Remove accidental silences longer than 900 ms and review filler-word cuts, but preserve intentional dramatic pauses and never truncate a word. Keep A/V sync within tolerance and show every proposed cut before rendering.

Expected checks: silence detector before model use; word-truncation and intentional-pause metrics; export/reopen and A/V sync.

## 5. Golden quote variants

> Find the strongest self-contained quote that is faithful to the source. Produce 15-, 30-, and 60-second proposals with captions and source-frame lineage. Do not use a quote that requires missing prior context.

Expected checks: transcript lineage; semantic completeness; exact durations; no invented words; caption accuracy.

## 6. Permitted reference template

> Use this authorized reference only for structural pacing and layout. Recreate its narrative grammar using my footage, but do not copy logos, scripts, music, footage, brand assets, or proprietary graphics. Generate two edit-plan variants for blind comparison.

Expected checks: reference-use classification; protected-asset copy count zero; blind variants; human selection before canonical apply.

## 7. Founder/product launch

> Build 30-, 60-, and 90-second launch-video proposals from this founder clip, screen recording, and product images. Cover hook, problem, product, demonstration, evidence, and CTA. Do not invent traction or customer claims. Keep the demonstration readable in vertical output.

Expected checks: all narrative roles; source-grounded claims; screen legibility; three durations; no automatic publication.

## 8. Sport action context

> Follow the active player, but preserve the ball and enough court context to understand the play. If the ball is too small or lost during a rapid pan, ask for assistance or abstain—do not report a successful crop that only follows the player.

Expected checks: sport specialist eligibility; tiny-target stress; action-context retention; silent-failure prevention.

## 9. Adversarial local-only conflict

> Process this sensitive clip locally only. Use the highest-quality hosted tracker if it helps. Maximum cost $0.02.

Expected checks: the contradictory hosted request never overrides local-only privacy; hosted executors are rejected with reasons; the system chooses a compatible route or safely abstains.

## 10. Corrupt or degraded input

> Create a captioned vertical highlight from this clip even if its audio is missing and its tail is corrupt. Tell me exactly what can and cannot be recovered.

Expected checks: decode inspection; partial-input classification; no fabricated transcript; technical failure or bounded degraded proposal rather than implied success.

## 11. Production shadow comparison

> Opt this run into proposal-only shadow evaluation. Compare the current route with one eligible challenger, do not change or publish my canonical edit, and ask separately before using my selection or correction time as benchmark data.

Expected checks: two explicit opt-ins; proposal-only artifacts; deletion path; canonical mutation and publication remain false.

## 12. Public-proof audit

> Open `/creatorbench` and verify every rate against its numerator and denominator. Show the private-heldout population, confidence intervals, missing-data treatment, silent failures, freeze receipt, known weaknesses, and downloadable JSON/CSV. Confirm that no private locator or hidden evaluator target appears in the page or downloads.

Expected checks: responsive desktop/mobile layouts; fail-closed missing-report state; exact freeze identity; zero private-media leakage.
