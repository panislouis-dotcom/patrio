---
name: Refigan
colors:
  primary: "#6B8A5E"
  secondary: "#7A7260"
  tertiary: "#A2571D"
  accent1: "#654F6F"
  accent2: "#60619cff"
  neutral: "#F2F0EB"
  dark: "#1A2319"
typography:
  h1:
    fontFamily: EB Garamond
    fontSize: 3rem
  h2:
    fontFamily: EB Garamond
    fontSize: 2rem
  body-md:
    fontFamily: Public Sans
    fontSize: 1rem
  label-caps:
    fontFamily: Space Grotesk
    fontSize: 0.75rem
    letterSpacing: 0.12em
    textTransform: uppercase
rounded:
  sm: 2px
  md: 4px
spacing:
  sm: 8px
  md: 16px
  lg: 32px
---

# Refigan Design System

## Overview

Mountain Permanence meets Monterrey Pragmatism. Refigan's visual language is grounded in the textures of the Sierra Madre — stone, earth, dry pine — filtered through the discipline of institutional real estate. Nothing decorative. Every element earns its place.

## Colors

The palette is rooted in the landscape: sage hillsides, burnt-clay earth, sierra stone, dusk sky.

- **Primary (#6B8A5E):** Sage green — the brand color. UI surfaces, borders, positive indicators.
- **Secondary (#7A7260):** Stone — warm grey-taupe for metadata, borders, captions, secondary text.
- **Tertiary (#A2571D):** Burnt terracotta — the signature accent. CTAs, section bands, key numbers.
- **Accent1 (#654F6F):** Mauve — deep plum for contrast moments, badges, secondary CTAs.
- **Accent2 (#5C5D8D):** Slate — muted indigo for data highlights, links, secondary indicators.
- **Neutral (#F2F0EB):** Pale linen — the page foundation. Cool-warm off-white.
- **Dark (#1A2319):** Deep pine — dominant surfaces, cover, footer, body text on light backgrounds.

## Typography

- **EB Garamond** — headlines and section titles. Classic old-style serif — thin, elegant strokes with natural contrast. Italic variant used for editorial pull-quotes and impact blocks.
- **Public Sans** — body copy and UI text. Clean, legible at small sizes, works on mobile.
- **Space Grotesk** — label caps only. Section labels, metadata, data table headers. Always uppercase, tracked out.

## Wordmark

`R E F I G A N` — all caps, tracked wide, set in Space Grotesk. Never use a compressed or bold weight. The spacing is the mark.

## Prospectus Layout Principles

- **Data first.** Key numbers (ROI, cap rate, investment, valuation) are the hero — large, terracotta-accented, never buried.
- **Photos bleed.** Building and site photography runs edge-to-edge. No borders, no drop shadows.
- **Sparse.** Generous whitespace on neutral. One key number or idea per section.
- **Bilingual-ready.** Layout accommodates Spanish primary, English secondary where needed.

## Component Patterns

### Metric Card

Large number in EB Garamond (tertiary) + label in Space Grotesk caps (secondary) below.

```text
$19,000,000
VALUACIÓN ACTUAL
```

### Section Label

Space Grotesk, 0.75rem, 0.12em tracking, uppercase, secondary color. Always above the section heading.

```text
TRACK RECORD
Edificio Uno
```

### Timeline Row

Date in label-caps (secondary) / event description in body-md (primary). Minimal left border in tertiary.
