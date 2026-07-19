---
name: Patrio
colors:
  primary: "#6B8A5E"
  secondary: "#6B6B6B"
  tertiary: "#A16A3C"
  accent1: "#8C6D87"
  accent2: "#697692"
  neutral: "#F2F0EB"
  dark: "#1A1A1A"
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
- **Neutral (#F2F0EB):** Pale linen — the page foundation.
- **Dark (#1A1A1A):** Near-black ink — cover, footer, and body text on light backgrounds.

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

Date in label-caps (secondary) / event description in body-md (primary). Minimal left border in tertiary.
