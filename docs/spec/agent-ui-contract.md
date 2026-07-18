# Agent UI Contract — open spec v0.1

A convention for making a web UI **agent-native**: the app publishes a
machine-readable contract describing its surfaces, controls, gates, and states;
CI replays the contract against the rendered production build so the contract
cannot drift from reality; and the contract is served at a well-known path so
any visiting agent can drive the app through the accessibility tree — no
vision, no scraping, no per-app prompt engineering.

Reference implementation: this repository (`.ui/contract.json`,
`scripts/quality/verify-ui-contract.mjs`,
served live at `/.well-known/agent-ui.json`).

## Design principles

1. **The accessibility tree is the selector layer.** Controls bind to ARIA
   roles + accessible names, label-backed ids, or testids — in that order of
   preference. An app that is honest to screen readers is already honest to
   agents; the contract curates that surface, it does not invent a parallel one.
2. **Enforced or it isn't a contract.** A verifier must replay the contract
   against the real production build in CI and fail the build on any drift:
   unresolvable controls, broken invariants, missing gate behavior, or a public
   copy that differs from source.
3. **Gates are part of the surface.** Anything the app refuses to do (consent
   gates, size limits, auth walls) is declared with its observable refusal
   behavior, and the verifier exercises at least the client-side gates
   adversarially. A contract that only describes the happy path is a map with
   no cliffs marked.
4. **States carry meaning, not just structure.** Key UI states (results,
   errors, abstentions) declare required and forbidden signals against
   fixtures, so honesty properties ("unmeasured values are disclosed, never
   fabricated") are machine-checked, not aspirational.
5. **Hash-bind the contract to the build.** A build receipt written by the
   same build that produced the served bundle carries the SHA-256 of the served
   contract. Agents verify receipt-hash == served-contract bytes and fail
   closed on mismatch; a contract describing a different build than the one
   serving it is worse than no contract.
6. **Self-attestation is declared, not hidden.** CI verification is the app
   vouching for itself. Trust-grade claims require an independent party
   replaying the same contract — which the contract itself makes cheap.

## File layout

| Artifact | Path | Role |
| --- | --- | --- |
| Contract source | `.ui/contract.json` | single source of truth, versioned with the code |
| Public copy | `<publicDir>/.well-known/agent-ui.json` | byte-identical; served at `/.well-known/agent-ui.json` |
| Build receipt | `dist/.well-known/agent-ui.build.json` | emitted by the build; binds contract hash + source commit |
| State fixtures | `.ui/fixtures/*.json` | canned backend responses driving declared states |
| Verifier | CI script | replays everything above against the production build |

## Contract schema (informal)

```jsonc
{
  "schemaVersion": "<app>.ui-contract.v1",
  "app": "...",
  "purpose": "...",                      // human+agent readable intent
  "buildReceipt": { "path": "/.well-known/agent-ui.build.json", "meaning": "..." },
  "invariants": {
    "charset": "UTF-8",
    "themes": ["dark", "light"],         // and the mechanism, e.g. in-app toggle
    "noHorizontalOverflowAtWidths": [1440, 1280, 834, 390, 320],
    "honesty": ["..."]                   // the claims the states section proves
  },
  "surfaces": [{
    "id": "...", "route": "/...",
    "landmark": { "testid" | "role"+"name": "..." },   // proves you are on the surface
    "controls": [{
      "id": "...",
      // exactly one binding:
      "testid": "..." | "role": "...", "name": "..." | "css": "#label-backed-id",
      "requiresExpand": "<control-id>",  // collapsed-disclosure prerequisite
      "gated": "..."                     // agent guidance for restricted controls
    }],
    "gates": [{ "id": "...", "kind": "client-validated | server-enforced | both",
                "check": "observable refusal behavior, quoted exactly" }],
    "states": [{ "id": "...", "fixture": ".ui/fixtures/....json", "meaning": "...",
                 "requireTexts": [], "forbidTexts": [],
                 "requireScoreChips": [], "forbidScoreChips": [] }],
    "agentGuidance": "what agents may and must not do here"
  }]
}
```

## Verifier obligations

Per surface: resolve the landmark and every control (expanding declared
disclosures first) · assert charset and overflow at every declared width ·
exercise declared theme mechanics · adversarially exercise client gates and
assert the exact refusal behavior · for each state, serve its fixture from a
mock backend, load the surface into that state, and assert every required /
forbidden signal · verify the public copy is byte-identical to source and the
build receipt hash matches the served contract. Any failure fails the build.

## Agent obligations

Fetch `/.well-known/agent-ui.json`, then `/.well-known/agent-ui.build.json`;
verify the hash binding; treat `gated` controls and `agentGuidance` as hard
policy (e.g. never satisfy a consent checkbox on a user's behalf); prefer
declared bindings over discovered ones; report contract violations to the app
rather than working around them — a violation is a bug in the contract system.

## Known limits (v0.1)

- Visual craft (does it *look* designed) is outside any contract — that
  remains a vision judgment.
- CI verification is self-attestation; independent replay is specified but not
  provided here.
- Copy changes to bound names are breaking changes by design; version the
  contract and note renames in its history.
