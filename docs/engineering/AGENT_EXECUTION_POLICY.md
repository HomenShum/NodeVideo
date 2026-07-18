# Agent Execution Policy

Operating system for AI-assisted development on NodeVideo. Principle: **execute
reversible work immediately, put irreversible work behind explicit gates, and
require visible proof for every user-facing change.** Careful ≠ slow.

## Risk classes

Every task gets classified before work starts. The PR template requires the
class to be declared.

### Class A — cheap to reverse → execute immediately
Copy, layout, tooltips, empty states, trace presentation, new tests, docs,
adapter refactors, non-breaking tool implementations, Storybook stories.
No planning document. Implement → tests → screenshots → review.

### Class B — moderate → short plan + focused review
New capability pack, tool contract, artifact renderer, job-state changes,
provider adapters, model integrations, worker retry behavior.
The plan states: affected contracts, rollback path, tests, before/after evidence.

### Class C — expensive to reverse → human approval BEFORE implementation
Convex schema changes · breaking artifact schemas · auth/permissions ·
target-isolation boundaries · retention/privacy behavior · public claim
changes · model-license handling · evaluation thresholds · camera/pose data
handling · scoring language shown to users.
No agent may merge these on green CI alone.

## Standing rules

1. **Schema review.** Any diff touching `convex/schema.ts`, validators, shared
   contracts, capability schemas, or job-event schemas requires the PR
   template's schema-impact section filled and a human checkbox.
2. **Visual evidence.** Every frontend PR includes before/after screenshots
   (desktop + mobile) plus failure/empty state. For NodeVideo surfaces, also
   the product-specific proofs (comparison view, abstention state, countdown).
3. **Claim boundary.** No PR may state "live", "deployed", "proved", or
   "verified" beyond what its committed evidence shows. Laptop-only evidence
   must be labeled laptop-only. CI status is checked with `gh pr checks`,
   never inferred from local green.
4. **Side quests become issues.** Mid-task discoveries are filed with the
   side-quest issue template and linked in the final report. The task does not
   expand.
5. **Adversarial second review** (second model / independent agent) is required
   for: isolation logic, authorization, migrations, evaluation methodology,
   privacy boundaries, license interpretation, retry/lease logic. Prompt it
   pessimistically: "Assume a false pass exists. Find the pathway." Not used
   for cosmetic changes.
6. **Honest scores.** No hardcoded floors, no manufactured fallback values.
   Unmeasurable signals are reported unmeasurable; low evidence abstains.
   (Regression: a static performer must never receive a completed score.)
7. **Reliability checklist** on every backend/worker change: bounded
   collections, honest status codes, timeouts on subprocesses/fetches,
   SSRF/path validation, size caps, error boundaries, deterministic hashing.
8. **Repo bloat.** New media > 3 MB is blocked by `npm run check:bloat`.
   Heavy or private media stays under `.qa/evidence/` (gitignored) or an
   external store.
9. **Post-merge reflection.** After each meaningful merge, append a short
   structured reflection (what worked / what failed / root cause / proposed
   rule) to `.qa/memory/`. Agents propose rules; a human approves them.

## Agent loop

1. Interview — clarify only unresolved product decisions, then stop.
2. Risk-classify (A/B/C).
3. Implement the smallest complete slice.
4. Validate statically (types, lint, schemas) → visually (screenshots,
   component states) → behaviorally (unit, worker, browser, adversarial).
5. Independent critical review (Class B/C only).
6. File side quests. Merge. Reflect.
