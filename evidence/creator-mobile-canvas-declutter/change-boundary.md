# UI change boundary

Route: `https://nodevideo-pi.vercel.app/creator`
Viewport: Android Chrome, 412x783 CSS pixels, DPR 2.625
Theme: dark
Session: returning anonymous creator with durable proposal; browser-local demo media restored
Trigger: open `Canvas`
Fixture/input: rights-cleared `nodevideo-demo.mp4`, populated two-variant local proposal

## CHANGE A · Artifact and variant header

Current: an eyebrow, selected title, and two two-line variant cards consume a full header row.
Expected: selected artifact identity remains clear while the variants become a compact aspect-ratio switcher; accessible names retain full variant titles.
Data source: selected `EditPlan` variant and canonical version.

| State | Expected visible result |
| --- | --- |
| Empty | “Planning first cut” and an honest “No variants yet” state remain visible. |
| Loading | Existing run status remains in NodeAgent Chat; the Canvas does not fabricate progress. |
| Error | Existing source/proposal errors remain in Chat with recovery. |
| Populated | Selected title plus compact 16:9/9:16 controls; selected state remains explicit. |
| Overflow | Long variant titles are preserved in accessible labels without widening the phone viewport. |
| Responsive | Desktop keeps descriptive variant titles; compact treatment applies only to mobile. |

## CHANGE B · Timeline detail

Current: the full two-track timeline and audio route permanently occupy roughly the bottom third of the phone Canvas.
Expected: timeline is collapsed by default behind one named, keyboard-operable disclosure with duration/track summary; opening it reveals the unchanged timeline and audio route.
Data source: selected `EditPlan` renderer timeline.

| State | Expected visible result |
| --- | --- |
| Empty | Honest “Timeline appears after NodeAgent compiles an edit plan” remains reachable. |
| Loading | No synthetic progress is added. |
| Error | Timeline does not hide Chat-based error and recovery paths. |
| Populated | Summary names timeline duration and track count; disclosure reveals exact tracks and audio route. |
| Overflow | Expanded tracks stay inside the Canvas width with no horizontal page overflow. |
| Responsive | Mobile starts collapsed; desktop retains the always-visible timeline. |

## Protected and out of scope

Protected: Canvas/Chat/Files navigation, selected variant semantics, video playback controls, timeline track content, audio-route disclosure, NodeAgent history, approval/reject/restore, receipt/proposal identity, and Files recovery.

Out of scope: NodeAgent Chat internals, Files panel, player rendering, proposal execution, persistent memory, external routing, desktop workspace topology, and bottom navigation.

Unchanged assertion: same case, version, selected variant, source media, player, Chat history, proposal decision, export availability, and Files recovery before and after.

## Function ledger

| id | selector/component | user promise | capability guard | backing field/action/network effect | observed artifact | instance disposition | preserve/reverify assertion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | `.creator-eyebrow` in artifact header | identifies the current artifact | `ORDINARY_CAPABILITY` | static label plus selected title | `before.png` | MERGE on mobile | selected title and stage accessible name remain |
| C2 | `.creator-variant-switcher small` | identifies each named variant | `PRESERVE_CAPABILITY` | `result.variants`, `onSelectVariant` | `before.png` | COMPACT on mobile | full title remains in `aria-label`; 16:9/9:16 remain operable |
| C3 | `Timeline` | exact edit tracks and audio route | `PRESERVE_CAPABILITY` | selected renderer plan | `before.png` | DEFER on mobile | named disclosure is reachable and expanded state reproduces all track content |
| C4 | mobile surface nav | Canvas/Chat/Files reachability | `PRESERVE_CAPABILITY` | `mobileSurface` state | `before.png` | PRESERVE | all three buttons remain visible and operable |
