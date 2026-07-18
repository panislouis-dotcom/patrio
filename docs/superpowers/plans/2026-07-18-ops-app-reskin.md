# Ops App Visual Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin `app/web` (the refigan ops app) from its dark "Mountain Permanence" theme to patrio's light sage-green brand, token-swap only, landing as commits on the already-open PR #2 (branch `repo-consolidation-refigan`).

**Architecture:** All components read colors/fonts/spacing/radius from one file, `app/web/src/lib/theme.ts`. Rewriting that file's values (not its key names) recolors 42 of 43 components automatically. 16 files also have hardcoded hex literals bypassing the token file — each needs individual triage: replace if it duplicates an old token value, otherwise verify it still reads legibly against the new white/cream background. `docs/DESIGN.md` (also read by 4 investor-document-generation AI skills) gets rewritten to match. `index.html` and the favicon get updated for the font/brand change.

**Tech Stack:** React + TypeScript (Vite), Vitest (unit), Playwright (e2e). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-18-ops-app-reskin-design.md` — read it before starting; it has the full contrast-ratio rationale for every derived color.

---

### Task 1: Rewrite `app/web/src/lib/theme.ts`

**Files:**
- Modify: `app/web/src/lib/theme.ts` (entire file, 35 lines)

- [ ] **Step 1: Read the current file to confirm nothing has changed since this plan was written**

Run: `cat app/web/src/lib/theme.ts`

- [ ] **Step 2: Replace the entire file contents**

```ts
export const colors = {
  primary:    '#6B8A5E',  // unchanged — already patrio sage green
  secondary:  '#6B6B6B',  // was #7A7260 — reused verbatim from patrio's --color-text-secondary
  tertiary:   '#A16A3C',  // was #A2571D (orange) — muted terracotta, 4.52:1 contrast on white
  accent1:    '#8C6D87',  // was #654F6F (purple) — muted mauve, 4.51:1 contrast on white
  accent2:    '#697692',  // was #5C5D8D (blue-violet) — muted slate-blue, 4.56:1 contrast on white
  neutral:    '#1A1A1A',  // was #F2F0EB — role flips: primary text color (was: light text on dark bg). = patrio --color-text
  dark:       '#FFFFFF',  // was #1A2319 — role flips: page background (was: darkest bg). = patrio --color-bg
  surface:    '#F8F7F4',  // was #111111 — card/panel background. = patrio --color-bg-warm
  surfaceAlt: '#F2F0EB',  // was #1e2e1e — alt/hover row background. = patrio --color-bg-alt
  border:     '#E5E2DC',  // was #2a3a29. = patrio --color-border
} as const

export const fonts = {
  serif: '"Playfair Display", Georgia, serif',
  sans: '"Inter", system-ui, sans-serif',
  label: '"Inter", system-ui, sans-serif',
} as const

export const spacing = { sm: '8px', md: '16px', lg: '32px' } as const
export const radius = { sm: '4px', md: '8px' } as const

export const globalStyles = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: ${colors.dark};
    color: ${colors.neutral};
    font-family: ${fonts.sans};
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; text-decoration: none; }
`
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd app/web && npx tsc --noEmit`
Expected: no errors (the `as const` object shape is unchanged — only values changed — so every existing call site still type-checks)

- [ ] **Step 4: Commit**

```bash
git add app/web/src/lib/theme.ts
git commit -m "feat(reskin): recolor theme.ts to patrio's light sage-green palette"
```

---

### Task 2: Update `app/web/index.html`

**Files:**
- Modify: `app/web/index.html` (entire file, 12 lines)

- [ ] **Step 1: Replace the entire file contents**

```html
<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Patrio</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add app/web/index.html
git commit -m "feat(reskin): swap ops app title and fonts to Patrio/Playfair Display+Inter"
```

---

### Task 3: Redesign `app/web/public/favicon.svg`

**Files:**
- Modify: `app/web/public/favicon.svg` (entire file, 15 lines)

- [ ] **Step 1: Replace the entire file contents**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#6B8A5E"/>
  <text
    x="16"
    y="23"
    font-family="'Playfair Display', Georgia, serif"
    font-size="20"
    font-weight="500"
    fill="#F2F0EB"
    text-anchor="middle"
    letter-spacing="1"
  >P</text>
</svg>
```

Note: `rx` (corner radius) changed from `4` to `6` to match the new `radius.md` token (8px at
32px viewbox scale ≈ 6). Background is now sage green `#6B8A5E` (`colors.primary`) with a
cream letter `#F2F0EB` (`colors.surfaceAlt`), replacing the dark-bg/sage-letter original.

- [ ] **Step 2: Verify the SVG is well-formed**

Run: `xmllint --noout app/web/public/favicon.svg`
Expected: no output, exit code 0 (avoid Python's stdlib `xml` parsers here — they're
vulnerable to XXE/billion-laughs by default; `xmllint` sidesteps that entirely for this
simple well-formedness check)

- [ ] **Step 3: Commit**

```bash
git add app/web/public/favicon.svg
git commit -m "feat(reskin): redesign favicon — sage bg, cream P, Playfair Display"
```

---

### Task 4: Rewrite `docs/DESIGN.md`

**Files:**
- Modify: `docs/DESIGN.md` (entire file, 93 lines)

**Context for implementer:** This file is read by 4 AI skills (`app/.claude/skills/generate-prospectus.md`, `generate-term-sheet.md`, `flip-quick-look.md`, `flip-proyecto.md`) that generate investor-facing PDFs — they parse its YAML front-matter for color/typography tokens. Keep the YAML front-matter schema (same keys: `name`, `colors.primary/secondary/tertiary/accent1/accent2/neutral/dark`, `typography.h1/h2/body-md/label-caps`, `rounded.sm/md`, `spacing.sm/md/lg`) identical in shape — only values and prose change — so those skills keep parsing it correctly.

- [ ] **Step 1: Replace the entire file contents**

