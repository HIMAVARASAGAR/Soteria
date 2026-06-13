/**
 * @module cli/index
 * Commander CLI program entry point.
 *
 * Defines the main command line interface structure, options,
 * and registers all subcommands (`model`, `tools`, `config`, `logs`, `reset`).
 */

import { Command } from 'commander';

import { createModelCommand } from './commands/model.js';
import { createToolsCommand } from './commands/tools.js';
import { createConfigCommand } from './commands/config.js';
import { createLogsCommand } from './commands/logs.js';
import { createResetCommand } from './commands/reset.js';
import { printError } from './ui/print.js';

/**
 * Build the main Commander program.
 *
 * Configures global options, subcommands, and the default action
 * (starting the streaming REPL when no subcommand is provided).
 *
 * @returns A configured Commander Command instance.
 */
export function createProgram(): Command {
  const program = new Command('csage')
    .description('CSage - The AI Security Navigator')
    .version('2.0.0')
    .option('--verbose', 'Enable verbose logging')
    .option('--debug', 'Enable debug mode')
    .action(async () => {
      try {
        const repl = await import('./repl.js');
        await repl.startREPL();
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Register subcommands
  program.addCommand(createModelCommand());
  program.addCommand(createToolsCommand());
  program.addCommand(createConfigCommand());
  program.addCommand(createLogsCommand());
  program.addCommand(createResetCommand());

  return program;
}
