# Creator taste learning and production audit

Use this pack for any authorized short-form production, not only dance.

1. Produce a `nodevideo.production-audit.v1` from derived evidence: cuts, OCR/text roles and regions, visual-treatment statistics, branding persistence, and delivery/end-card observations.
2. Run `target-spec.validate` before using a target interpretation as evaluator ground truth. A spec that cannot explain visible evidence is invalid, even if its cut list is accurate.
3. Learn a profile only from authorized audits. Keep per-value evidence references, production support, confidence, content kinds, and cautions.
4. Apply the profile as priors to a new source-only production. Do not copy case-specific timing or text merely because it appeared in one reference.
5. Freeze the chosen profile digest, source analysis, editorial plan, rendered candidate, and read log before a hidden target becomes available.
6. Evaluate provenance, structure, semantic overlays, layout, visual treatment, creator identity, and delivery as conjunctive gates. Never promote a timing-only pass to a creative pass.
7. NodeAgent may propose profile and audit candidates. NodeVideo validates identity, hashes, schemas, and project boundaries and retains final persistence/review authority.

The deterministic CLI is `node scripts/analysis/creator-taste-profiler.mjs --input <audit.json> --out <run.json>`.