```markdown
---
name: Patrio
colors:
  primary: "#6B8A5E"
  secondary: "#6B6B6B"
  tertiary: "#A16A3C"
  accent1: "#8C6D87"
  accent2: "#697692"
  neutral: "#1A1A1A"
  dark: "#FFFFFF"
typography:
  h1:
    fontFamily: Playfair Display
    fontSize: 3rem
  h2:
    fontFamily: Playfair Display
    fontSize: 2rem
  body-md:
    fontFamily: Inter
    fontSize: 1rem
  label-caps:
    fontFamily: Inter
    fontSize: 0.75rem
    letterSpacing: 0.12em
    textTransform: uppercase
rounded:
  sm: 4px
  md: 8px
spacing:
  sm: 8px
  md: 16px
  lg: 32px
---

# Patrio Design System

## Overview

Sage Minimalism meets Monterrey Pragmatism. Patrio's visual language is grounded in warm,
light, editorial minimalism — white and cream surfaces, sage-green accents, generous
whitespace. Nothing decorative. Every element earns its place.

## Colors

The palette is rooted in the landscape but rendered light: sage hillsides on pale linen,
warm clay and slate as secondary accents.

- **Primary (#6B8A5E):** Sage green — the brand color. UI surfaces, borders, positive indicators.
- **Secondary (#6B6B6B):** Warm grey — for metadata, borders, captions, secondary text.
- **Tertiary (#A16A3C):** Muted terracotta — the signature accent. CTAs, section bands, key numbers.
- **Accent1 (#8C6D87):** Muted mauve — for contrast moments, badges, secondary CTAs.
- **Accent2 (#697692):** Muted slate — for data highlights, links, secondary indicators.
- **Neutral (#1A1A1A):** Near-black — primary body text on light backgrounds.
- **Dark (#FFFFFF):** Pure white — the page foundation.

## Typography

- **Playfair Display** — headlines and section titles. Elegant serif with strong contrast. Italic variant used for editorial pull-quotes and impact blocks.
- **Inter** — body copy, UI text, and label caps. Clean, legible at small sizes, works on mobile.

## Wordmark

`P A T R I O` — all caps, tracked wide, set in Inter medium weight. Never use a compressed or bold weight. The spacing is the mark.

## Prospectus Layout Principles

- **Data first.** Key numbers (ROI, cap rate, investment, valuation) are the hero — large, terracotta-accented, never buried.
- **Photos bleed.** Building and site photography runs edge-to-edge. No borders, no drop shadows.
- **Sparse.** Generous whitespace on white/cream. One key number or idea per section.
- **Bilingual-ready.** Layout accommodates Spanish primary, English secondary where needed.

## Component Patterns

### Metric Card

Large number in Playfair Display (tertiary) + label in Inter caps (secondary) below.

```text
$19,000,000
VALUACIÓN ACTUAL
```

### Section Label

Inter, 0.75rem, 0.12em tracking, uppercase, secondary color. Always above the section heading.

```text
TRACK RECORD
Edificio Uno
```

### Timeline Row

Date in label-caps (secondary) / event description in body-md (neutral). Minimal left border in tertiary.
```

- [ ] **Step 2: Verify the YAML front-matter parses**

Run: `python3 -c "import yaml; d = open('docs/DESIGN.md').read().split('---')[1]; print(yaml.safe_load(d))"`
Expected: prints a dict with keys `name`, `colors`, `typography`, `rounded`, `spacing` — no exception

- [ ] **Step 3: Commit**

```bash
git add docs/DESIGN.md
git commit -m "docs(reskin): rewrite DESIGN.md for patrio's light theme

Also updates the color/font tokens read by generate-prospectus.md,
generate-term-sheet.md, flip-quick-look.md, and flip-proyecto.md —
investor documents pick up the new palette on next generation."
```

---

### Task 5: Hardcoded-hex sweep — token-duplicate accents (`ProjectDetailPage.tsx`, `ProspectDetailPage.tsx`)

**Files:**
- Modify: `app/web/src/components/ProjectDetailPage.tsx`
- Modify: `app/web/src/components/ProspectDetailPage.tsx`

**Context for implementer:** These two files each hardcode the *old* accent1/accent2 hex
values instead of referencing the token. `theme.ts` (Task 1) already changed those tokens
to their new muted values — these hardcoded literals did NOT pick up that change and are
now stale, pointing at colors that no longer exist anywhere else in the app.

- [ ] **Step 1: Find and replace in `ProjectDetailPage.tsx`**

Run: `grep -n "#5C5D8D\|#654F6F\|#c0392b\|#c8a000\|#fff\b" app/web/src/components/ProjectDetailPage.tsx`

For each match:
- `#5C5D8D` → replace with `colors.accent2` (this is the exact old `accent2` value, now stale)
- `#654F6F` → replace with `colors.accent1` (this is the exact old `accent1` value, now stale)
- `#c0392b` (line ~253) → this is a semantic error/danger red, unrelated to the brand palette. Leave the literal, but confirm it's used as a `color` (text) or `background` against the new white/cream surface — if `color`, verify legibility (dark red on white is already high-contrast, no change needed).
- `#c8a000` (line ~829) → semantic gold/warning color, unrelated to brand palette. Leave as-is; verify it's not used as tiny text on white (gold-on-white has poor contrast — if it's `color:` on small text, darken to `#8A6D00` for a ~4.5:1 ratio; if it's a `background` swatch or larger element, leave unchanged).
- `#fff` (line ~310) → check what it's applied to. If it's a background on a colored/dark element (e.g. a badge or button), leave it. If it's meant as "the page background," replace with `colors.dark` (which is now `#FFFFFF` — same value, but keeps the token as the single source of truth for future changes).

- [ ] **Step 2: Find and replace in `ProspectDetailPage.tsx`**

Run: `grep -n "#5C5D8D\|#654F6F\|#c0392b\|#c8a000\|#fff\b" app/web/src/components/ProspectDetailPage.tsx`

