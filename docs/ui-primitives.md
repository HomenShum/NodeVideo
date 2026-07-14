# Primitive-first UI policy

NodeVideo composes presentation from maintained primitives. Product code describes video workflow
semantics; it does not recreate generic controls, responsive shells, focus behavior, or component
styling.

## Required selection order

For each UI need, use this order:

1. Reuse a primitive already installed in `src/components/ui` or
   `src/components/ai-elements`.
2. Search the approved shadcn registry and inspect the candidate before installation.
3. Search AI Elements for agent-specific plans, tasks, tools, and artifacts.
4. Compose installed primitives.
5. Add domain-specific code only when an approved, expiring exception explains why composition is
   insufficient.

The repository pins CLI versions through `package-lock.json`. Do not put `@latest` in package
scripts or CI. Typical discovery and installation commands are:

```bash
npm exec shadcn -- search @shadcn --query "<capability>"
npm exec shadcn -- view @shadcn/<item>
npm exec shadcn -- view @ai-elements/<item>
npm exec shadcn -- add <item>
```

`src/components/ui/**` and `src/components/ai-elements/**` are generated/vendor zones. They are
excluded from authored-code budgets and hash-recorded in `.ui/ui-policy.json`. Feature code must
import them instead of importing Radix directly. Install only primitives reachable from the app;
do not scaffold an entire catalog.

The policy also records the generator package/version and verifies it against `package-lock.json`,
so CI regenerates and reviews primitives from the same toolchain.

After intentionally installing or refreshing a reviewed registry item, print the normalized
generated manifest and replace the `generatedFiles` object in the policy:

```bash
node scripts/quality/check-ui-policy.mjs --print-generated-manifest
```

The normal check rejects generated files that are new, missing, or locally modified. Line endings
are normalized before hashing so the manifest is stable on Windows and Linux. Updating a hash is a
review action, not a way to bless hand-written code in the generated zone.

AI Elements currently documents Next.js as its supported application setup. Before adding an AI
Element to this Vite app, prove that the chosen copied component builds without Next-specific
imports. A successful proof permits that component, not the whole catalog.

## Rules enforced today

Run the guards directly from the repository root:

```bash
node scripts/quality/check-ui-policy.mjs
node scripts/quality/check-ui-budget.mjs
```

The policy check rejects:

- raw buttons, inputs, selects, textareas, labels, dialogs, details, summaries, progress, or meter
  elements outside generated zones;
- direct `radix-ui` or `@radix-ui/*` imports from authored code;
- inline styles, including CSS-variable indirection;
- arbitrary Tailwind values such as `w-[356px]`;
- additional authored CSS files, CSS-in-JS libraries, or authored `<style>` tags; and
- authored `@media` rules beyond the frozen legacy allowance.

Raw `video`, `audio`, `source`, `track`, and `canvas` elements are legitimate media-domain markup.
A raw file input is allowed only when it is hidden with `hidden`/`sr-only` and nested in its
triggering label. All other generic interaction uses generated primitives.

Tailwind `data-[state=...]:*` and `aria-[...]:*` variants are allowed because they bind authored
composition to accessible state exposed by headless primitives. They may not contain a second
arbitrary layout, color, or size value.

Responsive behavior uses Tailwind's named responsive variants, container queries, and the mobile
behavior built into shadcn primitives. Product code must not add a new breakpoint.

Tailwind source discovery is pinned to `src` with `@import "tailwindcss" source(".")`, so local and
hosted builds cannot discover different utility sets from environment-specific files. Biome 1.9
does not parse that Tailwind 4 import modifier, so `src/styles.css` is excluded from Biome only;
the Tailwind/Vite production build parses it and the UI policy still scans and budgets it.

NodeVideo uses one class-based dark-theme authority. The `dark` class must be mounted on the root
element, and `color-scheme: dark` belongs to that theme rather than `:root`. shadcn owns the
semantic `--accent` token. Product branding uses `--brand-accent` (and clearly named derivatives),
so a palette change cannot silently restyle generated hover and selection states.

## Budget and migration ratchet

Generated primitive code, tests, runtime contracts, and non-UI libraries do not count. Authored
`.tsx`/`.jsx` files under `src` and the configured global stylesheet do count.

The final limits are:

| Measure | Limit |
| --- | ---: |
| Authored UI | 900 logical lines total |
| Authored CSS | 120 logical lines total |
| Any new authored UI file | 200 logical lines |
| Domain visual component files | 4 |
| Raw generic controls | 0 |
| Non-token inline styles | 0 |
| Arbitrary Tailwind values | 0 |
| Authored media queries | 0 |

The current app predates this policy. `.ui/ui-policy.json` therefore runs in `ratchet` mode:
existing debt is an explicit per-file allowance and total ceiling, while new files start at the
final limits. A change may reduce a legacy allowance but may not increase it. When a check says a
legacy count fell, lower the matching number in the policy file in the same change. The default
configuration treats a stale, higher ratchet as an error so removed debt cannot be quietly
reintroduced. Once all final limits pass, change `mode` to `final` and remove the legacy allowances.

The scripts use nonblank, non-comment logical lines. They intentionally report final-budget debt as
a warning during migration, but exceeding the frozen ratchet is an error.

## Exceptions

Exceptions live in the `exceptions` array in `.ui/ui-policy.json`. They require:

- a unique ID and owner;
- exact file paths, never globs;
- the primitive candidates that were inspected and why they failed;
- a positive per-rule occurrence allowance;
- creation and expiry dates no more than 60 days apart; and
- the layout/accessibility tests that cover the exception.

Example:

```json
{
  "id": "UIX-004",
  "owner": "hshum",
  "reason": "Frame-coordinate geometry requires one runtime CSS variable.",
  "created": "2026-07-14",
  "expires": "2026-09-12",
  "paths": ["src/features/compare/video-stage.tsx"],
  "primitivesChecked": ["@shadcn/aspect-ratio"],
  "tests": ["tests/layout/video-stage.spec.ts"],
  "allowances": {
    "inline-style": 1
  }
}
```

An exception never waives responsive, overflow, keyboard, or accessibility testing. Policy files,
guard scripts, generated-zone configuration, and exceptions should be protected by CODEOWNERS and
the required UI-policy CI check once the GitHub repository exists.

## CI integration

When package/workflow edits are in scope, add both direct commands as required steps before build
and browser QA. A pull request must not update visual baselines automatically, weaken a budget, or
increase a legacy allowance merely to make the check pass.
