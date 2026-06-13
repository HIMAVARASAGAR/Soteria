/**
 * @module providers/types
 * Core interfaces and type definitions for the LLM provider abstraction layer.
 */

import type {
  ChatOptions,
  ChatResponse,
  StreamChunk,
  HealthStatus,
} from '../types/provider.js';
import type { ProviderConfig, ProviderProtocol, ProviderType } from '../types/config.js';

// ─── LLM Provider Interface ─────────────────────────────────────────────────

/**
 * Unified interface for interacting with any LLM provider.
 *
 * Every provider — cloud or local — must implement this contract,
 * enabling the rest of the application to be provider-agnostic.
 */
export interface LLMProvider {
  /** Unique identifier for this provider instance. */
  readonly id: string;
  /** Human-readable display name. */
  readonly name: string;
  /** Whether the provider is cloud-hosted or local. */
  readonly type: 'cloud' | 'local';
  /** Whether the provider supports native tool/function calling. */
  readonly supportsToolCalling: boolean;

  /**
   * Send a chat completion request and receive the full response.
   *
   * @param options - Chat options including messages, system prompt, and generation params.
   * @returns The complete chat response with content and optional token usage.
   */
  chat(options: ChatOptions): Promise<ChatResponse>;

  /**
   * Send a chat completion request and receive a streaming response.
   *
   * Yields incremental chunks as they arrive from the provider.
   *
   * @param options - Chat options including messages, system prompt, and generation params.
   * @returns An async generator yielding stream chunks.
   */
  stream(options: ChatOptions): AsyncGenerator<StreamChunk>;

  /**
   * Check whether the provider is reachable and functional.
   *
   * @returns Health status with latency and optional error info.
   */
  ping(): Promise<HealthStatus>;
}

// ─── Provider Factory ────────────────────────────────────────────────────────

/**
 * Factory function that creates an {@link LLMProvider} instance from configuration.
 *
 * @param config - The provider configuration to instantiate from.
 * @returns A fully-configured provider instance.
 */
export type ProviderFactory = (config: ProviderConfig) => LLMProvider;

// ─── Provider Definition ────────────────────────────────────────────────────

/**
 * Static metadata describing a registered provider.
 *
 * Used for display in CLI setup wizards, documentation,
 * and provider selection UIs.
 */
export interface ProviderDefinition {
  /** Unique provider identifier (e.g. "openai", "ollama"). */
  readonly id: string;
  /** Human-readable display name (e.g. "OpenAI", "Ollama"). */
  readonly name: string;
  /** Whether the provider is cloud-hosted or local. */
  readonly type: ProviderType;
  /** Environment variable name that holds the API key (cloud providers). */
  readonly keyEnvVar?: string;
  /** URL where the user can obtain an API key. */
  readonly keyUrl?: string;
  /** Default base URL for the provider's API endpoint. */
  readonly baseUrl?: string;
  /** Default model identifier to use if none is specified. */
  readonly defaultModel: string;
  /** List of recommended models for display in selection UIs. */
  readonly suggestedModels: readonly string[];
  /** Wire protocol used by this provider. */
  readonly protocol: ProviderProtocol;
}
