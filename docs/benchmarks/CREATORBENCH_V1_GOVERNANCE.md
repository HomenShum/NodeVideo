# CreatorBench v1 governance

CreatorBench measures how NodeVideo behaves on previously unseen creator media. It does not certify universal success. The universal claim is limited to the input and artifact contract: every accepted request enters `nodevideo.creator-request/v1`, while the system may complete, request bounded assistance or review, abstain, report unsupported work, or fail.

## Contract chain

```text
Rights-cleared source record
→ creator/source/template-disjoint split assignment
→ workflow instance and CreatorRequest
→ frozen runtime and evaluator
→ route and execution result
→ blinded human review
→ exhaustive result class
→ derived public claim
```

Canonical JSON Schemas live in `benchmarks/creatorbench-v1/schemas`. Runtime validation and TypeScript types live in `src/lib/creatorbench-contracts.ts`.

| Contract | Purpose |
|---|---|
| `nodevideo.creator-request/v1` | Universal request envelope for assets, intent, output, privacy, cost, executors, rights and approvals |
| `nodevideo.creatorbench-source/v1` | Source provenance, owner, rights, privacy, media metadata and assigned split |
| `nodevideo.creatorbench-split/v1` | Leakage-sensitive creator, source-group, template, perceptual-hash and audio-fingerprint assignment |
| `nodevideo.creatorbench-instance/v1` | One executable workflow request against one or more sources |
| `nodevideo.creatorbench-result/v1` | Route, cost, latency, usability checks and exactly one result class |
| `nodevideo.creatorbench-review/v1` | Blinded human usability and correction-time judgment |
| `nodevideo.creatorbench-freeze/v1` | Immutable code, configuration, route, model, executor, evaluator and private-catalog identity |
| `nodevideo.creatorbench-public-claim/v1` | Machine-derived held-out population and outcome statement |

## Rights and privacy

Allowed source classes are CC0, public domain, attributable CC BY, owner-consented, generated with retained provenance, and evaluator-only restricted private media. `unclear` is represented in intake so it can be rejected; it is never valid for an accepted request or benchmark source.

Private held-out records must:

- omit public source URLs and sensitive locators;
- use only an opaque locator class;
- remain outside Git;
- prohibit redistribution;
- deny development credentials access;
- become accessible to evaluator credentials only after the freeze.

Owner-consented public or review media requires a consent receipt. Non-public media cannot be marked redistributable. Rights and privacy checks remain result blockers even when media execution succeeds.

## Split isolation

Every source belongs to exactly one of:

- `development`: visible for implementation and routing work;
- `public-test`: visible inputs with scoring isolated from normal development tools;
- `private-heldout`: media and labels outside the repository, available after freeze only;
- `adversarial`: explicit stress cases for fallback and abstention.

No creator, source video, related source group, template family, perceptual duplicate or audio duplicate may cross splits. `validateSplitIsolation` fails closed when any isolation key maps to multiple splits. A new evaluation after revealed private labels requires a new benchmark version and freeze.

## Result taxonomy

Every instance ends in exactly one class:

1. `automatic_usable`
2. `assisted_usable`
3. `review_required`
4. `safely_abstained`
5. `unsupported`
6. `technical_failure`
7. `silent_failure`

`silent_failure` is not a generic error. It means NodeVideo declared or implied success while blinded human review found a materially incorrect, unusable, unsafe or rights-invalid result. The validator rejects a success claim with a material human-review failure unless it is classified `silent_failure`.

Automatic usability requires zero user interventions, every common machine gate, a reopening export and `usable_as_is` human judgment. Assisted usability requires at least one bounded intervention and a usable human judgment. Rendering alone never makes an output usable.

## Human review

The review contract stores only a pseudonymous reviewer ID and assignment ID. It records the categorical usability judgment, correction seconds, correctness issues, missed content, unwanted edits and reason codes. Variant preference is permitted only in a blind comparison.

The five allowed judgments remain categorical:

- usable as-is;
- usable after minor correction;
- requires major correction;
- unusable;
- unsafe or rights-invalid.

They must not be collapsed into a generic 0–100 quality score.

## Freeze boundary

The freeze receipt pins:

- a full source commit SHA;
- configuration, capability, router, threshold and benchmark-manifest hashes;
- evaluator version and hash;
- exact model and executor versions;
- the private catalog hash;
- the facts that private media is outside Git and development credentials are denied.

Evaluator credentials may be enabled only at or after `frozenAt`. Enabling them earlier invalidates the run.

## Claim boundary

Dataset targets are acquisition goals, not facts. Until records and results exist, CreatorBench must show gaps rather than prefilled counts. A public statement is valid only when `derivePublicClaim` receives:

- a valid freeze receipt;
- exactly one result for every private held-out instance;
- every referenced held-out source record;
- valid result and source contracts.

The generated artifact reports each result class separately using numerator, denominator and rate. It does not hide silent failures, assisted cases or missing results inside a blended success score.
