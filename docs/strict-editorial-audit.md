# Strict editorial audit

NodeVideo separates infrastructure integrity from editorial quality. Hash verification, target
isolation, a playable render, and correct source identity do not make a reconstruction successful.

## Integrated owner case

The generated plan was frozen before the evaluator opened the manual target plan. The evaluator
then performed a one-to-one signed boundary assignment at 30 fps with a maximum error of two frames.

| Generated boundary | Target boundary | Signed error | Strict result |
| ---: | ---: | ---: | :--- |
| `6.600 s` | `6.700 s` | `-3 frames` | fail |
| `15.800 s` | `16.067 s` | `-8 frames` | fail |
| `19.800 s` | `19.633 s` | `+5 frames` | fail |
| `25.267 s` | `25.100 s` | `+5 frames` | fail |
| `40.400 s` | `40.467 s` | `-2 frames` | pass |

One target boundary remains unmatched. Only `1 / 5` assigned boundaries meets the two-frame gate;
the maximum absolute error is eight frames. The strict editorial verdict is **failed**.

The run did correctly choose the same A/B source identity for all five comparable phrases. That is
useful calibration evidence, but it does not override the timing failure or establish creative
taste. The older `0.75 s` F1 and nearest-neighbor values remain in the receipt only as explicitly
legacy diagnostics.

## Claim boundary

What this run supports:

- independent official choreography and chosen-song inputs;
- source-only generation followed by target unseal;
- typed plan, freeze receipt, render, and hash-bound public evidence;
- five of five neutral source-identity choices matching the manual edit.

What it does not support:

- strict cut reconstruction;
- autonomous editing quality equivalent to the manual final;
- generalized creative taste;
- live LocateAnything inference;
- a deployed Eve + Convex + real-worker upload flow.

PR #10 must remain an infrastructure and development-calibration change until those independent
product gates are demonstrated.
