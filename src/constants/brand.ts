/**
 * Soteria brand identity — single source of truth for the product name,
 * tagline, accent color, and wordmark art used across the TUI.
 *
 * The accent is the gitlawb teal. Theme entries derived from it MUST stay
 * in `rgb(r,g,b)` form (never hex): the spinner's shimmer/stall interpolation
 * parses theme values with `parseRGB`, which only matches `rgb(...)` strings.
 */

export const BRAND_NAME = 'Soteria'

export const BRAND_TAGLINE = 'Secure Agentic Coding & Analysis Terminal'

/** cyber-security teal (#06b6d4) in the rgb() form required by theme consumers. */
export const BRAND_ACCENT_RGB = 'rgb(6,182,212)'

/**
 * Two-row Unicode half-block wordmark for "SOTERIA", rendered as a single
 * unified block (no split halves). Block characters (█ ▀ ▄) render correctly
 * in Apple Terminal.
 *
 *   █▀▀ █ ▄▀█ █▀▀ █▀█ ▄▀█ █▀▀ █▀█
 *   ▄██ █ █▀█ ██▄ █▀▄ █▀█ ██▄ █▄█
 */
export const WORDMARK_SOTERIA = [
  '█▀▀ █ ▄▀█ █▀▀ █▀█ ▄▀█ █▀▀ █▀█',
  '▄██ █ █▀█ ██▄ █▀▄ █▀█ ██▄ █▄█',
] as const

/** Rendered width of the wordmark. */
export const WORDMARK_WIDTH = WORDMARK_SOTERIA[0].length

