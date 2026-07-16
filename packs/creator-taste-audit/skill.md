# Creator taste learning and production audit

Use this pack for any authorized short-form production, not only dance.

1. Produce a `nodevideo.production-audit.v1` from derived evidence: cuts, OCR/text roles and regions, visual-treatment statistics, branding persistence, and delivery/end-card observations.
2. Run `target-spec.validate` before using a target interpretation as evaluator ground truth. A spec that cannot explain visible evidence is invalid, even if its cut list is accurate.
3. Learn a profile only from authorized audits. Keep per-value evidence references, production support, confidence, content kinds, and cautions.
4. Apply the profile as priors to a new source-only production. Do not copy case-specific timing or text merely because it appeared in one reference.
5. Freeze the chosen profile digest, source analysis, editorial plan, rendered candidate, and read log before a hidden target becomes available.
6. Produce a `nodevideo.production-decision-ledger.v1` across all ten intentional-production dimensions. Keep observation, intent hypothesis, causal function, rejected alternatives, evidence, confidence, and owner-review status separate.
7. Promote a `nodevideo.creator-intent-profile.v1` rule only after matching owner-confirmed intent appears in at least two productions.
8. Evaluate provenance, structure, semantic overlays, layout, visual treatment, creator identity, delivery, and intentional production as conjunctive gates. Never promote a timing-only pass to a creative pass.
9. NodeAgent may propose profile, decision-ledger, and audit candidates. NodeVideo validates identity, hashes, schemas, project boundaries, and evaluation readiness and retains final persistence/review authority.

The deterministic CLI is `node scripts/analysis/creator-taste-profiler.mjs --input <audit.json> --out <run.json>`.

Intentional-production CLIs are `audio-production-audit.mjs`, `production-decision-auditor.mjs`, and `creator-intent-profiler.mjs` under `scripts/analysis`.
