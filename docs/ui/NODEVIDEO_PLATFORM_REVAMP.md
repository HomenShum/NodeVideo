# NodeVideo platform revamp

## Why the current screen is insufficient

The existing creator route proves one useful transaction: load one source, compile variants,
approve one plan, and export it. It does not expose the broader product discussed for NodeVideo:
multiple sources, reusable structural templates, campaign outputs, a timeline/artifact stage,
executor routing, proposal review, and proof.

## Directions considered

1. **Editor-first NLE** — precise and familiar, but makes the empty state and agent workflow
   difficult for a new creator.
2. **Campaign command center** — organizes sources, templates, output variants, execution, and
   proof around a deliverable. This best matches multi-format creator work.
3. **Chat-first assistant** — easiest to request work, but hides the artifact and governance
   lifecycle behind a conversation.
4. **Canvas and moodboard** — strong for ideation, but weak for exact cuts and review.

## Chosen direction

Use the campaign command center as the shell, an editor-style artifact/timeline stage as the
center, and a persistent Cursor-style private agent rail on the right. The rail is a conversation,
not a configuration form: artifact context, user requests, assistant replies, tool activity,
proposal cards, proof, and the composer share one continuous surface.

```text
Project + version + durable status
├── Source & template vault
├── Artifact stage
│   ├── Canvas
│   ├── Timeline
│   └── Variants
└── Private NodeAgent
    ├── Persistent message feed
    ├── Attached source and selected variant
    ├── Inline tool activity
    ├── Reviewable proposal cards
    ├── Proposal and proof detail views
    └── Pinned composer
```

## Capability truth

- Browser preview and browser FFmpeg are private local conveniences; browser MP4 export is
  currently video-only.
- The local worker supplies FFmpeg/Whisper/shot analysis and audio-preserving production renders.
- Higgsfield is authenticated through its official CLI and exposes generation, cleanup, upscaling,
  reframing, and clip workflows. A live job still requires a cost proposal and explicit egress
  approval. The web promotion is not represented as CLI pricing.
- Reference videos become structural templates only. NodeVideo does not copy logos, protected
  footage, or other brand assets.

## Required state and recovery

- Source loaded
- Analysis compiled
- Proposal awaiting review
- Exact variant approved
- Render running/completed/failed
- Version visible after approval
- Restore draft returns the selected proposal to review without deleting source work
- Conversation survives a browser reload through bounded local persistence; server-backed,
  cross-device conversation remains a later NodeRoom/Convex integration boundary

## Acceptance

- The source, template, stage, variant, agent, proposal, executor, and proof surfaces are visible
  and keyboard-operable.
- Template selections change the real workflow and request.
- Timeline lanes are rendered from the selected `EditPlan`, not placeholder data.
- Approval changes proposal state and version; restore reverses the approval.
- Higgsfield is shown as connected, with unknown live price failing closed.
- Desktop and mobile journeys pass with no accessibility violations or horizontal overflow.
