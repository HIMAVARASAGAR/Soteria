/**
 * @module providers/registry
 * Provider registry for managing and instantiating LLM providers.
 *
 * Maintains an internal map of provider definitions and factory functions.
 * All built-in providers are registered at module load time via
 * {@link registerAllProviders}.
 */

import type { ProviderConfig } from '../types/config.js';
import type { LLMProvider, ProviderFactory, ProviderDefinition } from './types.js';
import { createOpenAIProvider } from './openai.js';
import { createAnthropicProvider } from './anthropic.js';
import { createGeminiProvider } from './gemini.js';
import { createOllamaProvider } from './ollama.js';

// ─── Internal State ──────────────────────────────────────────────────────────

interface RegistryEntry {
  readonly factory: ProviderFactory;
  readonly definition: ProviderDefinition;
}

/** Internal registry map — scoped to this module, not globally mutable. */
const registry = new Map<string, RegistryEntry>();

// ─── Registration ────────────────────────────────────────────────────────────

/**
 * Register a provider in the registry.
 *
 * @param id - Unique provider identifier.
 * @param factory - Factory function that creates provider instances.
 * @param definition - Static metadata about the provider.
 * @throws {Error} If a provider with the same ID is already registered.
 */
export function registerProvider(
  id: string,
  factory: ProviderFactory,
  definition: ProviderDefinition,
): void {
  if (registry.has(id)) {
    throw new Error(`Provider "${id}" is already registered`);
  }
  registry.set(id, { factory, definition });
}

// ─── Instantiation ──────────────────────────────────────────────────────────

/**
 * Create an LLM provider instance from configuration.
 *
 * Looks up the factory function by `config.protocol` and creates an instance.
 *
 * @param config - Provider configuration specifying protocol, model, keys, etc.
 * @returns A fully-configured {@link LLMProvider} instance.
 * @throws {Error} If no factory is registered for the given provider ID.
 */
