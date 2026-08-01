# CreatorBench sealed evaluation

Private held-out media and evaluator targets remain under `.qa/evidence/creatorbench-v1` and are never committed. Development code cannot read them during a sealed run until all of the following are true:

1. the tracked worktree is clean;
2. `creatorbench-freeze-receipt.json` binds the source commit, manifests, policies, executor versions, and evaluator hash;
3. the evaluator receives a post-freeze `NODEVIDEO_CREATORBENCH_EVALUATOR_TOKEN` through the evaluator credential plane;
4. the private catalog hash matches the frozen receipt.

The token is checked before private manifests are opened and is never written to traces or receipts. A repair after labels are revealed requires a new benchmark version and freeze.

The baseline evaluator deliberately emits review, abstention, or unsupported states when it has not rendered and reopened an output. Human review is required before either usable class can be reported.
