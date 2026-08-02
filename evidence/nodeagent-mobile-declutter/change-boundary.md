# NodeAgent mobile declutter — change boundary

## Proof target

- Route: `/creator`
- Device: Android 15 emulator, Chrome, 412 × 783 CSS px (1080 × 2400 device screenshot)
- Theme/state: dark theme, anonymous rights-cleared demo, Chat tab, populated proposal, OpenRouter route selected
- Named proof: a first-time mobile tester can read the chat, type a request, and send it without scrolling through configuration; external egress consent remains explicit and one-shot.

## Changed regions

- **A — Agent navigation and context:** compact the NodeAgent heading/actions and attached-context chips. Proposal and run proof remain reachable.
- **B — Proposal decision card:** reduce repeated metadata and make the next review decision scan cleanly. Accept, reject, and review remain distinct actions.
- **C — Composer and advanced controls:** keep message + send + Auto/Ask in the primary path. Defer route, scope, workflow, and transcript behind one Options disclosure. Show external-consent disclosure only when an external route is selected.
- **D — Resumed Files recovery:** when durable case memory resumes without browser-local media, keep upload and add the same rights-cleared demo recovery action used at intake.

## State matrix

| Region | Empty | Loading | Error/degraded | Populated | Overflow | Responsive |
| --- | --- | --- | --- | --- | --- | --- |
| A | No source badge; disabled review actions | Current action updates | Durable connection text remains honest | Source + selected context visible | Chips truncate/scroll | One compact row on phone |
| B | Not rendered | Existing working state remains in chat | Rejection/failure status remains visible | All three decisions retained | Digest deferred from default view | Actions wrap without horizontal clipping |
| C | Quick actions + empty composer | Send disabled; progress visible | Consent refusal/tool failure shown in history | Draft and selected route preserved | Long prompt scrolls inside textarea | Composer stays above bottom tabs at 320–430 px widths |
| D | No local source shows upload + demo recovery | Demo action reports loading through existing source status | Existing load failure remains honest | Loaded source metadata replaces recovery actions | Long file names truncate in the existing source row | Files remains a dedicated phone tab |

## Out of scope

- Global NodeVideo brand header and Canvas/Chat/Files bottom navigation
- Canvas panel and populated Files layout
- Agent orchestration, model routing, durable memory, and proposal semantics
- Desktop visual redesign
- Weakening external-provider consent or auto-approving paid/media-egress operations

## Mobbin references

- Trust Wallet “Secret Phrase Safety Confirmed”: focused checkbox + bottom-sheet treatment for a sensitive confirmation.
- Origin “Budget Creation”: accordion/bottom-sheet treatment for secondary setup.

These references inform hierarchy and progressive disclosure only; NodeVideo keeps its own visual language and trust rules.
