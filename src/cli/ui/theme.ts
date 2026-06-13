/**
 * @module cli/ui/theme
 * Chalk-based color palette for the CSage terminal UI.
 *
 * Every color used in the CLI should come from this module so that
 * branding changes are confined to a single source of truth.
 */

import chalk from 'chalk';

/** CSage brand color palette for terminal output. */
export const theme = {
  /** CSage Violet — primary brand accent. */
  brand: chalk.hex('#af5fff'),
  /** Green — success indicators. */
  success: chalk.green,
  /** Red — error messages. */
  error: chalk.red,
  /** Yellow — warning messages. */
  warning: chalk.yellow,
  /** Cyan — informational messages. */
  info: chalk.cyan,
  /** Gray — de-emphasised text. */
  dim: chalk.gray,
  /** Bold — structural emphasis. */
  bold: chalk.bold,
  /** Bold Violet — section headings. */
  heading: chalk.bold.hex('#af5fff'),
  /** REPL prompt color. */
  prompt: chalk.bold.hex('#af5fff'),
  /** Tool-call accent. */
  toolCall: chalk.hex('#ffd700'),
  /** Tool-result accent. */
  toolResult: chalk.gray,
  /** Slash-command accent. */
  slash: chalk.cyan,
  /** Box border color. */
  box: chalk.hex('#555555'),
  /** Thinking text color. */
  thinking: chalk.hex('#888888').italic,
  /** Approval prompt accent. */
  approval: chalk.hex('#ff8c00').bold,

  /** Colors keyed by finding severity level. */
  severity: {
    CRITICAL: chalk.red.bold,
    HIGH: chalk.hex('#ff8c00').bold, // orange
    MEDIUM: chalk.yellow,
    LOW: chalk.blue,
    INFO: chalk.cyan,
  } as Record<string, (typeof chalk)>,

  /** Colors keyed by command risk level. */
  risk: {
    LOW: chalk.green,
    MEDIUM: chalk.yellow,
    HIGH: chalk.hex('#ff8c00'),
  } as Record<string, (typeof chalk)>,
} as const;