export function createProvider(config: ProviderConfig): LLMProvider {
  const entry = registry.get(config.id);
  if (!entry) {
    throw new Error(
      `No provider registered with ID "${config.id}". ` +
      `Available: ${[...registry.keys()].join(', ')}`,
    );
  }
  return entry.factory(config);
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Get the static definition for a registered provider.
 *
 * @param id - Provider identifier.
 * @returns The provider definition, or `undefined` if not registered.
 */
export function getProviderDefinition(id: string): ProviderDefinition | undefined {
  return registry.get(id)?.definition;
}

/**
 * List all registered cloud provider definitions.
 *
 * @returns Array of cloud provider definitions.
 */
export function listCloudProviders(): ProviderDefinition[] {
  return [...registry.values()]
    .map((entry) => entry.definition)
    .filter((def) => def.type === 'cloud');
}

/**
 * List all registered local provider definitions.
 *
 * @returns Array of local provider definitions.
 */
export function listLocalProviders(): ProviderDefinition[] {
  return [...registry.values()]
    .map((entry) => entry.definition)
    .filter((def) => def.type === 'local');
}

// ─── Built-in Provider Registration ──────────────────────────────────────────

/**
 * Register all built-in providers.
 *
 * Called once at module initialization to populate the registry with
 * all supported cloud and local providers.
 */
function registerAllProviders(): void {
  // ── Cloud: OpenAI ──────────────────────────────────────────────────────
  registerProvider('openai', createOpenAIProvider, {
    id: 'openai',
    name: 'OpenAI',
    type: 'cloud',
    keyEnvVar: 'OPENAI_API_KEY',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o',
    suggestedModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'],
    protocol: 'openai',
  });

  // ── Cloud: Anthropic ───────────────────────────────────────────────────
  registerProvider('anthropic', createAnthropicProvider, {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'cloud',
    keyEnvVar: 'ANTHROPIC_API_KEY',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-sonnet-4-20250514',
    suggestedModels: [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-3-5-haiku-20241022',
    ],
    protocol: 'anthropic',
  });

  // ── Cloud: Google Gemini ───────────────────────────────────────────────
  registerProvider('gemini', createGeminiProvider, {
    id: 'gemini',
    name: 'Google Gemini',
    type: 'cloud',
    keyEnvVar: 'GEMINI_API_KEY',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    defaultModel: 'gemini-2.5-flash',
    suggestedModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    protocol: 'gemini',
  });

  // ── Cloud: Groq ────────────────────────────────────────────────────────
  registerProvider('groq', createOpenAIProvider, {
    id: 'groq',
    name: 'Groq',
    type: 'cloud',
    keyEnvVar: 'GROQ_API_KEY',
    keyUrl: 'https://console.groq.com/keys',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    suggestedModels: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
    ],
    protocol: 'openai',
  });

  // ── Cloud: Together AI ─────────────────────────────────────────────────
  registerProvider('together', createOpenAIProvider, {
    id: 'together',
    name: 'Together AI',
    type: 'cloud',
    keyEnvVar: 'TOGETHER_API_KEY',
    keyUrl: 'https://api.together.xyz/settings/api-keys',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    suggestedModels: [
      'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
      'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
      'mistralai/Mixtral-8x7B-Instruct-v0.1',
    ],
    protocol: 'openai',
  });

  // ── Cloud: Fireworks AI ────────────────────────────────────────────────
  registerProvider('fireworks', createOpenAIProvider, {
    id: 'fireworks',
    name: 'Fireworks AI',
    type: 'cloud',
    keyEnvVar: 'FIREWORKS_API_KEY',
    keyUrl: 'https://fireworks.ai/account/api-keys',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
    suggestedModels: [
      'accounts/fireworks/models/llama-v3p1-70b-instruct',
      'accounts/fireworks/models/llama-v3p1-8b-instruct',
      'accounts/fireworks/models/mixtral-8x7b-instruct',
    ],
    protocol: 'openai',
  });

  // ── Cloud: Mistral AI ──────────────────────────────────────────────────
  registerProvider('mistral', createOpenAIProvider, {
    id: 'mistral',
    name: 'Mistral AI',
    type: 'cloud',
    keyEnvVar: 'MISTRAL_API_KEY',
    keyUrl: 'https://console.mistral.ai/api-keys',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    suggestedModels: [
      'mistral-large-latest',
      'mistral-medium-latest',
      'mistral-small-latest',
    ],
    protocol: 'openai',
  });

  // ── Cloud: DeepSeek ────────────────────────────────────────────────────
  registerProvider('deepseek', createOpenAIProvider, {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'cloud',
    keyEnvVar: 'DEEPSEEK_API_KEY',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    suggestedModels: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
    protocol: 'openai',
  });

  // ── Cloud: Perplexity ──────────────────────────────────────────────────
  registerProvider('perplexity', createOpenAIProvider, {
    id: 'perplexity',
    name: 'Perplexity',
    type: 'cloud',
    keyEnvVar: 'PERPLEXITY_API_KEY',
    keyUrl: 'https://www.perplexity.ai/settings/api',
    baseUrl: 'https://api.perplexity.ai',
    defaultModel: 'sonar-pro',
    suggestedModels: ['sonar-pro', 'sonar', 'sonar-reasoning'],
    protocol: 'openai',
  });

  // ── Cloud: xAI ─────────────────────────────────────────────────────────
  registerProvider('xai', createOpenAIProvider, {
    id: 'xai',
    name: 'xAI',
    type: 'cloud',
    keyEnvVar: 'XAI_API_KEY',
    keyUrl: 'https://console.x.ai',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-3-mini',
    suggestedModels: ['grok-3-mini', 'grok-3', 'grok-2'],
    protocol: 'openai',
  });

  // ── Cloud: OpenRouter ──────────────────────────────────────────────────
  registerProvider('openrouter', createOpenAIProvider, {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'cloud',
    keyEnvVar: 'OPENROUTER_API_KEY',
    keyUrl: 'https://openrouter.ai/keys',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-4-20250514',
    suggestedModels: [
      'anthropic/claude-sonnet-4-20250514',
      'openai/gpt-4o',
      'google/gemini-2.5-flash',
      'meta-llama/llama-3.1-70b-instruct',
    ],
    protocol: 'openai',
  });

  // ── Local: Ollama ──────────────────────────────────────────────────────
  registerProvider('ollama', createOllamaProvider, {
    id: 'ollama',
    name: 'Ollama',
    type: 'local',
    baseUrl: 'http://localhost:11434',
    defaultModel: 'llama3.2',
    suggestedModels: [
      'llama3.2',
      'llama3.1',
      'mistral',
      'codellama',
      'deepseek-coder-v2',
    ],
    protocol: 'ollama',
  });
}

// Register all built-in providers at module load time
registerAllProviders();
