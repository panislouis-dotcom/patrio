# Sub-project 1b: Ops App Visual Reskin — Design

**Status:** Approved
**Branch:** `repo-consolidation-refigan` (lands on the already-open PR #2, per explicit user instruction — not a separate PR)

## Goal

Reskin `app/web` (the refigan ops app: prospect pipeline, projects, investors, procesos)
from its own dark "Mountain Permanence" design system to patrio's actual brand — light
background, sage green primary, Playfair Display + Inter — without a blind copy of
patrio's marketing-site CSS (structurally different: CSS custom properties vs. a TS
constants object) and without restructuring layout or density.

## Decisions locked in during brainstorming

1. **Light mode**, not dark — full flip from refigan's dark theme to patrio's white/cream palette.
2. **Token swap only** — keep the existing dense layout; do not redesign component structure or spacing rhythm beyond what the token values themselves change (e.g. corner radius).
3. **Derive a muted 4-color accent palette** from patrio's tokens rather than dropping refigan's distinct status/score accent colors — these aren't decorative, they encode a semantic ramp (see below).
4. **Same PR** — every commit here lands on branch `repo-consolidation-refigan` / PR #2.

## 1. Token mapping (`app/web/src/lib/theme.ts`)

Key names are **kept stable** (not renamed) so all 42 files that import from `theme.ts`
inherit the new look with zero call-site changes — only the values change. Two keys
(`dark`, `neutral`) end up holding a value that's the semantic opposite of what their name
suggests, purely as an artifact of the dark→light flip (`dark` was "the page background,"
which is now white; `neutral` was "text color on that background," which is now the near-
black text color). This is documented with inline comments in `theme.ts` rather than fixed
by a rename, because a rename would require touching 225 call sites for `neutral` alone (315
for `border`) across every component file — high blast radius for a purely cosmetic
improvement to one file. Minimal-impact wins here.

```ts
export const colors = {
  primary:    '#6B8A5E',  // unchanged — already patrio sage green
  secondary:  '#6B6B6B',  // was #7A7260 — reused verbatim from patrio's --color-text-secondary
  tertiary:   '#A16A3C',  // was #A2571D (orange) — muted terracotta, darkened to 4.52:1 contrast on white
  accent1:    '#8C6D87',  // was #654F6F (purple) — muted mauve, darkened to 4.51:1 contrast on white
  accent2:    '#697692',  // was #5C5D8D (blue-violet) — muted slate-blue, darkened to 4.56:1 contrast on white
  neutral:    '#1A1A1A',  // was #F2F0EB — role flips: now primary text color (was: light text on dark bg). = patrio --color-text
  dark:       '#FFFFFF',  // was #1A2319 — role flips: now page background (was: darkest bg). = patrio --color-bg
  surface:    '#F8F7F4',  // was #111111 — card/panel background. = patrio --color-bg-warm
  surfaceAlt: '#F2F0EB',  // was #1e2e1e — alt/hover row background. = patrio --color-bg-alt
  border:     '#E5E2DC',  // was #2a3a29. = patrio --color-border
} as const

export const fonts = {
  serif: '"Playfair Display", Georgia, serif',   // was EB Garamond
  sans:  '"Inter", -apple-system, sans-serif',    // was Public Sans
  label: '"Inter", -apple-system, sans-serif',    // was Space Grotesk — collapsed to Inter (patrio has no third display font)
} as const

export const spacing = { sm: '8px', md: '16px', lg: '32px' } as const  // unchanged — already aligned with patrio's xs/sm scale; lg (32px) kept as-is rather than forced to patrio's md (24) or lg (48)
export const radius = { sm: '4px', md: '8px' } as const  // was 2px/4px (sharp) — matches patrio --radius-sm/md (soft-rounded)
```

`globalStyles` (same file) references `colors.dark` for `body { background }` and
`colors.neutral` for `body { color }` — no changes needed to the template string itself,
since the values it points to now resolve correctly for a light theme.

### Accent color semantics (why these four, why these values)

Grepping call sites (`ProspectMap.tsx`, `SonarTab.tsx`) shows `secondary`/`accent2`/
`accent1`/`tertiary` form a score/status ramp, not arbitrary decoration:
`secondary` = bottom quartile / muted / empty state, `accent2` then `accent1` = middle
tiers, `tertiary` = top quartile / "done" / positive. The replacement values preserve
that low→high visual ordering while reading as part of patrio's warm, desaturated palette
instead of refigan's saturated purple/orange/blue.

Refigan's originals were tuned for a *dark* background. Several call sites use these
colors as small (9–11px) text/badge foreground color, not just backgrounds — WCAG AA
requires ≥4.5:1 contrast for text at that size. Using the sRGB relative-luminance formula
(not eyeballing), the three saturated accents needed 15–20% lightness reduction from a
naive "just desaturate it" first pass to clear that bar against white:

