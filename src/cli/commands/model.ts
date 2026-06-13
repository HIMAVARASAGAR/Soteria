/**
 * @module cli/commands/model
 * The `csage model` command — interactive LLM provider setup wizard.
 *
 * Subcommands:
 * - `model` / `model set`  — interactive setup wizard
 * - `model show`           — display current config
 * - `model reset`          — clear config
 * - `model test`           — ping the current provider
 */

import { Command } from 'commander';
import ora from 'ora';
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
import {
  loadProviderConfig,
  saveProviderConfig,
  resetConfig,
} from '../../storage/config.js';
import { saveApiKey, loadApiKey } from '../../storage/keychain.js';
import { createProvider, listCloudProviders, listLocalProviders } from '../../providers/registry.js';
import type { ProviderConfig } from '../../types/config.js';
import type { ProviderDefinition } from '../../providers/types.js';

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

async function promptText(message: string, initial?: string): Promise<string> {
  const response = await prompts({ type: 'text', name: 'value', message, initial });
  return typeof response.value === 'string' ? response.value : '';
}

async function promptPassword(message: string): Promise<string> {
  const response = await prompts({ type: 'password', name: 'value', message });
  return typeof response.value === 'string' ? response.value : '';
}

async function promptSelect<T>(message: string, choices: Array<{ title: string; value: T }>): Promise<T> {
  const response = await prompts({ type: 'select', name: 'value', message, choices });
  return response.value as T;
}

// ─── Setup Wizard ────────────────────────────────────────────────────────────

/**
 * Run the interactive provider setup wizard.
 */
async function setupWizard(): Promise<void> {
  banner();
  printSection('Model Setup Wizard');

  // Step 1: Local or Cloud?
  const providerType = await promptSelect<'cloud' | 'local'>('Provider type:', [
    { title: '☁️  Cloud (OpenAI, Anthropic, Gemini, etc.)', value: 'cloud' },
    { title: '🏠 Local (Ollama)', value: 'local' },
  ]);

  if (providerType === 'cloud') {
    await setupCloudProvider();
  } else {
    await setupLocalProvider();
  }
}

/**
 * Configure a cloud LLM provider.
 */
async function setupCloudProvider(): Promise<void> {
  const cloudProviders = listCloudProviders();

  if (cloudProviders.length === 0) {
    printError('No cloud providers registered.');
    return;
  }

  // Step 2: Select provider
  const provider = await promptSelect<ProviderDefinition>('Select cloud provider:', [
    ...cloudProviders.map((p) => ({
      title: `${p.name} (${p.defaultModel})`,
      value: p,
    })),
  ]);

  printInfo(`Selected: ${provider.name}`);

  // Step 3: Select model
  const model = await promptSelect<string>('Select model:', [
    ...provider.suggestedModels.map((m) => ({
      title: m,
      value: m,
    })),
    { title: '✏️  Enter custom model name', value: '__custom__' },
  ]);

  const finalModel = model === '__custom__'
    ? await promptText('Model name:')
    : model;

  // Step 4: API key
  if (provider.keyUrl) {
    printInfo(`Get your API key at: ${theme.info(provider.keyUrl)}`);
  }

  const apiKey = await promptPassword(`${provider.name} API key:`);
  if (!apiKey) {
    printError('API key is required for cloud providers.');
    return;
  }

  // Step 5: Optional base URL override
  const baseUrlInput = await promptText(
    'Base URL (leave empty for default):',
    provider.baseUrl ?? '',
  );
  const baseUrl = baseUrlInput.trim() || provider.baseUrl;

  // Build config
  const config: ProviderConfig = {
    id: provider.id,
    name: provider.name,
    type: 'cloud',
    model: finalModel,
    protocol: provider.protocol,
    ...(baseUrl ? { baseUrl } : {}),
  };

  // Step 6: Test connection
  printInfo('Testing connection…');
  const testConfig: ProviderConfig = { ...config, apiKey };
  const llm = createProvider(testConfig);

  const health = await withSpinner('Pinging provider…', () => llm.ping());
  if (!health.ok) {
    printError(`Connection failed: ${health.error ?? 'unknown error'}`);
    printWarning('Config was NOT saved. Please check your API key and try again.');
    return;
  }

  printOk(`Connected to ${provider.name} in ${health.latencyMs ?? 0}ms`);

  // Step 7: Save
  saveProviderConfig(config);
  saveApiKey(provider.id, apiKey);

  printOk('Provider configuration saved.');
  printInfo(`Provider: ${config.name}`);
  printInfo(`Model:    ${config.model}`);
}

