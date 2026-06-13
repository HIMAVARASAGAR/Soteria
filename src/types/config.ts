import { z } from 'zod';

// ─── App Config ──────────────────────────────────────────────────────────────

/**
 * Zod schema for the top-level application configuration.
 *
 * - `configDir` — absolute path to the CSage config directory
 * - `version`   — semantic version string (e.g. "2.0.0")
 */
export const AppConfigSchema = z.object({
  /** Absolute path to the CSage configuration directory. */
  configDir: z.string().min(1),
  /** Semantic version of the running application. */
  version: z.string().min(1),
});

/** Top-level application configuration. */
export type AppConfig = z.infer<typeof AppConfigSchema>;

// ─── Provider Protocol ───────────────────────────────────────────────────────

/** Supported LLM provider wire protocols. */
export const ProviderProtocolSchema = z.enum([
  'openai',
  'anthropic',
  'gemini',
  'ollama',
]);

/** Supported LLM provider wire protocols. */
export type ProviderProtocol = z.infer<typeof ProviderProtocolSchema>;

// ─── Provider Type ───────────────────────────────────────────────────────────

/** Whether the provider runs in the cloud or locally. */
export const ProviderTypeSchema = z.enum(['cloud', 'local']);

/** Whether the provider runs in the cloud or locally. */
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

// ─── Provider Config ─────────────────────────────────────────────────────────

/**
 * Zod schema for an LLM provider configuration entry.
 *
 * Required fields: `id`, `name`, `type`, `model`, `protocol`.
 * Optional fields: `apiKey`, `baseUrl`.
 */
export const ProviderConfigSchema = z.object({
  /** Unique identifier for this provider entry. */
  id: z.string().min(1),
  /** Human-readable display name. */
  name: z.string().min(1),
  /** Whether the provider is cloud-hosted or local. */
  type: ProviderTypeSchema,
  /** Model identifier (e.g. "gpt-4o", "claude-sonnet-4-20250514"). */
  model: z.string().min(1),
  /** API key for authentication (cloud providers). */
  apiKey: z.string().min(1).optional(),
  /** Base URL override (e.g. for proxies or local endpoints). */
  baseUrl: z.string().url().optional(),
  /** Wire protocol used to communicate with this provider. */
  protocol: ProviderProtocolSchema,
});

/** Configuration for a single LLM provider. */
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// ─── Tool Config ─────────────────────────────────────────────────────────────

/**
 * Platform-specific install commands for a security tool.
 *
 * At least one platform should be specified; all are optional to allow
 * partial platform support.
 */
export const PlatformInstallCommandsSchema = z.object({
  /** Install command for Linux (e.g. `apt install nmap`). */
  linux: z.string().optional(),
  /** Install command for macOS (e.g. `brew install nmap`). */
  mac: z.string().optional(),
  /** Install command for Windows (e.g. `choco install nmap`). */
  win: z.string().optional(),
});

/** Platform-specific install commands. */
export type PlatformInstallCommands = z.infer<typeof PlatformInstallCommandsSchema>;

/**
 * Zod schema for a security tool definition.
 *
 * Captures the tool name, how to install it on each platform, and
 * a link to its documentation.
 */
export const ToolConfigSchema = z.object({
  /** Canonical tool name (e.g. "nmap", "sqlmap"). */
  name: z.string().min(1),
  /** Install commands keyed by platform. */
  installCommands: PlatformInstallCommandsSchema,
  /** URL pointing to the tool's official documentation. */
  documentationUrl: z.string().url(),
});

/** Configuration for a single security tool. */
export type ToolConfig = z.infer<typeof ToolConfigSchema>;