Apply the identical disposition rules from Step 1 (this file has the same four hex values
at similar line numbers — likely originally copy-pasted from `ProjectDetailPage.tsx`).

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd app/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add app/web/src/components/ProjectDetailPage.tsx app/web/src/components/ProspectDetailPage.tsx
git commit -m "fix(reskin): replace stale hardcoded accent1/accent2 hex with theme tokens"
```

---

### Task 6: Hardcoded-hex sweep — photo gallery dark overlays (`ProjectPhotoGallery.tsx`, `PhotoGallery.tsx`)

**Files:**
- Modify: `app/web/src/components/ProjectPhotoGallery.tsx`
- Modify: `app/web/src/components/PhotoGallery.tsx`

**Context for implementer:** Both files use `#0a0a0a` (near-black) and `#fff` (white),
almost certainly for a lightbox/filmstrip overlay that's meant to stay dark regardless of
the app's overall theme (photo viewers conventionally use a dark scrim so photos pop,
independent of light/dark page theme). This is a legitimate reason to leave a color
hardcoded rather than tokenized.

- [ ] **Step 1: Inspect usage in both files**

Run: `grep -n -B3 -A1 "#0a0a0a\|#fff\b" app/web/src/components/ProjectPhotoGallery.tsx app/web/src/components/PhotoGallery.tsx`

- [ ] **Step 2: Decide disposition**

If `#0a0a0a` is used as the background of an image lightbox/fullscreen viewer overlay
(a `position: fixed` or similar full-screen dark backdrop) and `#fff` is text/icon color
on top of it — **leave both unchanged**. A dark photo-viewing backdrop is a deliberate,
common UX pattern independent of the app's light/dark theme, not a leftover from the old
dark theme. Add no code change for this file if that's what you find; just confirm it in
your task report.

If instead `#0a0a0a`/`#fff` are used for the *page-level* gallery grid/thumbnail strip
background (not a fullscreen overlay) — replace `#0a0a0a` with `colors.surfaceAlt` and
`#fff` with `colors.neutral`, since that would mean it's tracking the old dark page theme
rather than intentionally being a fixed dark overlay.

- [ ] **Step 3: If any code changed, verify TypeScript compiles**

Run: `cd app/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit (even if no code changed, to record the investigation)**

```bash
git add app/web/src/components/ProjectPhotoGallery.tsx app/web/src/components/PhotoGallery.tsx
git commit -m "fix(reskin): review photo gallery dark overlay colors" --allow-empty
```

If no files actually changed, use `git commit --allow-empty -m "..."` with a message
explaining the overlay colors were confirmed intentional and left as-is. If files did
change, drop `--allow-empty`.

---

### Task 7: Hardcoded-hex sweep — status/semantic colors (`ProspectMap.tsx`, `ProspectTable.tsx`, `AnalysisView.tsx`, `ProspectAnalysisSection.tsx`, `ProspectForm.tsx`, `InversorPositionRow.tsx`)

**Files:**
- Modify: `app/web/src/components/ProspectMap.tsx`
- Modify: `app/web/src/components/ProspectTable.tsx`
- Modify: `app/web/src/components/AnalysisView.tsx`
- Modify: `app/web/src/components/ProspectAnalysisSection.tsx`
- Modify: `app/web/src/components/ProspectForm.tsx`
- Modify: `app/web/src/components/InversorPositionRow.tsx`

**Context for implementer:** These six files each hardcode one or two colors that look
like semantic status colors (error red, warning amber, a distinct highlight orange), not
brand-palette duplicates:
- `ProspectMap.tsx:11` and `ProspectTable.tsx:73`: `#D4891A` (a distinct orange, different from both old and new `tertiary`)
- `AnalysisView.tsx:95` and `ProspectAnalysisSection.tsx:69`: `#c0392b` (dark red)
- `ProspectForm.tsx:324`: `#ef4444` (red) and `#f59e0b` (amber)
- `InversorPositionRow.tsx:56`: `#c8a000` (gold)

- [ ] **Step 1: For each file, find the line and read ~10 lines of surrounding context**

Run for each file:
```bash
grep -n -B5 -A2 "#D4891A" app/web/src/components/ProspectMap.tsx app/web/src/components/ProspectTable.tsx
grep -n -B5 -A2 "#c0392b" app/web/src/components/AnalysisView.tsx app/web/src/components/ProspectAnalysisSection.tsx
grep -n -B5 -A2 "#ef4444\|#f59e0b" app/web/src/components/ProspectForm.tsx
grep -n -B5 -A2 "#c8a000" app/web/src/components/InversorPositionRow.tsx
```

- [ ] **Step 2: Classify and fix each**

For each hex value found, determine if it's used as `color:` (text/icon foreground) on a
size below ~14px, or as a `background:`/larger element:
- If it's small text/icon foreground color, compute its WCAG contrast ratio against
  `#FFFFFF` using the formula in `docs/superpowers/specs/2026-07-18-ops-app-reskin-design.md`
  section "Accent color semantics." If it's below 4.5:1, darken it (reduce HSL lightness)
  until it clears 4.5:1, keeping the same hue. `#D4891A`, `#c0392b`, `#ef4444`, and
  `#c8a000` are all plausibly borderline or failing on white and likely need darkening;
  `#f59e0b` (amber) is very likely failing and needs darkening.
- If it's a background or a larger UI element (badge fill, map marker, chart bar), leave
  the literal unchanged — these read fine as backgrounds regardless of the page theme.
- These are legitimately independent of the brand palette (error/warning/highlight
  semantics, not sage/terracotta/mauve/slate roles) — do not replace them with `theme.ts`
  token references. Only adjust the literal value if contrast requires it.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd app/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add app/web/src/components/ProspectMap.tsx app/web/src/components/ProspectTable.tsx app/web/src/components/AnalysisView.tsx app/web/src/components/ProspectAnalysisSection.tsx app/web/src/components/ProspectForm.tsx app/web/src/components/InversorPositionRow.tsx
git commit -m "fix(reskin): verify/darken semantic status colors for contrast on white bg"
```

---

### Task 8: Hardcoded-hex sweep — dark-theme surface tints, part 1 (`ApiKeysSection.tsx`, `CotizacionesSection.tsx`, `ProveedorDetailPage.tsx`)

**Files:**
- Modify: `app/web/src/components/ApiKeysSection.tsx`
- Modify: `app/web/src/components/CotizacionesSection.tsx`
- Modify: `app/web/src/components/ProveedorDetailPage.tsx`

**Context for implementer:** These files hardcode very dark near-black-with-a-tint
backgrounds (`#0d1f0d` dark green, `#0f2f1a` dark green, `#2a1111` dark red) plus a
`#d44` red accent in two of them. The dark tints are almost certainly translucent-looking
"success zone" / "danger zone" panel backgrounds that were designed to sit on the OLD dark
page background — they need to become light equivalents, not stay dark, or they'll look
like literal holes in the new white page.

