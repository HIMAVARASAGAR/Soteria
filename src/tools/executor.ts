/**
 * @module tools/executor
 *
 * Safe command execution engine for CSage v2.
 *
 * **Security invariants**:
 * - Commands are always tokenised via {@link safeTokenize} — never via shell.
 * - `child_process.spawn` is invoked with `shell: false` (the default).
 * - `child_process.exec` is **never** used.
 * - Timeouts are enforced via `setTimeout` + `SIGTERM`.
 *
 * @example
 * ```ts
 * const result = await executeCommand('nmap -sV 192.168.1.1');
 * if (result.success) console.log(result.stdout);
 * ```
 */

import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { platform as osPlatform } from 'node:os';

import { safeTokenize } from './classifier.js';
import type { RunResult } from '../types/tool.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Options for {@link executeCommand}. */
export interface ExecOptions {
  /** Maximum execution time in milliseconds. @default 300_000 (5 min) */
  readonly timeout?: number;
  /** Working directory for the child process. */
  readonly cwd?: string;
  /** Additional environment variables (merged with `process.env`). */
  readonly env?: Readonly<Record<string, string>>;
}

/** Status of a single tool in a batch availability check. */
export interface ToolStatus {
  /** Canonical tool name. */
  readonly name: string;
  /** Whether the tool binary was found on `$PATH`. */
  readonly available: boolean;
  /** Absolute path to the binary (when available). */
  readonly path?: string;
}

// ─── which (custom, no external dep) ─────────────────────────────────────────

/**
 * Resolve the absolute path of an executable by searching `$PATH`.
 *
 * On Windows the function appends common executable extensions
 * (`.exe`, `.cmd`, `.bat`, `.com`) when no extension is present.
 *
 * @param name - Executable name to locate (e.g. `"nmap"`).
 * @returns The absolute path if found, or `undefined`.
 */
export async function resolveExecutable(name: string): Promise<string | undefined> {
  const pathEnv = process.env['PATH'] ?? '';
  const delimiter = osPlatform() === 'win32' ? ';' : ':';
  const dirs = pathEnv.split(delimiter).filter(Boolean);

  const isWin = osPlatform() === 'win32';
  const extensions = isWin && !/\.\w+$/.test(name)
    ? ['.exe', '.cmd', '.bat', '.com']
    : [''];

  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = join(dir, `${name}${ext}`);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // not found in this dir — continue
      }
    }
  }

  return undefined;
}

// ─── isToolInstalled ─────────────────────────────────────────────────────────

/**
 * Check whether a tool binary is available on `$PATH`.
 *
 * @param name - The tool's binary name (e.g. `"nmap"`).
 * @returns `true` when the binary exists and is executable.
 */
export async function isToolInstalled(name: string): Promise<boolean> {
  const resolved = await resolveExecutable(name);
  return resolved !== undefined;
}

// ─── checkTools ──────────────────────────────────────────────────────────────

/**
 * Batch-check availability of multiple tools.
 *
 * @param names - Array of tool binary names to check.
 * @returns Array of {@link ToolStatus} objects, one per input name.
 */
export async function checkTools(names: readonly string[]): Promise<ToolStatus[]> {
  const results = await Promise.all(
    names.map(async (name): Promise<ToolStatus> => {
      const path = await resolveExecutable(name);
      return path !== undefined
        ? { name, available: true, path }
        : { name, available: false };
    }),
  );
  return results;
}

// ─── executeCommand ──────────────────────────────────────────────────────────

/** Default timeout: 5 minutes. */
const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Execute a command safely via `child_process.spawn`.
 *
 * The command string is tokenised with {@link safeTokenize} and passed to
 * `spawn` in array form (`program, [...args]`). Shell mode is **never**
 * enabled.
 *
 * @param command - The full command string (e.g. `"nmap -sV 127.0.0.1"`).
 * @param options - Optional execution settings.
 * @returns A {@link RunResult} capturing stdout, stderr, and exit status.
 */
export async function executeCommand(
  command: string,
  options?: ExecOptions,
): Promise<RunResult> {
  const { timeout = DEFAULT_TIMEOUT_MS, cwd, env } = options ?? {};

  // ── Tokenise ────────────────────────────────────────────────────────────
  const tokenResult = safeTokenize(command);
  if (!tokenResult.ok || tokenResult.tokens.length === 0) {
    return {
      command,
      allowed: true,
      ran: false,
      success: false,
      stdout: '',
      stderr: '',
      error: `Tokenisation failed: ${tokenResult.error ?? 'empty command'}`,
      reason: tokenResult.error,
    };
  }

  const [program, ...args] = tokenResult.tokens;

  // ── Spawn ───────────────────────────────────────────────────────────────
  return new Promise<RunResult>((resolve) => {
    let stdoutBuf = '';
    let stderrBuf = '';
    let timedOut = false;
    let settled = false;

    const mergedEnv: Record<string, string | undefined> = {
      ...process.env,
      ...(env ?? {}),
    };

    const child = spawn(program, args, {
      cwd,
      env: mergedEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      // shell is intentionally omitted (defaults to false)
    });

    // Timeout enforcement
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeout);

    // Collect stdout
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
    });

    // Collect stderr
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    // Handle spawn errors (e.g. command not found)
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({
        command,
        allowed: true,
        ran: false,
        success: false,
        stdout: stdoutBuf,
        stderr: stderrBuf,
        error: err.code === 'ENOENT'
          ? `Command not found: ${program}`
          : `Spawn error: ${err.message}`,
      });
    });

    // Handle exit
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;

      if (timedOut) {
        resolve({
          command,
          allowed: true,
          ran: true,
          success: false,
          stdout: stdoutBuf,
          stderr: stderrBuf,
          error: `Command timed out after ${timeout}ms`,
        });
        return;
      }

      resolve({
        command,
        allowed: true,
        ran: true,
        success: code === 0,
        stdout: stdoutBuf,
        stderr: stderrBuf,
        error: code !== 0 ? `Process exited with code ${code ?? 'null'}` : undefined,
      });
    });
  });
}
