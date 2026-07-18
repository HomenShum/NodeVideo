## Objective

<!-- One sentence. Link the issue/brief this fulfills. -->

## Risk classification

<!-- See docs/engineering/AGENT_EXECUTION_POLICY.md -->
- [ ] A — cheap to reverse
- [ ] B — moderate (short plan included below)
- [ ] C — expensive / security / privacy / schema (human pre-approval obtained)

## What changed

## What intentionally did not change

## Schema impact

- [ ] None
- [ ] Additive only
- [ ] Migration required (rollback path described below)
- [ ] Breaking contract change (human approval linked)

Rollback:
Affected existing artifacts:

## Visual evidence (required for any UI change)

### Before
### After
### Mobile
### Failure / empty / abstention state

## Validation

- [ ] lint · typecheck · unit
- [ ] capability validation (`npm run capability:validate`)
- [ ] bloat guard (`npm run check:bloat`)
- [ ] Playwright E2E (all viewports)
- [ ] accessibility (axe) · no console errors · no horizontal overflow
- [ ] CI verified via `gh pr checks` (not local green alone)

## Claim boundary

<!-- What this PR proves, and what it explicitly does NOT prove.
     Laptop-only evidence must be labeled laptop-only. -->

## Side quests filed

<!-- Links to issues created for out-of-scope discoveries. -->