- [ ] **Step 1: Read context for each**

Run:
```bash
grep -n -B5 -A2 "#0d1f0d" app/web/src/components/ApiKeysSection.tsx
grep -n -B5 -A2 "#0f2f1a\|#d44" app/web/src/components/CotizacionesSection.tsx
grep -n -B5 -A2 "#2a1111\|#d44" app/web/src/components/ProveedorDetailPage.tsx
```

- [ ] **Step 2: Translate dark tinted panel backgrounds to light tinted equivalents**

- `#0d1f0d` (dark green tint, `ApiKeysSection.tsx:128`) → replace with a light sage tint,
  `#EEF2EA` (a ~10% mix of `colors.primary` `#6B8A5E` into white) — same hue family as the
  brand primary, reads as a subtle "active/success" panel on a light page.
- `#0f2f1a` (dark green tint, `CotizacionesSection.tsx:183`) → same replacement, `#EEF2EA`.
- `#2a1111` (dark red tint, `ProveedorDetailPage.tsx:211`) → replace with a light red tint,
  `#FBEAEA` (a ~10% mix of a standard error red into white) — reads as a subtle
  "warning/danger" panel on a light page.
- `#d44` (red accent, appears in `CotizacionesSection.tsx:90` and
  `ProveedorDetailPage.tsx:14`) → this is a semantic error-red foreground/border color, not
  a brand-palette duplicate. Check if it's used as small text (`color:`) — if so, verify
  contrast against white (a saturated `#dd4444`-family red is usually close to the 4.5:1
  line; darken toward `#B33333` if the computed ratio is below 4.5:1). If used as a border
  or larger accent, leave unchanged.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd app/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add app/web/src/components/ApiKeysSection.tsx app/web/src/components/CotizacionesSection.tsx app/web/src/components/ProveedorDetailPage.tsx
git commit -m "fix(reskin): translate dark-theme panel tint backgrounds to light equivalents"
```

---

### Task 9: Hardcoded-hex sweep — dark-theme surface tints, part 2 (`OrgTab.tsx`, `GanttChart.tsx`, `InversoresTab.tsx`)

**Files:**
- Modify: `app/web/src/components/OrgTab.tsx`
- Modify: `app/web/src/components/GanttChart.tsx`
- Modify: `app/web/src/components/InversoresTab.tsx`

**Context for implementer:** `OrgTab.tsx` has the most hardcoded colors of any file in the
sweep (6 distinct values) — several are clearly dark-theme surface/border shades
(`#1d2e1d`, `#243424`, `#3a4e3a`, `#4a4a4a`), one is a darker primary variant
(`#5a7a4e`), and one is a semantic danger color (`#8B2020`). `GanttChart.tsx` has one
mid-gray (`#3a3a3a`, likely a chart gridline/divider). `InversoresTab.tsx` has three
status-ramp colors (`#5b9bd5` blue, `#c8a000` gold, `#e06c3a` orange) that look like a
category/status legend independent of the brand accent ramp.

- [ ] **Step 1: Read context for each**

Run:
```bash
grep -n -B5 -A2 "#1d2e1d\|#243424\|#3a4e3a\|#4a4a4a\|#5a7a4e\|#8B2020" app/web/src/components/OrgTab.tsx
grep -n -B5 -A2 "#3a3a3a" app/web/src/components/GanttChart.tsx
grep -n -B5 -A2 "#5b9bd5\|#c8a000\|#e06c3a" app/web/src/components/InversoresTab.tsx
```

- [ ] **Step 2: Translate `OrgTab.tsx`'s dark surface/border shades to light equivalents**

