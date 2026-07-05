// Canvas mirror of the @theme design tokens in src/app/globals.css.
// Canvas 2D contexts cannot resolve CSS variables, so chart drawing code
// imports these constants; keep values in sync with @theme.
export const CHART_COLORS = {
  ink: '#1a1a1a',
  muted: '#6b6b6b',
  faint: '#c0c0c0',
  line: '#e8e8e5',
  lineSoft: '#f0f0ed',
  paper: '#fafaf8',
  card: '#ffffff',
  danger: '#c75c5c',
  success: '#7a9e7e',
  accent: '#2d2d2d',
} as const;
