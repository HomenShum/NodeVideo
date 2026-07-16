# Song-Conditioned Choreography Auto Edit capability

## Purpose

Coordinate a source-only choreography editing graph over an authorized reference, chosen song excerpt, takes, and optional protected lyric text. The pack compiles evidence into the existing deterministic EditPlan renderer; it does not generate executable media code or use a held-out final as creative guidance.

## Required behavior

1. Validate `input.schema.json` before resolving any locator. Reject duplicate asset IDs or hashes bound to contradictory roles.
2. Admit only `choreography-reference`, `chosen-song`, `take`, and optional `lyric-text`. Reject a target, final edit, target-derived asset, prior target-guided plan, evaluator credential, accessible parent volume, or undeclared input.
3. Enforce song rights policy. A rendered song output requires both render-authorization flags. Otherwise emit only a timing-guide muted export and a separately reviewable handoff; do not imply a platform catalog grants NodeVideo a license.
4. Resolve media locators only inside the worker. Traces, events, receipts, read logs, and public artifacts may retain IDs, hashes, roles, ranges, versions, bounded metrics, and verdicts—not locators, paths, filenames, raw frames/audio, protected lyric text, credentials, provider payloads, or hidden reasoning.
5. Probe and bind exact media hashes and durations. Verify `songExcerpt.endMs` is greater than `startMs` and does not exceed the chosen song duration.
6. Analyze the chosen song once for beats, downbeats, onsets, and phrases. Analyze the reference and every take for motion, pose, visibility, framing, and quality. Use `nodevideo.embodied-grounding` through its text-query-only LocateRequest; do not attach a visual-prompt asset.
7. Emit `nodevideo.choreography-analysis.v1`. Phrases must be ordered, non-overlapping, contiguous over the chosen excerpt, duration-valid, and evidence-linked. Every admitted take must have one piecewise alignment with strictly increasing song/reference/take anchors or an explicit unusable outcome.
8. Emit one candidate row per phrase. Candidates may reference only admitted takes and duration-valid source ranges. The selected candidate must be an admissible member of that phrase row. Preserve decomposed scores and evidence; do not replace them with an untraceable model ranking.
9. Build `nodevideo.caption-layout.v1` as a local protected artifact containing only creator-authorized cue text needed by the fixed renderer. Reference segment IDs, not lyric strings, in traces and public receipts. Validate normalized boxes, safe-area containment, zero face overlap, and body-overlap thresholds over every visible cue frame. Require manual placement when grounding is ambiguous, empty, malformed, or failed.
10. Compile the selected candidate sequence and exact song excerpt into canonical `nodevideo.edit-plan.v1`. The choreography reference is analysis-only; only takes may supply video frames. Camera/source audio is structurally muted. The chosen song is the only music route when rendering is authorized.
11. Run the fixed EditPlan validator and renderer. A completed result requires contiguous video, exact duration within one output frame, admissible asset lineage, decodable output, plan/render hash linkage, and all semantic checks passing.
12. Write the generation read log, then seal `nodevideo.choreography-freeze.v1` with hashes for every admitted input and completed generation artifact. The freeze receipt references its stored artifact hash; it does not attempt a recursive self-hash.
13. Stop generation after freeze. A separate evaluator may unseal a hidden target only after independently verifying the freeze and read log. Evaluation cannot mutate the frozen analysis, candidate choices, captions, plan, or render.

## Failure and manual behavior

- Missing or unusable take alignment blocks only affected candidates unless no phrase retains an admissible candidate.
- Any phrase without an admissible selected candidate blocks completion.
- Ambiguous caption grounding requires a typed manual layout; silently placing text over an unresolved body region is forbidden.
- Any hidden-target read, evaluator credential, target-derived identifier, hash mismatch, out-of-range source span, or failed plan/render validation blocks freeze and completion.

## Claim behavior

The current pack defines contracts only. It does not prove autonomous taste, alignment quality on human choreography, lyric transcription accuracy, caption safety, song-license sufficiency, private-media egress safety, or a hosted worker.