- `#1d2e1d`, `#243424`, `#3a4e3a` (dark green surface/border shades) → these look like a
  3-step elevation ramp on the old dark background (darkest → lightest of the three, each
  slightly lighter than `colors.dark`'s old `#1A2319`). Replace with a corresponding light
  3-step ramp using `colors.surface` (`#F8F7F4`), `colors.surfaceAlt` (`#F2F0EB`), and
  `colors.border` (`#E5E2DC`) in the same relative order they appear (compare each
  original's lightness — the lightest of the three old shades maps to the lightest of the
  three new tokens).
- `#4a4a4a` (mid-gray, likely a border or divider) → replace with `colors.border` (`#E5E2DC`).
- `#5a7a4e` (darker primary variant, likely a hover/active state on the primary color) →
  keep as a hardcoded darker-primary shade but recompute it as a darkened version of the
  *new* primary if it's meant to be "primary but darker for hover": `#5A7A4E` is
  actually already a reasonable ~10%-darker shade of `#6B8A5E`, so it can stay unchanged —
  confirm by checking it's used for a hover/pressed state, not a base fill.
- `#8B2020` (dark red, semantic danger color) → leave unchanged unless it's used as small
  text on white; if so, verify ≥4.5:1 contrast (it likely already clears this, being a
  dark saturated red).

- [ ] **Step 3: `GanttChart.tsx`'s `#3a3a3a`**

Likely a chart gridline or divider tuned for a dark background — on white it will be
nearly invisible in the wrong direction (too light relative to white) or too heavy
(too dark). Replace with `colors.border` (`#E5E2DC`) if it's a subtle gridline, or
`colors.secondary` (`#6B6B6B`) if it needs to remain clearly visible as a label/axis line
— check the surrounding context (Step 1) to decide which.

- [ ] **Step 4: `InversoresTab.tsx`'s three-color legend**

`#5b9bd5` (blue), `#c8a000` (gold), `#e06c3a` (orange) — check if these form a category
legend (e.g. investor type or position status). If so, they're intentionally independent
of the brand accent ramp (that ramp already means "score/quartile," reusing it here for a
different category axis would be confusing) — leave unchanged, but verify each clears
4.5:1 contrast against white if used as text/label color; darken any that don't, keeping
the same hue.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd app/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add app/web/src/components/OrgTab.tsx app/web/src/components/GanttChart.tsx app/web/src/components/InversoresTab.tsx
git commit -m "fix(reskin): translate remaining dark-theme surface/border shades to light equivalents"
```

---

### Task 10: Full test suite regression run

**Files:** None modified — verification only.

- [ ] **Step 1: Run the Vitest unit suite**

Run: `cd app/web && npx vitest run`
Expected: all tests pass, same pass count as before this reskin started (no test file
changes were made in any prior task — if any test now fails, it indicates a component
broke, not that a test needs updating)

- [ ] **Step 2: Run the Playwright e2e suite**

Run: `cd app/web && npx playwright test`
(Follow the project's existing e2e setup from `makefile`/`docker-compose.yml` for any
required services — the API and DB containers must be running, matching how sub-project
1's Task 9/9b tests were run.)
Expected: all tests pass, same pass/skip count as after Task 9b's fix (0 flaky skips)

- [ ] **Step 3: If anything fails, diagnose before proceeding**

A failure here means a color/token change broke actual behavior (e.g. a selector that
matched on a color-derived class, or a snapshot test) — not something to paper over. Read
the failure, find the root cause in the specific task's commit, and fix it there (amend
that task's work, don't add an unrelated patch commit).

- [ ] **Step 4: Report results**

No commit needed for this task (verification only) unless a fix was required, in which
case commit that fix under the task it belongs to (see Step 3).

---

### Task 11: Manual visual verification

**Files:** None modified — verification only.

- [ ] **Step 1: Start the app locally**

Run: `make up` (or the equivalent docker-compose command used earlier in sub-project 1
for local verification — see `makefile`)

- [ ] **Step 2: Browser-check the key screens**

Using the claude-in-chrome or playwright MCP browser tools, navigate to and screenshot:
- Login page
- Prospects table (list view)
- A prospect detail page
- A project detail page
- An investor detail page

- [ ] **Step 3: Check for visual regressions**

Look specifically for: illegible text (low contrast), any element still showing a raw
dark-theme color (a leftover near-black background or off-white text that wasn't caught
by the sweep), and broken layout (the reskin should not have moved/resized anything —
only color/font/radius changed).

- [ ] **Step 4: Report to user with screenshots**

This is the final step before finishing the branch — since visual correctness is a
judgment call, present the screenshots to the user for sign-off rather than
self-certifying. If they flag something, fix it as a new small commit (find the specific
file/token responsible, don't do a broad re-sweep).

---

## Scope expansion: investor-document generation code (Tasks 12-16)

**Discovered during Task 4's review, confirmed with user.** `docs/DESIGN.md` is not the
only place the old theme lives — two production Python modules generate real investor
PDFs and hardcode the old palette/fonts directly, independent of DESIGN.md:
`app/api/lib/prospectus_html.py` (493 lines, imported by `app/api/routes/documents.py`)
and `app/api/lib/term_sheet_html.py` (473 lines, same route file), plus 4 AI-skill
markdown files that describe the same templates for Claude to regenerate on request
(`app/.claude/skills/generate-prospectus.md`, `generate-term-sheet.md`,
`flip-quick-look.md`, `flip-proyecto.md`). Task 4 also introduced a real bug: DESIGN.md's
`neutral`/`dark` keys got the same "keep key names, flip values" treatment as
`theme.ts`, but DESIGN.md's consumers use these two words as literal, human-readable CSS
value placeholders (e.g. `background: neutral; color: dark;` in
`generate-prospectus.md:68`) — flipping their meaning silently inverts generated pages
(black background, white cover) instead of leaving them in the old (but internally
consistent) theme. User confirmed: fix this properly and rebrand the whole investor-
document pipeline now, not defer it.

**Global substitution table** (applies across Tasks 12-15 — this is the single source of
truth for every hex/font swap in this section):

| Old value | New value | Note |
|---|---|---|
| `#A2571D` | `#A16A3C` | tertiary |
| `#654F6F` | `#8C6D87` | accent1 |
| `#5C5D8D` | `#697692` | accent2 |
| `#7A7260` | `#6B6B6B` | secondary |
| `#F2F0EB` | `#F2F0EB` | neutral — **unchanged**, see DESIGN.md fix below |
| `#1A2319` | `#1A1A1A` | dark — was two different near-blacks (`#1A2319` for cover/footer surfaces, `#1A1A1A` already used ad-hoc for body/heading text in `prospectus_html.py`); unify both to `#1A1A1A` |
| `#1A1A1A` | `#1A1A1A` | already correct where it appears — no change |
| `#6B8A5E` | `#6B8A5E` | primary — unchanged, already patrio sage |
| `EB Garamond` (regular) | `Playfair Display` | |
| `EB Garamond` (italic) | `Playfair Display` (italic) | |
| `Public Sans` | `Inter` | |
| `Space Grotesk` | `Inter` | label-caps role collapses into Inter, matching the Task 1 `theme.ts` decision |
| `eb-garamond-regular.woff2` | `playfair-display-regular.woff2` | |
| `eb-garamond-italic.woff2` | `playfair-display-italic.woff2` | |
| `public-sans.woff2` | `inter-400.woff2` (400-weight body text) | Public Sans was one variable file; Inter is sourced as 3 static-weight files instead (see Task 12) |
| — (new, no old equivalent) | `inter-500.woff2` | for medium-weight UI text (buttons, `font-weight: 500` usages) |
| `space-grotesk.woff2` | `inter-600.woff2` for label-caps (uppercase, tracked, small text — wants more visual weight than body) | replaces the retired Space Grotesk font-face entirely |

### Task 12: Fix DESIGN.md's neutral/dark inversion + stage new font files

**Files:**
- Modify: `docs/DESIGN.md`
- Create: `app/api/fonts/playfair-display-regular.woff2`
- Create: `app/api/fonts/playfair-display-italic.woff2`
- Create: `app/api/fonts/inter-400.woff2`
- Create: `app/api/fonts/inter-500.woff2`
- Create: `app/api/fonts/inter-600.woff2`

**Context:** The 5 font files have already been sourced (downloaded from Google Fonts,
verified as valid WOFF2 via `file`) and staged at
`/private/tmp/claude-501/-Users-eduardo-Documents-repos-patrio/5bf80381-451f-4b67-a6e9-5b679fbb1b45/scratchpad/fonts/`.
Copy them into the repo rather than re-downloading (avoids non-determinism/network
flakiness in your environment).

- [ ] **Step 1: Copy the staged font files into the repo**

```bash
cp /private/tmp/claude-501/-Users-eduardo-Documents-repos-patrio/5bf80381-451f-4b67-a6e9-5b679fbb1b45/scratchpad/fonts/playfair-display-regular.woff2 app/api/fonts/
cp /private/tmp/claude-501/-Users-eduardo-Documents-repos-patrio/5bf80381-451f-4b67-a6e9-5b679fbb1b45/scratchpad/fonts/playfair-display-italic.woff2 app/api/fonts/
cp /private/tmp/claude-501/-Users-eduardo-Documents-repos-patrio/5bf80381-451f-4b67-a6e9-5b679fbb1b45/scratchpad/fonts/inter-400.woff2 app/api/fonts/
cp /private/tmp/claude-501/-Users-eduardo-Documents-repos-patrio/5bf80381-451f-4b67-a6e9-5b679fbb1b45/scratchpad/fonts/inter-500.woff2 app/api/fonts/
cp /private/tmp/claude-501/-Users-eduardo-Documents-repos-patrio/5bf80381-451f-4b67-a6e9-5b679fbb1b45/scratchpad/fonts/inter-600.woff2 app/api/fonts/
file app/api/fonts/playfair-display-regular.woff2 app/api/fonts/playfair-display-italic.woff2 app/api/fonts/inter-400.woff2 app/api/fonts/inter-500.woff2 app/api/fonts/inter-600.woff2
```
Expected: all 5 report "Web Open Font Format (Version 2)".

**Note:** leave the 4 old font files (`eb-garamond-regular.woff2`, `eb-garamond-italic.woff2`,
`public-sans.woff2`, `space-grotesk.woff2`) in place for this step — Task 13 removes their
references from code; delete the files themselves only after Tasks 13-15 land and nothing
references them (`grep -rn "eb-garamond\|public-sans\|space-grotesk" app/api app/.claude/skills`
returns nothing).

- [ ] **Step 2: Fix DESIGN.md's color tokens**

In `docs/DESIGN.md`'s YAML front-matter, change only these two values (everything else
from Task 4 stays as-is):

