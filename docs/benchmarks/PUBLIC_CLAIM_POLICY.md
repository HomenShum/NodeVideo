# CreatorBench public-claim policy

NodeVideo must not hand-author performance counts or universal-success language. The only publishable CreatorBench performance sentence is the `statement` generated inside a valid `nodevideo.creatorbench-public-claim/v1` artifact.

## Required derivation

The generator filters to private held-out instances, joins one result per instance, joins all referenced source records, validates the sealed freeze and computes:

- instance count;
- source count;
- creator-disjoint source count;
- domain count;
- workflow count;
- numerator, denominator and rate for every result class.

The generated sentence has this structure, with values supplied only by evaluated records:

```text
On [benchmark version], covering [private held-out instances] from
[creator-disjoint sources] across [workflows], NodeVideo produced a usable
first-pass result automatically in [rate], after bounded assistance in [rate],
and safely abstained in [rate]. Silent failures occurred in [rate].
```

No placeholder artifact containing zeroes or aspirational acquisition targets should be published. If the join is incomplete, claim generation fails.

## Non-performance claims

The repository may accurately say:

> NodeVideo accepts supported creator requests through a universal, rights-aware request contract and uses explicit automatic, assisted, review, abstention, unsupported and failure outcomes.

It may not say:

> NodeVideo works on every video.

It may not convert the absence of an output into success, relabel assisted work as automatic, or omit `silent_failure` from a result report.

## Release changes

Changing the runtime, models, executors, router, thresholds, evaluator or benchmark manifest after private evaluation creates a different benchmark version. Results from different freezes cannot be merged into one claim unless the methodology explicitly defines and discloses that comparison.
