/**
 * @module tools/adapters/gobuster
 *
 * `ToolAdapter` implementation for **Gobuster** — a URI / DNS / vhost
 * brute-forcing tool commonly used during web-application reconnaissance.
 *
 * @see https://github.com/OJ/gobuster
 */

import type {
  ToolAdapter,
  Platform,
  ToolCategory,
  PlatformCommands,
  InstallResult,
  ToolOutput,
} from '../types.js';
import { isToolInstalled, executeCommand } from '../executor.js';
import type { Finding } from '../../types/findings.js';

// ─── Output-parsing helpers ──────────────────────────────────────────────────

/** A single path entry extracted from gobuster output. */
interface GobusterPathEntry {
  /** The discovered path (e.g. `/admin`). */
  readonly path: string;
  /** HTTP status code (e.g. `200`, `301`). */
  readonly status: number;
  /** Response content length, if reported. */
  readonly size?: number;
}

/**
 * Extract discovered paths from raw gobuster `dir` mode output.
 *
 * Gobuster lines look like:
 * ```
 * /admin                (Status: 200) [Size: 1234]
 * /backup               (Status: 301) [Size: 0]
 * ```
 */
function parseGobusterLines(raw: string): GobusterPathEntry[] {
  const entries: GobusterPathEntry[] = [];

  // Matches: /path  (Status: NNN)  optionally [Size: NNN]
  const lineRegex = /^(\/\S*)\s+\(Status:\s*(\d+)\)(?:\s*\[Size:\s*(\d+)])?/;

  for (const line of raw.split('\n')) {
    const match = lineRegex.exec(line.trim());
    if (match) {
      entries.push({
        path: match[1],
        status: Number(match[2]),
        size: match[3] !== undefined ? Number(match[3]) : undefined,
      });
    }
  }

  return entries;
}

/**
 * Map an HTTP status code to a finding severity.
 *
 * - `200` on sensitive paths → MEDIUM (direct access)
 * - `301` / `302` → LOW (redirect, still reveals path)
 * - `403` → INFO (exists but forbidden)
 * - Everything else → INFO
 */
function statusToSeverity(status: number): Finding['severity'] {
  if (status >= 200 && status < 300) return 'MEDIUM';
  if (status >= 300 && status < 400) return 'LOW';
  return 'INFO';
}

// ─── Default wordlist ────────────────────────────────────────────────────────

/** Sensible default wordlist paths per platform. */
const DEFAULT_WORDLISTS: Record<Platform, string> = {
  linux: '/usr/share/wordlists/dirb/common.txt',
  mac: '/usr/share/wordlists/dirb/common.txt',
  windows: 'C:\\wordlists\\common.txt',
};

// ─── Adapter ─────────────────────────────────────────────────────────────────

/** Gobuster tool adapter for directory/file brute-forcing. */
export const gobusterAdapter: ToolAdapter = {
  id: 'gobuster',
  name: 'Gobuster',
  category: 'fuzzer' as ToolCategory,

  installCommands: {
    linux: 'sudo apt-get install -y gobuster',
    mac: 'brew install gobuster',
    win: 'go install github.com/OJ/gobuster/v3@latest',
  } satisfies PlatformCommands,

  documentationUrl: 'https://github.com/OJ/gobuster#readme',

  // ── isInstalled ──────────────────────────────────────────────────────────

  async isInstalled(): Promise<boolean> {
    return isToolInstalled('gobuster');
  },

  // ── install ──────────────────────────────────────────────────────────────

  async install(platform: Platform): Promise<InstallResult> {
    const cmdMap: Record<Platform, string | undefined> = {
      linux: this.installCommands.linux,
      mac: this.installCommands.mac,
      windows: this.installCommands.win,
    };

    const cmd = cmdMap[platform];
    if (cmd === undefined) {
      return { success: false, message: `No install command for platform '${platform}'` };
    }

    const result = await executeCommand(cmd, { timeout: 120_000 });
    return {
      success: result.success,
      message: result.success
        ? 'Gobuster installed successfully'
        : result.error ?? (result.stderr || 'Installation failed'),
    };
  },

  // ── buildCommand ─────────────────────────────────────────────────────────

  buildCommand(target: string, options?: Record<string, unknown>): string {
    const parts: string[] = ['gobuster', 'dir'];

    // Target URL
    parts.push('-u', target);

    // Wordlist (required for dir mode)
    const wordlist = typeof options?.['wordlist'] === 'string'
      ? options['wordlist']
      : DEFAULT_WORDLISTS.linux; // safe default
    parts.push('-w', wordlist);

    // Optional file extensions
    if (typeof options?.['extensions'] === 'string') {
      parts.push('-x', options['extensions']);
    }

    // Optional thread count
    if (typeof options?.['threads'] === 'number') {
      parts.push('-t', String(Math.max(1, Math.min(100, options['threads']))));
    }

    // Optional status code filter
    if (typeof options?.['statusCodes'] === 'string') {
      parts.push('-s', options['statusCodes']);
    }

    // Follow redirects
    if (options?.['followRedirect'] === true) {
      parts.push('-r');
    }

    // Optional extra flags (passed as a single string)
    if (typeof options?.['extraFlags'] === 'string') {
      parts.push(options['extraFlags']);
    }

    return parts.join(' ');
  },

  // ── parseOutput ──────────────────────────────────────────────────────────

  parseOutput(raw: string): ToolOutput {
    const paths = parseGobusterLines(raw);

    const findings: Finding[] = paths.map((p) => ({
      name: `Discovered path: ${p.path}`,
      severity: statusToSeverity(p.status),
      location: p.path,
      what: `HTTP ${p.status}${p.size !== undefined ? ` (${p.size} bytes)` : ''}`,
    }));

    return {
      raw,
      parsed: {
        paths,
        totalFound: paths.length,
      },
      findings,
    };
  },
};