```yaml
colors:
  primary: "#6B8A5E"
  secondary: "#6B6B6B"
  tertiary: "#A16A3C"
  accent1: "#8C6D87"
  accent2: "#697692"
  neutral: "#F2F0EB"
  dark: "#1A1A1A"
```

(`neutral` goes from `#1A1A1A` back to `#F2F0EB` — the pale page-foundation color, matching
its name and its pre-existing value from before Task 4. `dark` goes from `#FFFFFF` to
`#1A1A1A` — the near-black ink/cover-surface color, matching its name. This restores the
non-inverted semantics the 4 skill files and the 2 Python modules expect when they use
`neutral`/`dark` as literal words, not opaque IDs — unlike `theme.ts`, which keeps its
role-flip because its 42 consumers treat `colors.dark`/`colors.neutral` as opaque token
IDs, not literal English words in generated output.)

Also update the **Colors** section prose to match:
```markdown
- **Neutral (#F2F0EB):** Pale linen — the page foundation.
- **Dark (#1A1A1A):** Near-black ink — cover, footer, and body text on light backgrounds.
```
(Replace the existing Neutral/Dark bullet lines with these two — leave Primary/Secondary/
Tertiary/Accent1/Accent2 bullets exactly as Task 4 left them.)

- [ ] **Step 3: Verify YAML still parses**

Run: `python3 -c "import yaml; d = open('docs/DESIGN.md').read().split('---')[1]; print(yaml.safe_load(d))"`
Expected: `neutral` prints `#F2F0EB`, `dark` prints `#1A1A1A`.

- [ ] **Step 4: Commit**

```bash
git add docs/DESIGN.md app/api/fonts/playfair-display-regular.woff2 app/api/fonts/playfair-display-italic.woff2 app/api/fonts/inter-400.woff2 app/api/fonts/inter-500.woff2 app/api/fonts/inter-600.woff2
git commit -m "fix(reskin): correct DESIGN.md neutral/dark inversion, add Playfair/Inter font files

DESIGN.md's neutral/dark tokens are used as literal English-word CSS
value placeholders by the document-generation skills and Python
modules (unlike theme.ts's opaque colors.* references), so the
role-flip pattern used elsewhere in this reskin actively inverts
generated document colors here. Restores neutral=pale bg,
dark=near-black ink, matching what those consumers expect."
```

---

### Task 13: Rewrite `app/api/lib/prospectus_html.py`

**Files:**
- Modify: `app/api/lib/prospectus_html.py`

- [ ] **Step 1: Replace the font-loading table**

Find the `fonts` list inside `_build_fonts_css()` (near the top of the file):

```python
    fonts = [
        ("EB Garamond", "400", "normal", "eb-garamond-regular.woff2"),
        ("EB Garamond", "400", "italic", "eb-garamond-italic.woff2"),
        ("Public Sans", "100 900", "normal", "public-sans.woff2"),
        ("Space Grotesk", "300 700", "normal", "space-grotesk.woff2"),
    ]
```

Replace with:

```python
    fonts = [
        ("Playfair Display", "400", "normal", "playfair-display-regular.woff2"),
        ("Playfair Display", "400", "italic", "playfair-display-italic.woff2"),
        ("Inter", "400", "normal", "inter-400.woff2"),
        ("Inter", "500", "normal", "inter-500.woff2"),
        ("Inter", "600", "normal", "inter-600.woff2"),
    ]
```

- [ ] **Step 2: Apply the global substitution table to every CSS rule in this file**

