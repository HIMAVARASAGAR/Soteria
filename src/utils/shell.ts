import { platform } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Supported operating systems. */
export type OsType = 'linux' | 'mac' | 'windows';

/** Supported shell types. */
export type ShellType = 'zsh' | 'bash' | 'powershell' | 'cmd' | 'unknown';

/**
 * Detected shell environment information.
 *
 * @property os    - The detected operating system.
 * @property isWsl - Whether running inside Windows Subsystem for Linux.
 * @property shell - The detected interactive shell.
 */
export interface ShellInfo {
  readonly os: OsType;
  readonly isWsl: boolean;
  readonly shell: ShellType;
}

// ─── Internals ───────────────────────────────────────────────────────────────

/**
 * Detect the current operating system from `process.platform`.
 *
 * @returns The detected OS type.
 */
function detectOs(): OsType {
  const p = platform();
  switch (p) {
    case 'darwin':
      return 'mac';
    case 'win32':
      return 'windows';
    default:
      // 'linux', 'freebsd', 'openbsd', 'sunos', 'aix' → treat as linux
      return 'linux';
  }
}

/**
 * Detect whether the environment is Windows Subsystem for Linux.
 *
 * Checks `/proc/version` for the string "microsoft" (case-insensitive),
 * which is present in both WSL 1 and WSL 2.
 *
 * @returns `true` if running under WSL, `false` otherwise.
 */
function detectWsl(): boolean {
  const procVersionPath = '/proc/version';
  if (!existsSync(procVersionPath)) {
    return false;
  }
  try {
    const content = readFileSync(procVersionPath, 'utf-8');
    return /microsoft/i.test(content);
  } catch {
    return false;
  }
}

/**
 * Detect the current interactive shell from environment variables.
 *
 * Checks `$SHELL` (Unix) and falls back to platform-specific defaults.
 *
 * @param os - The previously-detected OS, used for Windows fallback.
 * @returns The detected shell type.
 */
function detectShell(os: OsType): ShellType {
  // On Unix, $SHELL holds the login shell path
  const shellEnv = process.env['SHELL'] ?? '';

  if (shellEnv.endsWith('/zsh') || shellEnv.endsWith('/zsh5')) {
    return 'zsh';
  }
  if (shellEnv.endsWith('/bash')) {
    return 'bash';
  }

  // Windows: check ComSpec or PSModulePath
  if (os === 'windows') {
    if (process.env['PSModulePath']) {
      return 'powershell';
    }
    const comSpec = (process.env['ComSpec'] ?? '').toLowerCase();
    if (comSpec.endsWith('cmd.exe')) {
      return 'cmd';
    }
    return 'powershell'; // modern Windows default
  }

  // If $SHELL is set but didn't match known patterns, try to extract
  if (shellEnv.length > 0) {
    const basename = shellEnv.split('/').pop() ?? '';
    if (basename === 'zsh') return 'zsh';
    if (basename === 'bash') return 'bash';
  }

  return 'unknown';
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Cached result so detection only runs once per process. */
let _cached: ShellInfo | undefined;

/**
 * Detect the current OS, shell, and WSL status.
 *
 * Results are cached after the first call. Subsequent calls return the
 * same object without re-reading the filesystem or environment.
 *
 * @returns A frozen {@link ShellInfo} object describing the environment.
 *
 * @example
 * ```ts
 * const info = getShellInfo();
 * console.log(info.os);    // 'mac'
 * console.log(info.shell); // 'zsh'
 * console.log(info.isWsl); // false
 * ```
 */
export function getShellInfo(): ShellInfo {
  if (_cached) {
    return _cached;
  }

  const os = detectOs();
  const isWsl = os === 'linux' ? detectWsl() : false;
  const shell = detectShell(os);

  const info: ShellInfo = Object.freeze({ os, isWsl, shell });
  _cached = info;
  return info;
}

/**
 * Clear the cached {@link ShellInfo} so the next call to
 * {@link getShellInfo} re-detects the environment.
 *
 * Primarily useful in tests.
 */
export function resetShellInfoCache(): void {
  _cached = undefined;
}
