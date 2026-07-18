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
