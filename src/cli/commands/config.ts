/**
 * @module cli/commands/config
 * The `csage config` command — manage CSage settings and API keys.
 *
 * Subcommands:
 * - `config show` — display current provider configuration
 * - `config keys` — list stored API keys (masked)
 * - `config keys-set <provider> [key]` — set API key for a provider
 * - `config keys-remove <provider>` — remove API key for a provider
 */

import { Command } from 'commander';
import prompts from 'prompts';

import {
  banner,
  printSection,
  printInfo,
  printError,
  printOk,
  printWarning,
} from '../ui/print.js';
import { theme } from '../ui/theme.js';
import { loadProviderConfig } from '../../storage/config.js';
import {
  listApiKeys,
  saveApiKey,
  removeApiKey,
  loadApiKey,
} from '../../storage/keychain.js';

async function promptPassword(message: string): Promise<string> {
  const response = await prompts({ type: 'password', name: 'value', message });
  return typeof response.value === 'string' ? response.value : '';
}

// ─── Subcommands ─────────────────────────────────────────────────────────────

/**
 * Display current configuration details.
 */
function showConfig(): void {
  banner();
  printSection('Provider Configuration');

  const config = loadProviderConfig();
  if (!config) {
    printWarning('No provider configured. Run `csage model` to configure one.');
    return;
  }

  printInfo(`Active Provider: ${theme.bold(config.name)} (${config.id})`);
  printInfo(`Model:           ${config.model}`);
  printInfo(`Protocol:        ${config.protocol}`);
  if (config.baseUrl) {
    printInfo(`Base URL:        ${config.baseUrl}`);
  }

  const keys = listApiKeys();
  const hasKey = keys.some((k) => k.provider === config.id);
  printInfo(`API Key:         ${hasKey ? theme.success('configured') : theme.warning('not set')}`);
}

/**
 * List all saved API keys in a masked format.
 */
function showApiKeys(): void {
  banner();
  printSection('Stored API Keys');

  const keys = listApiKeys();
  if (keys.length === 0) {
    printInfo('No API keys currently stored.');
    return;
  }

  for (const { provider, maskedKey } of keys) {
    console.log(`  ${theme.bold(provider.padEnd(15))} : ${maskedKey}`);
  }
  console.log('');
}

/**
 * Save an API key for a provider.
 */
async function setApiKey(provider: string, key?: string): Promise<void> {
  const providerLower = provider.toLowerCase();
  let finalKey = key;

  if (!finalKey) {
    finalKey = await promptPassword(`Enter API key for "${providerLower}":`);
  }

  if (!finalKey || !finalKey.trim()) {
    printError('API key cannot be empty.');
    return;
  }

  saveApiKey(providerLower, finalKey.trim());
  printOk(`API key for "${providerLower}" saved.`);
}

/**
 * Remove an API key for a provider.
 */
function removeProviderApiKey(provider: string): void {
  const providerLower = provider.toLowerCase();
  const existing = loadApiKey(providerLower);

  if (!existing) {
    printWarning(`No API key found for "${providerLower}".`);
    return;
  }

  removeApiKey(providerLower);
  printOk(`API key for "${providerLower}" removed.`);
}

// ─── Command Definition ──────────────────────────────────────────────────────

/**
 * Create the `csage config` command with subcommands.
 *
 * @returns A configured Commander command.
 */
export function createConfigCommand(): Command {
  const cmd = new Command('config')
    .description('Manage CSage configuration and keys')
    .action(() => {
      showConfig();
    });

  cmd
    .command('show')
    .description('Display current provider configuration')
    .action(() => {
      showConfig();
    });

  cmd
    .command('keys')
    .description('List stored API keys (masked)')
    .action(() => {
      showApiKeys();
    });

  cmd
    .command('keys-set <provider> [key]')
    .description('Set API key for a provider (prompts if key omitted)')
    .action(async (provider: string, key?: string) => {
      await setApiKey(provider, key);
    });

  cmd
    .command('keys-remove <provider>')
    .description('Remove API key for a provider')
    .action((provider: string) => {
      removeProviderApiKey(provider);
    });

  return cmd;
}
