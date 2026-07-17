# NodeVideo UI primitive audit

This audit treats generated shadcn/Radix and AI Elements files as the maintained
component layer. Product code may compose those primitives with Tailwind layout
utilities, but should not recreate their interaction, focus, state, or semantic
behavior in feature files.

## Replaced

| Authored surface | Registry primitive | Result |
|---|---|---|
| Chrome extension legacy HTML/CSS/DOM shell | `Button`, `Card`, `Input`, `Field`, `Collapsible`, `Progress`, `Checkbox`, `Alert`, `Badge`, `Item`, `ScrollArea` | The extension now bundles the same generated React/Radix surface as the main app and has no standalone component stylesheet. |
| Upload field wrappers and helper text | `Field`, `FieldGroup`, `FieldLabel`, `FieldDescription` | Generated field composition now owns label spacing, horizontal checkbox alignment, descriptions, and grouped settings in both the web app and extension. |
| Live worker error box | `Alert` | Destructive semantics, icon, title, and description now come from the shared primitive. |
| Durable-stage rows, inline loading state, and frame transport shell | `Item`, `Button` | The generated item variant owns each repeated status/control shell while domain status copy remains plain semantic content. |
| Critical-moment horizontal navigation | `ScrollArea`, `ScrollBar`, `Button` | Radix now owns keyboard/focus-aware scrolling; the domain code only supplies timestamp actions. |
| Inspector failure state | `Alert` | The former card-shaped failure message now exposes generated destructive-alert semantics. |
| Fixed pose evidence frame | `AspectRatio` | The generated primitive owns the 16:9 box while the SVG remains a domain renderer. |
| Tool traces, code, artifacts, checkpoints, and chain display | AI Elements registry components | Already registry-owned before this audit. |
| App cards, badges, buttons, file inputs, labels, progress, selects, sliders, toggles, collapsibles, scroll areas, tooltips | shadcn-generated components under `src/components/ui` | Already primitive-owned before this audit. |

## Intentionally remains product code

| Surface | Why it is not a component primitive |
|---|---|
| Responsive page grids, flex wrappers, spacing, and safe-width constraints | Layout composition is product-specific. Wrapping every grid in a visual component would add markup and styling rather than remove maintenance. |
| Video, canvas/SVG pose overlay, and media synchronization | These are NodeVideo domain renderers. `AspectRatio` can own a fixed box, but it cannot own frame seeking, pose coordinates, or soundtrack synchronization. |
| YouTube active-tab adapter, local bearer-token bridge, polling, artifact blob playback | These are extension/runtime adapters, not UI behavior. |
| Choreography scores, confidence/abstention copy, critical-moment navigation | These encode the product contract and must remain explicit and testable. |
| Theme tokens in `src/styles.css` | Shared design-system tokens used by every generated primitive. There is no separate extension stylesheet. |

## Generated surface policy

- Add new interaction primitives with `shadcn add`; do not hand-copy Radix wrappers.
- Feature files must import from `@/components/ui` or `@/components/ai-elements`.
- A raw `button`, styled `input`, custom field wrapper, disclosure, progress bar,
  alert box, modal, select, checkbox, tooltip, tabs, or scroll container in a feature file is a
  regression unless a documented platform constraint prevents the primitive.
- Plain semantic HTML and Tailwind layout are allowed when no stateful primitive
  behavior is being recreated.