Using the substitution table above (in the "Scope expansion" section header), replace
every occurrence in this file of:
- `#A2571D` → `#A16A3C`
- `#654F6F` → `#8C6D87`
- `#5C5D8D` → `#697692`
- `#7A7260` → `#6B6B6B`
- `#1A2319` → `#1A1A1A`
- `'EB Garamond'` (and `EB Garamond` without quotes in font-family lists) → `'Playfair Display'`
- `'Public Sans'` → `'Inter'`
- `'Space Grotesk'` → `'Inter'`

Leave `#F2F0EB`, `#6B8A5E`, and any already-correct `#1A1A1A` untouched — they don't change.

You can do this with `sed` for speed, then hand-verify the result, e.g.:
```bash
sed -i '' \
  -e "s/#A2571D/#A16A3C/g" \
  -e "s/#654F6F/#8C6D87/g" \
  -e "s/#5C5D8D/#697692/g" \
  -e "s/#7A7260/#6B6B6B/g" \
  -e "s/#1A2319/#1A1A1A/g" \
  -e "s/EB Garamond/Playfair Display/g" \
  -e "s/Public Sans/Inter/g" \
  -e "s/Space Grotesk/Inter/g" \
  app/api/lib/prospectus_html.py
```
(macOS `sed -i ''` syntax — adjust to `sed -i` without the empty string if your environment
is Linux.) The font-loading table you already hand-edited in Step 1 will also get touched
by this sed pass (e.g. `"EB Garamond"` inside the tuple becomes `"Playfair Display"`) —
that's fine, it's idempotent since you already wrote the correct end state in Step 1;
just re-verify Step 1's table still reads exactly as specified after running sed.

- [ ] **Step 3: Verify no old references remain**

Run: `grep -n "#A2571D\|#654F6F\|#5C5D8D\|#7A7260\|#1A2319\|EB Garamond\|Public Sans\|Space Grotesk\|eb-garamond\|public-sans\|space-grotesk" app/api/lib/prospectus_html.py`
Expected: no output.

- [ ] **Step 4: Verify Python syntax and imports are valid**