/**
 * Configure a local LLM provider (Ollama).
 */
async function setupLocalProvider(): Promise<void> {
  const localProviders = listLocalProviders();

  if (localProviders.length === 0) {
    printError('No local providers registered.');
    return;
  }

  const provider = localProviders.length === 1
    ? localProviders[0]!
    : await promptSelect<ProviderDefinition>('Select local provider:', [
        ...localProviders.map((p) => ({
          title: p.name,
          value: p,
        })),
      ]);

  // Step 2: Connection URL
  const defaultUrl = provider.baseUrl ?? 'http://localhost:11434';
  const baseUrl = await promptText('Ollama server URL:', defaultUrl);

  // Step 3: Test connection
  const config: ProviderConfig = {
    id: provider.id,
    name: provider.name,
    type: 'local',
    model: provider.defaultModel,
    protocol: provider.protocol,
    baseUrl: baseUrl || defaultUrl,
  };

  const llm = createProvider(config);

  const health = await withSpinner('Checking Ollama connection…', () => llm.ping());
  if (!health.ok) {
    printError(`Cannot reach Ollama at ${baseUrl || defaultUrl}`);
    printWarning('Make sure Ollama is running: `ollama serve`');
    return;
  }

  printOk(`Connected to Ollama in ${health.latencyMs ?? 0}ms`);

  // Step 4: Select model
  const model = await promptSelect<string>('Select model:', [
    ...provider.suggestedModels.map((m) => ({
      title: m,
      value: m,
    })),
    { title: '✏️  Enter custom model name', value: '__custom__' },
  ]);

  const finalModel = model === '__custom__'
    ? await promptText('Model name:')
    : model;

  config.model = finalModel;

  // Step 5: Save
  saveProviderConfig({ ...config, model: finalModel });
  printOk('Local provider configuration saved.');
  printInfo(`Provider: ${config.name}`);
  printInfo(`Model:    ${finalModel}`);
  printInfo(`Endpoint: ${config.baseUrl}`);
}

// ─── Subcommands ─────────────────────────────────────────────────────────────

/**
 * Display the current provider configuration.
 */
function showConfig(): void {
  const config = loadProviderConfig();
  if (!config) {
    printWarning('No provider configured. Run `csage model` to set one up.');
    return;
  }

  printSection('Current Provider Configuration');
  printInfo(`ID:       ${config.id}`);
  printInfo(`Name:     ${config.name}`);
  printInfo(`Type:     ${config.type}`);
  printInfo(`Model:    ${config.model}`);
  printInfo(`Protocol: ${config.protocol}`);
  if (config.baseUrl) {
    printInfo(`Base URL: ${config.baseUrl}`);
  }

  const hasKey = loadApiKey(config.id);
  printInfo(`API Key:  ${hasKey ? theme.success('configured') : theme.warning('not set')}`);
}

/**
 * Reset the provider configuration.
 */
function resetProviderConfig(): void {
  resetConfig();
  printOk('Provider configuration has been reset.');
}

/**
 * Test the current provider connection.
 */
async function testConnection(): Promise<void> {
  const config = loadProviderConfig();
  if (!config) {
    printError('No provider configured. Run `csage model` to set one up.');
    process.exit(1);
  }

  const apiKey = loadApiKey(config.id);
  const resolvedConfig: ProviderConfig = apiKey
    ? { ...config, apiKey }
    : config;

  const llm = createProvider(resolvedConfig);

  const health = await withSpinner(`Testing ${config.name}…`, () => llm.ping());
  if (health.ok) {
    printOk(`${config.name} is reachable (${health.latencyMs ?? 0}ms)`);
  } else {
    printError(`${config.name} unreachable: ${health.error ?? 'unknown error'}`);
    process.exit(1);
  }
}

// ─── Command Definition ──────────────────────────────────────────────────────

/**
 * Create the `csage model` command with subcommands.
 *
 * @returns A configured Commander command.
 */
export function createModelCommand(): Command {
  const cmd = new Command('model')
    .description('Configure the LLM provider')
    .action(async () => {
      await setupWizard();
    });

  cmd
    .command('set')
    .description('Interactive provider setup wizard')
    .action(async () => {
      await setupWizard();
    });

  cmd
    .command('show')
    .description('Display current provider configuration')
    .action(() => {
      showConfig();
    });

  cmd
    .command('reset')
    .description('Clear provider configuration')
    .action(() => {
      resetProviderConfig();
    });

  cmd
    .command('test')
    .description('Test current provider connection')
    .action(async () => {
      await testConnection();
    });

  return cmd;
}
