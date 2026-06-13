/**
 * @module cli/commands/reset
 * The `csage reset` command — factory reset CSage by deleting ~/.csage.
 *
 * Safety mechanism: requires the user to type "RESET" to confirm.
 */

import { Command } from 'commander';
import { rmSync, existsSync } from 'node:fs';
import prompts from 'prompts';

import {
  banner,
  printSection,
  printInfo,
  printError,
  printOk,
  printWarning,
} from '../ui/print.js';
import { getConfigDir } from '../../storage/config.js';

async function promptText(message: string, initial?: string): Promise<string> {
  const response = await prompts({ type: 'text', name: 'value', message, initial });
  return typeof response.value === 'string' ? response.value : '';
}

// ─── Subcommand Action ───────────────────────────────────────────────────────

/**
 * Run the factory reset process.
 */
async function runFactoryReset(): Promise<void> {
  banner();
  printSection('Factory Reset CSage');

  const configDir = getConfigDir();
  printWarning(`This will delete the entire configuration directory: ${configDir}`);
  printWarning('All saved configurations, API keys, custom tools, and logs will be permanently deleted.');
  console.log('');

  const confirmText = await promptText(
    'To confirm, type "RESET" (in all caps):'
  );

  if (confirmText !== 'RESET') {
    printInfo('Reset cancelled. No files were deleted.');
    return;
  }

  if (existsSync(configDir)) {
    try {
      rmSync(configDir, { recursive: true, force: true });
      printOk('Factory reset complete. CSage is now in its default state.');
    } catch (error) {
      printError(`Failed to delete configuration directory: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  } else {
    printInfo('Configuration directory does not exist. Nothing to clear.');
  }
}

// ─── Command Definition ──────────────────────────────────────────────────────

/**
 * Create the `csage reset` command.
 *
 * @returns A configured Commander command.
 */
export function createResetCommand(): Command {
  const cmd = new Command('reset')
    .description('Factory reset CSage (deletes all config, keys, logs, and custom tools)')
    .action(async () => {
      await runFactoryReset();
    });

  return cmd;
}
