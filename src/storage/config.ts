/**
 * @module storage/config
 * @description Manages the CSage provider configuration file at
 * `~/.csage/config.json`.
 *
 * All filesystem operations are **synchronous** — this module is used
 * during CLI startup where blocking I/O is acceptable and avoids
 * race conditions with concurrent reads/writes.
 *
 * Sensitive files are written with mode `0o600` (owner read/write only).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { ProviderConfigSchema } from '../types/config.js';
import type { ProviderConfig } from '../types/config.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Name of the CSage configuration directory. */
const CONFIG_DIR_NAME = '.csage';

/** Name of the provider configuration file inside the config directory. */
const CONFIG_FILE_NAME = 'config.json';

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Return the absolute path to the CSage configuration directory
 * (`~/.csage`), creating it if it does not already exist.
 *
 * The directory is created with default permissions (typically `0o755`
 * on Unix). Individual sensitive files inside it are tightened to
 * `0o600` at write time.
 *
 * @returns Absolute path to `~/.csage`.
 *
 * @example
 * ```ts
 * const dir = getConfigDir();
 * // → '/Users/alice/.csage'
 * ```
 */
export function getConfigDir(): string {
  const dir = join(homedir(), CONFIG_DIR_NAME);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Load and validate the provider configuration from
 * `~/.csage/config.json`.
 *
 * Returns `null` when:
 * - The file does not exist (first run).
 * - The file contains invalid JSON.
 * - The JSON does not pass Zod validation.
 *
 * @returns A validated {@link ProviderConfig} object, or `null`.
 *
 * @example
 * ```ts
 * const cfg = loadProviderConfig();
 * if (cfg) {
 *   console.log(`Active provider: ${cfg.activeProvider}`);
 * }
 * ```
 */
export function loadProviderConfig(): ProviderConfig | null {
  const filePath = join(getConfigDir(), CONFIG_FILE_NAME);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    const result = ProviderConfigSchema.safeParse(parsed);

    if (result.success) {
      return result.data;
    }

    // Log validation issues but don't throw — callers treat null as
    // "needs setup".
    return null;
  } catch {
    // JSON parse error or filesystem error — treat as absent.
    return null;
  }
}

/**
 * Persist a provider configuration to `~/.csage/config.json`.
 *
 * The file is written atomically with mode `0o600` so that API keys
 * or other secrets embedded in the config are not world-readable.
 *
 * @param config - A valid {@link ProviderConfig} to persist.
 *
 * @example
 * ```ts
 * saveProviderConfig({
 *   activeProvider: 'openai',
 *   providers: {
 *     openai: { model: 'gpt-4o' },
 *   },
 *   version: 1,
 * });
 * ```
 */
export function saveProviderConfig(config: ProviderConfig): void {
  const dir = getConfigDir();
  const filePath = join(dir, CONFIG_FILE_NAME);
  const json = JSON.stringify(config, null, 2) + '\n';

  writeFileSync(filePath, json, { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Delete the provider configuration file, effectively resetting
 * CSage to its first-run state.
 *
 * This is a no-op if the config file does not exist.
 *
 * @example
 * ```ts
 * resetConfig();
 * // ~/.csage/config.json is now gone.
 * ```
 */
export function resetConfig(): void {
  const filePath = join(getConfigDir(), CONFIG_FILE_NAME);

  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
