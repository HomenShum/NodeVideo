# Smart Reframe creator integration

Primary mode: structural-additive REVAMP.

## Direction A — Camera operator overlay

Canvas owns the visible crop frame and subject boxes; a compact toolbar selects subject, aspect,
policy, and motion. Timeline adds crop keyframes and warning ranges. Highest direct-manipulation
clarity, lowest workspace disruption.

## Direction B — Agent-led framing wizard

The right rail owns a four-step subject → format → policy → review flow. Excellent first-use
guidance, but weak for direct crop adjustment and too agent-panel dependent.

## Direction C — Dedicated reframing mode

The center stage becomes a dual original/output comparison with a large inspector below. Strong
for specialists, but displaces the canonical artifact and adds another editor mode.

## Decision

Direction A wins. It preserves the artifact-first topology, makes tap-to-select and crop-path
editing spatial, and keeps NodeAgent as orchestrator. Graft Direction B's explicit privacy and
workflow status into the contextual toolbar. Keep raw confidence, versions, and hashes in the Run
Inspector.

| Direction | Audit | Scan | Taste | Data fidelity | Implementability | Total |
|---|---:|---:|---:|---:|---:|---:|
| A | 5 | 5 | 5 | 5 | 5 | 25 |
| B | 4 | 5 | 4 | 4 | 4 | 21 |
| C | 5 | 3 | 4 | 5 | 3 | 20 |

