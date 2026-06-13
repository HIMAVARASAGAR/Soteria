/**
 * @module cli/commands/tools
 * The `csage tools` command — manage external security tools.
 *
 * Subcommands:
 * - `tools list` (default) — show all tools with ✓/✗ for installed status
 * - `tools install <tool...>` — install specified tools
 * - `tools add <name> <command>` — add custom tool to registry
 * - `tools remove <name>` — remove custom tool
 */

import { Command } from 'commander';
import ora from 'ora';

import {
  banner,
  printSection,
  printInfo,
  printError,
  printOk,
  printWarning,
} from '../ui/print.js';
import { theme } from '../ui/theme.js';
import { getShellInfo } from '../../utils/shell.js';
import {
  listTools,
  addTool,
  removeTool,
  getInstaller,
  getToolEntry,
} from '../../tools/registry.js';
import { isToolInstalled, executeCommand } from '../../tools/executor.js';
import type { ToolCategory } from '../../types/tool.js';

async function withSpinner<T>(text: string, fn: () => Promise<T>): Promise<T> {
  const spinner = ora({ text, color: 'magenta' }).start();
  try {
    const result = await fn();
    spinner.succeed(theme.success(text));
    return result;
  } catch (error) {
    spinner.fail(theme.error(text));
    throw error;
  }
}

// ─── Subcommands ─────────────────────────────────────────────────────────────

/**
 * List all known tools and their installation status.
 */
async function runListTools(): Promise<void> {
  banner();
  printSection('Security Tool Registry');

  const tools = await listTools();
  if (tools.length === 0) {
    printInfo('No tools registered.');
    return;
  }

  for (const { name, entry } of tools) {
    const installed = await isToolInstalled(name);
    const statusSymbol = installed
      ? theme.success('✓ installed')
      : theme.warning('✗ missing');

    console.log(`  ${theme.bold(name.padEnd(15))} [${entry.category.padEnd(12)}]  ${statusSymbol}`);
    if (entry.documentationUrl) {
      console.log(`    ${theme.dim('Docs:')} ${theme.dim(entry.documentationUrl)}`);
    }
    const shellInfo = getShellInfo();
    const installer = entry.installCommands[shellInfo.os === 'windows' ? 'win' : shellInfo.os];
    if (installer) {
      console.log(`    ${theme.dim('Install:')} ${theme.dim(installer)}`);
    }
    console.log('');
  }
}

/**
 * Install one or more specified tools.
 *
 * @param names - Array of tool names to install.
 */
async function runInstallTools(names: string[]): Promise<void> {
  banner();
  printSection('Installing Security Tools');

  const shellInfo = getShellInfo();
  const platform = shellInfo.os;

  for (const name of names) {
    const tool = await getToolEntry(name);
    if (!tool) {
      printError(`Unknown tool: "${name}". You can register it first using \`csage tools add\`.`);
      continue;
    }

    const alreadyInstalled = await isToolInstalled(name);
    if (alreadyInstalled) {
      printOk(`Tool "${name}" is already installed.`);
      continue;
    }

    const installer = await getInstaller(name, platform);
    if (!installer) {
      printWarning(`No install command defined for "${name}" on ${platform}.`);
      if (tool.documentationUrl) {
        printInfo(`Refer to documentation for manual setup: ${tool.documentationUrl}`);
      }
      continue;
    }

    printInfo(`Installing "${name}" via: ${theme.bold(installer)}`);

    try {
      const result = await withSpinner(`Installing ${name}…`, async () => {
        return executeCommand(installer);
      });

      if (result.success) {
        printOk(`Successfully installed "${name}"!`);
      } else {
        printError(`Failed to install "${name}": ${result.error ?? 'unknown error'}`);
        if (result.stderr) {
          console.error(theme.dim(result.stderr));
        }
      }
    } catch (error) {
      printError(`Error running installation: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Add a custom tool to the registry.
 */
async function runAddTool(
  name: string,
  installCommand: string,
  options: { category: string; doc?: string },
): Promise<void> {
  const category = options.category as ToolCategory;
  const docUrl = options.doc ?? '';

  const entry = {
    category,
    installCommands: {
      linux: installCommand,
      mac: installCommand,
      win: installCommand,
    },
    documentationUrl: docUrl,
  };

  await addTool(name, entry);
  printOk(`Successfully added tool "${name}" to registry.`);
}

/**
 * Remove a custom tool from the registry.
 */
async function runRemoveTool(name: string): Promise<void> {
  const tool = await getToolEntry(name);
  if (!tool) {
    printError(`Tool "${name}" does not exist.`);
    return;
  }

  await removeTool(name);
  printOk(`Successfully removed tool "${name}" from registry.`);
}

// ─── Command Definition ──────────────────────────────────────────────────────

/**
 * Create the `csage tools` command with subcommands.
 *
 * @returns A configured Commander command.
 */
export function createToolsCommand(): Command {
  const cmd = new Command('tools')
    .description('Manage external security tools')
    .action(async () => {
      await runListTools();
    });

  cmd
    .command('list')
    .description('List registered tools and their status')
    .action(async () => {
      await runListTools();
    });

  cmd
    .command('install <tool...>')
    .description('Attempt to install specified tools')
    .action(async (names: string[]) => {
      await runInstallTools(names);
    });

  cmd
    .command('add <name> <command>')
    .description('Add a custom tool to the registry')
    .option('-c, --category <category>', 'Tool category (recon, scanner, fuzzer, exploit, brute-force, ssl, static)', 'recon')
    .option('-d, --doc <url>', 'Documentation URL')
    .action(async (name: string, command: string, options: { category: string; doc?: string }) => {
      await runAddTool(name, command, options);
    });

  cmd
    .command('remove <name>')
    .description('Remove a custom tool from the registry')
    .action(async (name: string) => {
      await runRemoveTool(name);
    });

  return cmd;
}