Run: `cd app/api && python3 -c "import lib.prospectus_html"` (adjust the working directory /
PYTHONPATH to however this project normally runs its API — check `makefile` for the
established `PYTHONPATH=.:app` pattern used elsewhere in this repo, e.g.
`PYTHONPATH=.:app python3 -c "from api.lib import prospectus_html"` from the repo root).
Expected: no exception (confirms the file parses and `_build_fonts_css()` doesn't raise —
note this function reads the actual font files on import-adjacent calls, so this also
smoke-tests that Task 12's font files are present and readable).

- [ ] **Step 5: Commit**

```bash
git add app/api/lib/prospectus_html.py
git commit -m "fix(reskin): recolor/refont prospectus_html.py to patrio's light theme"
```

---

### Task 14: Rewrite `app/api/lib/term_sheet_html.py`

**Files:**
- Modify: `app/api/lib/term_sheet_html.py`

**Context:** This file already imports `_build_fonts_css` from `prospectus_html.py` (fixed
in Task 13) — no font-loading-table changes needed here, only the file's own hardcoded CSS
color/font-family literals.

- [ ] **Step 1: Apply the same substitution table**

```bash
sed -i '' \
  -e "s/#A2571D/#A16A3C/g" \
  -e "s/#654F6F/#8C6D87/g" \
  -e "s/#5C5D8D/#697692/g" \
  -e "s/#7A7260/#6B6B6B/g" \
  -e "s/#1A2319/#1A1A1A/g" \
  -e "s/EB Garamond/Playfair Display/g" \
  -e "s/Public Sans/Inter/g" \
  -e "s/Space Grotesk/Inter/g" \
  app/api/lib/term_sheet_html.py
```

- [ ] **Step 2: Verify no old references remain**

Run: `grep -n "#A2571D\|#654F6F\|#5C5D8D\|#7A7260\|#1A2319\|EB Garamond\|Public Sans\|Space Grotesk\|eb-garamond\|public-sans\|space-grotesk" app/api/lib/term_sheet_html.py`
Expected: no output.

- [ ] **Step 3: Verify Python syntax**

Run: `PYTHONPATH=.:app python3 -c "from api.lib import term_sheet_html"` from the repo root
(matching the makefile's established `PYTHONPATH` convention).
Expected: no exception.

- [ ] **Step 4: Commit**

```bash
git add app/api/lib/term_sheet_html.py
git commit -m "fix(reskin): recolor/refont term_sheet_html.py to patrio's light theme"
```

---

### Task 15: Update the 4 document-generation skill files

**Files:**
- Modify: `app/.claude/skills/generate-prospectus.md`
- Modify: `app/.claude/skills/generate-term-sheet.md`
- Modify: `app/.claude/skills/flip-quick-look.md`
- Modify: `app/.claude/skills/flip-proyecto.md`

**Context:** These are instructions for an AI agent (not executed code), describing the
same visual templates as Tasks 13-14's Python. Keep them in sync so a future
Claude-authored regeneration of these Python files (per each skill's own "any logic that
lives outside this skill will drift" warning) doesn't reintroduce the old theme.

- [ ] **Step 1: Apply the same substitution table to all 4 files**

```bash
for f in generate-prospectus generate-term-sheet flip-quick-look flip-proyecto; do
  sed -i '' \
    -e "s/#A2571D/#A16A3C/g" \
    -e "s/#654F6F/#8C6D87/g" \
    -e "s/#5C5D8D/#697692/g" \
    -e "s/#7A7260/#6B6B6B/g" \
    -e "s/#1A2319/#1A1A1A/g" \
    -e "s/EB Garamond/Playfair Display/g" \
    -e "s/Public Sans/Inter/g" \
    -e "s/Space Grotesk/Inter/g" \
    -e "s#files/fonts/eb-garamond-regular.woff2#files/fonts/playfair-display-regular.woff2#g" \
    -e "s#files/fonts/eb-garamond-italic.woff2#files/fonts/playfair-display-italic.woff2#g" \
    -e "s#files/fonts/public-sans.woff2#files/fonts/inter-400.woff2#g" \
    -e "s#files/fonts/space-grotesk.woff2#files/fonts/inter-600.woff2#g" \
    -e "s#fonts/eb-garamond-regular.woff2#fonts/playfair-display-regular.woff2#g" \
    -e "s#fonts/eb-garamond-italic.woff2#fonts/playfair-display-italic.woff2#g" \
    -e "s#fonts/public-sans.woff2#fonts/inter-400.woff2#g" \
    -e "s#fonts/space-grotesk.woff2#fonts/inter-600.woff2#g" \
    app/.claude/skills/$f.md
done
```

- [ ] **Step 2: Fix the stale absolute path bug in `generate-term-sheet.md`**

This file hardcodes an absolute path to the old, retired repo location:
`file:///Users/eduardo/Documents/repos/refigan/data/files/fonts/...` — this predates this
reskin (a leftover from sub-project 1's migration that was missed) and is broken
regardless of theme. Find every `file:///Users/eduardo/Documents/repos/refigan/data/files/fonts/`
occurrence and replace with `file:///Users/eduardo/Documents/repos/patrio/app/api/fonts/`
(matching this repo's actual current font directory, confirmed at Task 12).

```bash
sed -i '' "s#file:///Users/eduardo/Documents/repos/refigan/data/files/fonts/#file:///Users/eduardo/Documents/repos/patrio/app/api/fonts/#g" app/.claude/skills/generate-term-sheet.md
```

- [ ] **Step 3: Verify no old references remain in any of the 4 files**

Run: `grep -rn "#A2571D\|#654F6F\|#5C5D8D\|#7A7260\|#1A2319\|EB Garamond\|Public Sans\|Space Grotesk\|eb-garamond\|public-sans\|space-grotesk\|repos/refigan" app/.claude/skills/generate-prospectus.md app/.claude/skills/generate-term-sheet.md app/.claude/skills/flip-quick-look.md app/.claude/skills/flip-proyecto.md`
Expected: no output.

- [ ] **Step 4: Read each file's diff and sanity-check prose that references color names by their old English description**

The sed pass only touches hex codes and font names — it won't catch prose like "Dark full-
bleed page" or "the sage green `#6B8A5E`" (unchanged value, fine) or any place the old
docs described a color by feel rather than hex (e.g. "burnt terracotta"). Read through
`git diff` for all 4 files and fix any such prose reference by hand so the written
description still matches the (now-changed) actual colors. This is a judgment step, not
mechanical — there's no fixed list to check off, just read what changed and confirm the
surrounding sentences still make sense.

- [ ] **Step 5: Commit**

```bash
git add app/.claude/skills/generate-prospectus.md app/.claude/skills/generate-term-sheet.md app/.claude/skills/flip-quick-look.md app/.claude/skills/flip-proyecto.md
git commit -m "fix(reskin): recolor/refont the 4 document-generation skills to match

Also fixes a pre-existing stale absolute path in generate-term-sheet.md
pointing at the retired refigan repo instead of patrio's actual
app/api/fonts/ location."
```

---

### Task 16: Verify investor-document generation end-to-end

**Files:** None modified — verification only.

- [ ] **Step 1: Smoke-test both document builders directly**

From the repo root:
```bash
PYTHONPATH=.:app python3 -c "
from api.lib.prospectus_html import build_prospectus_html
from api.lib.term_sheet_html import build_term_sheet_html
projects = [{'name': 'Test Project', 'address': 'Test 123', 'valuation': 1000000}]
prospects = []
html = build_prospectus_html(projects, prospects)
assert '#A2571D' not in html and '#654F6F' not in html and '#5C5D8D' not in html
assert 'EB Garamond' not in html and 'Public Sans' not in html and 'Space Grotesk' not in html
assert 'Playfair Display' in html and 'Inter' in html
print('prospectus OK, length', len(html))
term_sheet = build_term_sheet_html({'name': 'Test', 'address': 'Test 123', 'holdMonths': 12}, 'Test Investor', 500000, 0.10)
assert '#A2571D' not in term_sheet and 'EB Garamond' not in term_sheet
print('term sheet OK, length', len(term_sheet))
"
```
If the actual function signatures differ from this sketch (check by reading the function
definitions in both files first — `def build_prospectus_html(...)` and
`def build_term_sheet_html(...)`), adjust the test call's arguments to match the real
signature while keeping the same assertions (no old hex/font strings present, new ones
present). This is testing real code with a lightweight fabricated input, not a fixture
that exists elsewhere in the repo.

- [ ] **Step 2: If `render_to_pdf` is easy to smoke-test in this environment, do so**

`prospectus_html.py` also exports `render_to_pdf` (imported by `documents.py`). If a
headless Chromium/Playwright binary is already available in this environment (check
`app/e2e`'s existing Playwright setup — it's already used for the ops-app e2e tests, so a
compatible browser binary likely exists), render the smoke-test HTML from Step 1 to an
actual PDF and confirm it doesn't raise. If no such binary is readily available in this
sandboxed environment, skip this step and note it as a gap in your final report — this is
a "nice to have" deeper check, not a blocker, since Step 1 already verifies the HTML/CSS
content itself is correct.

- [ ] **Step 3: Report results**

No commit needed (verification only) unless Step 1/2 surfaces a real bug, in which case
fix it under the specific task it belongs to (Task 13 or 14) with a new commit there, not
here.

---

## Definition of Done

- `theme.ts`, `index.html`, `favicon.svg`, `docs/DESIGN.md` updated per Tasks 1-4.
- All 16 hardcoded-hex files reviewed per Tasks 5-9, each with either a fix or a
  documented reason for leaving it unchanged.
- Vitest and Playwright suites green (Task 10).
- Manual visual pass complete with user sign-off on screenshots (Task 11).
- `docs/DESIGN.md`'s neutral/dark inversion fixed, new font files staged (Task 12).
- `prospectus_html.py` and `term_sheet_html.py` recolored/refonted, no old hex/font
  references remain, Python smoke-tests pass (Tasks 13-14, 16).
- All 4 document-generation skill markdown files updated to match, including the
  pre-existing stale `repos/refigan` path bug fixed (Task 15).
- All commits on branch `repo-consolidation-refigan` (PR #2) — no new branch, no new PR.
