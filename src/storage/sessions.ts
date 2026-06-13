/**
 * @module storage/sessions
 * @description Simple session identity and directory management.
 *
 * This module provides the minimal surface needed by other storage
 * modules (e.g. chain-logger) and the CLI layer to create unique
 * session identifiers and locate the sessions directory.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { getConfigDir } from './config.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Subdirectory inside `~/.csage/` for session data. */
const SESSIONS_DIR_NAME = 'sessions';

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a new, globally unique session identifier.
 *
 * Uses `crypto.randomUUID()` (RFC 4122 v4) which is available in
 * Node ≥ 19 and backed by the OS CSPRNG.
 *
 * @returns A lowercase UUID string (e.g. `"f47ac10b-58cc-4372-a567-0e02b2c3d479"`).
 *
 * @example
 * ```ts
 * const id = createSessionId();
 * console.log(id); // 'a3f8e2c1-0b4d-4e91-bfca-7d6e5a3c8b12'
 * ```
 */
export function createSessionId(): string {
  return randomUUID();
}

/**
 * Return the absolute path to the sessions directory
 * (`~/.csage/sessions/`), creating it if it does not exist.
 *
 * @returns Absolute path to the sessions directory.
 *
 * @example
 * ```ts
 * const dir = getSessionDir();
 * // → '/Users/alice/.csage/sessions'
 * ```
 */
export function getSessionDir(): string {
  const dir = join(getConfigDir(), SESSIONS_DIR_NAME);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
