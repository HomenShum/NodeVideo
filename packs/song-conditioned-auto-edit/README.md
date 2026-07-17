# Song-Conditioned Choreography Auto Edit capability pack

Status: `deterministic-replay-validated` for public-fixture mechanics and isolation.

This pack defines a source-only production graph for one choreography reference, a user-chosen song excerpt, and one or more recorded takes. It analyzes the choreography and song, aligns each take, builds a candidate matrix for every phrase, chooses source ranges, lays out protected lyric captions away from grounded bodies/faces, compiles the result into canonical `nodevideo.edit-plan.v1`, renders it through the fixed renderer, and seals generation before any held-out final may be evaluated.

The checked-in `fixtures/media/song-conditioned-auto-edit-v1` replay executes the worker against one public choreography reference, one public-domain generated song, two generated creator takes, and one generated timed-text input. It validates canonical analysis, replay grounding, song-conditioned plan, and freeze artifacts; renders a six-second portrait MP4 with chosen-song audio and muted camera audio; hash-binds every public input and generation artifact; and passes the public verifier. The evaluator explicitly records `tasteStatus: not-evaluated`: this is mechanics and isolation proof, not autonomous creative-taste proof.

The replay validates the canonical component artifacts used by the worker. It does not yet emit or validate one aggregate `nodevideo.song-conditioned-auto-edit.output.v1` envelope.

## Source-only boundary

Generation admits only these roles:

- `choreography-reference`: analysis-only; never a render source;
- `chosen-song`: the exact conditioning excerpt and, only when rights allow, the output music source;
- `take`: one or more render-source videos; and
- `lyric-text`: optional protected input for caption alignment.

The closed input schema has no evaluation-target property. Admission additionally requires `evaluation-target` in `forbiddenAssetRoles`, `hiddenTargetMounted: false`, no parent-volume access, no evaluator credential, a generation read-log artifact ID, and a freeze-before-evaluation policy.

## Canonical artifacts

`nodevideo.choreography-analysis.v1` binds the exact reference, song, takes, song excerpt, beat-grid evidence, embodied-grounding evidence, ordered choreography phrases, and piecewise take alignments. A phrase maps one contiguous song interval to one contiguous reference interval and names its movement evidence.

`nodevideo.choreography-candidates.v1` contains one row per phrase. Every candidate binds a valid take, source range, the same phrase song range, decomposed timing/pose/motion/visibility/framing/quality scores, admissibility, rejection codes, and evidence. The selected candidate must be an admissible member of its row.

`nodevideo.caption-layout.v1` may contain creator-authorized text only in the local protected artifact required by the renderer. Traces and public receipts retain segment IDs or redacted cue metadata instead of protected lyric strings. Cue boxes use `normalized-frame-top-left-v1`, remain inside the declared safe area, reference grounding evidence, have zero face overlap, and have body overlap no greater than `0.05`. Ambiguous or missing grounding must be resolved manually before a completed result.

`nodevideo.choreography-freeze.v1` binds hashes for admitted inputs, analysis, candidate matrix, caption layout, EditPlan, render, and generation read log. It records zero forbidden reads and a null target-unseal time. A separate evaluator may receive a hidden target only after the stored freeze bytes and every bound hash are independently verified.

## Validator semantics

Schema validation is necessary but not sufficient. `tools/registry.json` defines cross-artifact checks for unique identities, duration-bounded ranges, strictly increasing anchors, contiguous phrase coverage, candidate foreign keys, selected-candidate membership, normalized caption geometry, EditPlan lineage, exact chosen-song routing, muted camera audio, render decoding, read-log equality, and pre-evaluation freeze isolation.

## Song and lyric rights

The chosen song requires a rights attestation and a proof reference. `render-with-chosen-song` requires both preview and export render authorization. Platform-catalog music without those permissions must use `timing-guide-muted-export` and be added by the user on the licensed platform.

These checks enforce declared policy; they do not determine ownership, interpret a platform license, clear lyrics, or grant publication rights. Protected lyric text and full provider payloads must not enter traces or public receipts.

## Replay proof

Run `node scripts/workers/song-conditioned-auto-edit.mjs --verify-public` from the repository root. The proof manifest is `fixtures/media/song-conditioned-auto-edit-v1/manifest.json`; the canonical analysis, plan, render, generation read log, choreography freeze, wrapper freeze receipt, and evaluator report live beside it. LocateAnything remains optional: this replay uses a normalized replay grounding result and does not claim live model accuracy.

## Files

- `manifest.json` declares the capability, dependencies, and source-only claim boundary.
- `input.schema.json` defines reference/song/take admission, caption policy, rights, and isolation.
- `output.schema.json` defines choreography, candidates, caption layout, plan/render references, read log, and freeze.
- `skill.md` defines deterministic orchestration and stop conditions.
- `tools/registry.json` defines tool ownership and semantic validators.
- `evals/replay-v1.json` binds the executed deterministic replay, retains a separate unexecuted three-take schema case, and records the remaining release gates.

Do not describe this pack as autonomous creative taste, live Vercel editing, generic choreography matching, live LocateAnything accuracy, or licensed music delivery until the corresponding held-out and production evidence exists.
