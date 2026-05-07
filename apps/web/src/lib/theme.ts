export const colors = {
  primary: '#6B8A5E',
  secondary: '#7A7260',
  tertiary: '#A2571D',
  accent1: '#654F6F',
  accent2: '#5C5D8D',
  neutral: '#F2F0EB',
  dark: '#1A2319',
  surface: '#111111',
  surfaceAlt: '#1e2e1e',
  border: '#2a3a29',
} as const

export const fonts = {
  serif: '"EB Garamond", Georgia, serif',
  sans: '"Public Sans", system-ui, sans-serif',
  label: '"Space Grotesk", sans-serif',
} as const

export const spacing = { sm: '8px', md: '16px', lg: '32px' } as const
export const radius = { sm: '2px', md: '4px' } as const

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