| Role | Contrast vs. `#FFFFFF` |
|---|---|
| `secondary` `#6B6B6B` | 5.33:1 |
| `accent2` `#697692` | 4.56:1 |
| `accent1` `#8C6D87` | 4.51:1 |
| `tertiary` `#A16A3C` | 4.52:1 |

## 2. Non-color changes

- **`app/web/index.html`**: `<title>Refigan</title>` → `<title>Patrio</title>`. Google
  Fonts `<link>` swapped from `EB+Garamond / Public+Sans / Space+Grotesk` to
  `Playfair+Display / Inter`.
- **`app/web/public/favicon.svg`**: patrio's own marketing site has no favicon at all
  (verified — no `<link rel="icon">` anywhere in root `index.html`), so nothing to reuse.
  Redesign in the same square-with-letter format, recolored: sage green (`#6B8A5E`)
  background, cream (`#F2F0EB`) letter, Playfair Display instead of Space Grotesk. Since
  the app is now Patrio not Refigan, the letter changes from "R" to "P".

## 3. `docs/DESIGN.md`

`app/.claude/CLAUDE.md` states this file is "fixed... unless explicitly told to change."
The reskin instruction is that explicit permission for the ops app's design system
specifically. Rewrite it (same YAML-frontmatter format it already uses) to describe the
new light-mode patrio token system, replacing the dark "Mountain Permanence" description.
Leaving it stale would contradict the same repo's own guideline #1 ("value conceptual and
data integrity above all") — a design doc that describes a theme the code no longer has is
worse than no doc.

**Discovered during planning, confirmed with user:** `docs/DESIGN.md` is not only the ops
app's own style reference — it's the live source of truth read by four document-generation
skills (`app/.claude/skills/generate-prospectus.md`, `generate-term-sheet.md`,
`flip-quick-look.md`, `flip-proyecto.md`) that produce investor-facing PDFs, each stating
"never hardcode colors — derive from DESIGN.md tokens." Rewriting it therefore also changes
the branding those documents pick up on next generation. Flagged to the user explicitly;
confirmed decision: rewrite it anyway, accepting that investor-document branding moves to
the new light theme as a consequence of this reskin, rather than carving DESIGN.md out of
scope.

## 4. Icons — out of scope

Verified: no icon library (`lucide`, `heroicons`, `react-icons`, `feather`) is installed
in `app/web/package.json` or imported anywhere in `app/web/src`. All icons are unicode
glyphs/emoji inline in JSX. Consistent with "token-swap only, no layout restructuring" —
introducing an icon library is a new dependency touching markup in every component, not
styling. Not part of this reskin.

## 5. Component sweep

- **42 of 43** components in `app/web/src/components/` import `colors`/`fonts` from
  `../lib/theme` — these inherit the new look automatically once `theme.ts` changes, with
  no per-file edits.
- **16 files** additionally contain hardcoded hex literals bypassing the token file and
  need individual review — each hex could be an intentional one-off (e.g. a literal
  `'tomato'` error-state color, which should stay) or an accidental duplicate of a token
  value that should be replaced with the token reference instead:
  - `ProspectMap.tsx`
  - `ProjectPhotoGallery.tsx`
  - `ApiKeysSection.tsx`
  - `PhotoGallery.tsx`
  - `ProspectForm.tsx`
  - `AnalysisView.tsx`
  - `ProjectDetailPage.tsx`
  - `ProveedorDetailPage.tsx`
  - `InversoresTab.tsx`
  - `CotizacionesSection.tsx`
  - `ProspectAnalysisSection.tsx`
  - `ProspectTable.tsx`
  - `OrgTab.tsx`
  - `GanttChart.tsx`
  - `InversorPositionRow.tsx`
  - `ProspectDetailPage.tsx`

  For each: read the file, classify every hardcoded hex as either (a) a duplicate of an
  existing/new token value → replace with the token reference, or (b) a genuinely
  independent color (e.g. semantic red/green/tomato status colors unrelated to the
  refigan/patrio brand palette) → leave as-is, but verify it still has adequate contrast
  against the new light background (it was presumably chosen against dark).

## 6. Testing / verification plan

- Existing Vitest unit tests and Playwright e2e suites test *behavior*, not pixel colors
  — they must stay green through this change with zero test modifications. Full suite run
  after the token swap and after the 16-file sweep is the regression gate.
- Visual correctness is a judgment call a test suite can't make. After implementation,
  manually browse the app (login page, prospects table/detail, project detail, investor
  detail, at minimum), screenshot before/after, and share with the user for visual sign-off.

## Non-goals

- No layout/spacing/density restructuring beyond token value changes (radius).
- No icon library introduction.
- No changes to `app/api` or any backend behavior.
- No changes to patrio's own marketing site (`css/`, root `*.html`) — this reskin is
  one-directional (patrio tokens → ops app), not a shared stylesheet.
