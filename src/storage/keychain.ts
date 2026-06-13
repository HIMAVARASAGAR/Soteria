/**
 * @module storage/keychain
 * @description Manages API key storage in `~/.csage/.env` using a
 * simple dotenv-style format (`PROVIDER_API_KEY=sk-xxx`).
 *
 * No third-party dotenv library is needed — the format is trivial
 * enough to parse directly.
 *
 * All filesystem operations are **synchronous** (startup-time ops).
 * The `.env` file is written with mode `0o600` (owner-only access).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getConfigDir } from './config.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Name of the dotenv secrets file inside `~/.csage/`. */
const ENV_FILE_NAME = '.env';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A provider entry with the key partially masked for display. */
export interface MaskedApiKey {
  /** Normalised provider name (lowercase). */
  readonly provider: string;
  /** Masked key showing first 4 + last 4 characters. */
  readonly maskedKey: string;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Canonical env-var name for a provider's API key.
 *
 * @example `toEnvKey('openai') → 'OPENAI_API_KEY'`
 */
function toEnvKey(provider: string): string {
  return `${provider.toUpperCase()}_API_KEY`;
}

/** Absolute path to `~/.csage/.env`. */
function envFilePath(): string {
  return join(getConfigDir(), ENV_FILE_NAME);
}

/**
 * Read all lines from the `.env` file.
 * Returns an empty array if the file does not exist.
 */
function readEnvLines(): string[] {
  const filePath = envFilePath();
  if (!existsSync(filePath)) {
    return [];
  }
  return readFileSync(filePath, 'utf-8').split('\n');
}

/**
 * Write lines back to the `.env` file with `0o600` permissions.
 *
 * Filters out empty trailing lines to keep the file tidy, but
 * always ends with a newline.
 */
function writeEnvLines(lines: string[]): void {
  // Remove trailing blank lines, then ensure final newline
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') {
    lines.pop();
  }
  const content = lines.join('\n') + '\n';
  writeFileSync(envFilePath(), content, { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Mask an API key for safe display.
 *
 * Keys shorter than 10 characters are fully replaced with `****`.
 * Otherwise: first 4 chars + `...` + last 4 chars.
 */
function maskKey(key: string): string {
  if (key.length < 10) {
    return '****';
  }
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Store (or update) an API key for the given provider.
 *
 * If a key for the provider already exists it is overwritten in-place.
 * The `.env` file is created with `0o600` permissions if absent.
 *
 * @param provider - Provider name (e.g. `"openai"`). Case-insensitive.
 * @param key      - The raw API key value.
 *
 * @example
 * ```ts
 * saveApiKey('openai', 'sk-proj-abc123xyz');
 * // ~/.csage/.env now contains: OPENAI_API_KEY=sk-proj-abc123xyz
 * ```
 */
export function saveApiKey(provider: string, key: string): void {
  const envKey = toEnvKey(provider);
  const lines = readEnvLines();
  let found = false;

  const updated = lines.map((line) => {
    if (line.startsWith(`${envKey}=`)) {
      found = true;
      return `${envKey}=${key}`;
    }
    return line;
  });

  if (!found) {
    updated.push(`${envKey}=${key}`);
  }

  writeEnvLines(updated);
}

/**
 * Retrieve the API key for a specific provider.
 *
 * @param provider - Provider name (case-insensitive).
 * @returns The raw API key string, or `null` if not found.
 *
 * @example
 * ```ts
 * const key = loadApiKey('anthropic');
 * if (key) console.log('Key loaded');
 * ```
 */
export function loadApiKey(provider: string): string | null {
  const envKey = toEnvKey(provider);

  for (const line of readEnvLines()) {
    if (line.startsWith(`${envKey}=`)) {
      const value = line.slice(envKey.length + 1).trim();
      return value.length > 0 ? value : null;
    }
  }

  return null;
}

/**
 * Remove the API key line for a provider from the `.env` file.
 *
 * This is a no-op if the key does not exist.
 *
 * @param provider - Provider name (case-insensitive).
 *
 * @example
 * ```ts
 * removeApiKey('openai');
 * ```
 */
export function removeApiKey(provider: string): void {
  const envKey = toEnvKey(provider);
  const lines = readEnvLines();
  const filtered = lines.filter((line) => !line.startsWith(`${envKey}=`));

  writeEnvLines(filtered);
}

/**
 * List all stored API keys with masked values.
 *
 * @returns An array of {@link MaskedApiKey} entries, one per stored key.
 *
 * @example
 * ```ts
 * for (const { provider, maskedKey } of listApiKeys()) {
 *   console.log(`${provider}: ${maskedKey}`);
 * }
 * // openai: sk-p...z789
 * // anthropic: sk-a...b456
 * ```
 */
export function listApiKeys(): MaskedApiKey[] {
  const results: MaskedApiKey[] = [];
  const suffix = '_API_KEY=';

  for (const line of readEnvLines()) {
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const rawKey = line.slice(0, eqIndex);
    if (!rawKey.endsWith('_API_KEY')) continue;

    const value = line.slice(eqIndex + 1).trim();
    if (value.length === 0) continue;

    // Derive provider name: strip trailing _API_KEY and lowercase
    const provider = rawKey.slice(0, rawKey.length - suffix.length + 1).toLowerCase();

    results.push({ provider, maskedKey: maskKey(value) });
  }

  return results;
}
