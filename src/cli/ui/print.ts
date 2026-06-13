/**
 * @module cli/ui/print
 * Minimal terminal print helpers for non-REPL subcommands.
 */

import { theme } from './theme.js';

const VERSION = '2.0.0';
const SEPARATOR = theme.dim('-'.repeat(60));

/** Print the CSage banner. */
export function banner(): void {
  console.log('');
  console.log(theme.heading('  CSage'));
  console.log(theme.dim(`  v${VERSION} - Ethical security testing assistant`));
  console.log(SEPARATOR);
  console.log('');
}

/** Print a section header. */
export function printSection(title: string): void {
  console.log('');
  console.log(theme.heading(`> ${title}`));
  console.log(SEPARATOR);
}

/** Print an informational message. */
export function printInfo(msg: string): void {
  console.log(theme.info('  i ') + msg);
}

/** Print an error message. */
export function printError(msg: string): void {
  console.error(theme.error('  x ') + theme.error(msg));
}

/** Print a warning message. */
export function printWarning(msg: string): void {
  console.log(theme.warning('  ! ') + theme.warning(msg));
}

/** Print a success message. */
export function printOk(msg: string): void {
  console.log(theme.success('  ok ') + msg);
}
