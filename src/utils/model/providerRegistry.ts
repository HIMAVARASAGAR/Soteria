/**
 * Provider Registry – Phase 0 implementation
 * -------------------------------------------
 *
 * The repository already defines a `LegacyAPIProvider` union in
 * `src/utils/model/providers.ts`. Throughout the codebase the provider id is
 * used to select model mappings (e.g. the `*_CONFIG` constants). Phase 0
 * requires a minimal, type‑safe registry that:
 *   1. Exposes a `ProviderDefinition` type.
 *   2. Provides a `ProviderRegistry` lookup keyed by each provider identifier.
 *
 * The definition currently contains only the identifier and a human‑readable
 * `displayName`. Additional fields can be added in later phases without breaking
 * existing imports.
 */

import type { LegacyAPIProvider } from './providers.js';

/**
 * Shape of a provider entry.
 *   - `id` – the canonical identifier (must be a value of `LegacyAPIProvider`).
 *   - `displayName` – a short, title‑cased name suitable for UI, logs, or
 *     diagnostics.
 */
export interface ProviderDefinition {
  /** Canonical provider identifier used in code. */
  id: LegacyAPIProvider;
  /** Human‑readable name for presentation. */
  displayName: string;
}

/**
 * Central registry of known providers.
 *
 * The keys are exactly the literals from `LegacyAPIProvider`. Representing the
 * registry as a plain `Record<LegacyAPIProvider, ProviderDefinition>` provides
 * compile‑time exhaustiveness – if a new provider is added to the union the
 * TypeScript compiler will require an entry here.
 */
export const ProviderRegistry: Record<LegacyAPIProvider, ProviderDefinition> = {
  firstParty: { id: 'firstParty', displayName: 'First‑Party Anthropic' },
  bedrock: { id: 'bedrock', displayName: 'AWS Bedrock' },
  vertex: { id: 'vertex', displayName: 'Google Vertex' },
  foundry: { id: 'foundry', displayName: 'Anthropic Foundry' },
  openai: { id: 'openai', displayName: 'OpenAI' },
  gemini: { id: 'gemini', displayName: 'Google Gemini' },
  github: { id: 'github', displayName: 'GitHub Copilot' },
  codex: { id: 'codex', displayName: 'OpenAI Codex' },
  'nvidia-nim': { id: 'nvidia-nim', displayName: 'NVIDIA NIM' },
  minimax: { id: 'minimax', displayName: 'MiniMax' },
  mistral: { id: 'mistral', displayName: 'Mistral' },
  xai: { id: 'xai', displayName: 'xAI' },
  'xiaomi-mimo': { id: 'xiaomi-mimo', displayName: 'Xiaomi Mimo' },
};
