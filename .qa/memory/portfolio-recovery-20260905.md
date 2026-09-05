# Portfolio recovery merge reflection — proposed observations only

## PR46: landing clock and developer handoff

What worked: exact-source callback scenarios, native pixels and independent review caught the first-frame exception and preserved honest fixture gaps.
What failed: the effect timestamp could be later than the first animation callback, producing a negative frame index. The initial test also had two lint failures, retained before correction.
Root cause: the two clocks used different origins for the same animation lifecycle.
Proposed rule for human review: start an animation from its own first callback and test timestamp zero. This note does not activate a new rule.

## PR47: three production dependency patches

What worked: a narrow existing-record lock change, fresh installation, actual component observations and normal shared checks preserved application contracts.
What failed: in-place malformed diagram updates retained the old diagram with both the original and patched dependency versions. A fresh mount showed the error correctly.
Root cause: the observed stale-update boundary is the existing component update path; its internal cause remains unproven. It was not introduced by this patch.
Proposed rule for human review: distinguish initial render from state transitions in renderer checks. This note does not activate a new rule.
