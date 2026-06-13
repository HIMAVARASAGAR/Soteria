/**
 * @module tools/adapters/nmap
 *
 * `ToolAdapter` implementation for **Nmap** — the network exploration and
 * security auditing tool.
 *
 * This adapter serves as the **reference implementation** for all future
 * tool adapters: it shows how to check installation, build command strings,
 * and parse raw output into structured `ToolOutput`.
 *
 * @see https://nmap.org/docs.html
 */

import type {
  ToolAdapter,
  Platform,
  ToolCategory,
  PlatformCommands,
  InstallResult,
  ToolOutput,
} from '../types.js';
import { isToolInstalled } from '../executor.js';
import { executeCommand } from '../executor.js';

// ─── Output-parsing helpers ──────────────────────────────────────────────────

/** A single port/service entry extracted from nmap output. */
interface NmapPortEntry {
  readonly port: number;
  readonly protocol: string;
  readonly state: string;
  readonly service: string;
  readonly version: string;
}

/**
 * Extract port table rows from raw nmap text output.
 *
 * Nmap port lines look like:
 * ```
 * 22/tcp   open  ssh     OpenSSH 8.9p1 Ubuntu 3ubuntu0.1
 * 80/tcp   open  http    Apache httpd 2.4.52
 * ```
 */
function parsePortLines(raw: string): NmapPortEntry[] {
  const entries: NmapPortEntry[] = [];

  // Match lines like: 22/tcp  open  ssh  OpenSSH 8.9p1 ...
  const portRegex = /^(\d+)\/(tcp|udp)\s+(open|closed|filtered)\s+(\S+)\s*(.*)/;

  for (const line of raw.split('\n')) {
    const match = portRegex.exec(line.trim());
    if (match) {
      entries.push({
        port: Number(match[1]),
        protocol: match[2],
        state: match[3],
        service: match[4],
        version: (match[5] ?? '').trim(),
      });
    }
  }

  return entries;
}

/**
 * Extract the host state line (e.g. "Host is up (0.0045s latency).").
 */
function parseHostState(raw: string): string {
  const hostLine = raw.split('\n').find((l) => l.includes('Host is'));
  return hostLine?.trim() ?? 'unknown';
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

/** Nmap tool adapter — reference implementation of {@link ToolAdapter}. */
export const nmapAdapter: ToolAdapter = {
  id: 'nmap',
  name: 'Nmap',
  category: 'recon' as ToolCategory,

  installCommands: {
    linux: 'sudo apt-get install -y nmap',
    mac: 'brew install nmap',
    win: 'winget install Insecure.Nmap',
  } satisfies PlatformCommands,

  documentationUrl: 'https://nmap.org/docs.html',

  // ── isInstalled ──────────────────────────────────────────────────────────

  async isInstalled(): Promise<boolean> {
    return isToolInstalled('nmap');
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
        ? 'Nmap installed successfully'
        : result.error ?? (result.stderr || 'Installation failed'),
    };
  },

  // ── buildCommand ─────────────────────────────────────────────────────────

  buildCommand(target: string, options?: Record<string, unknown>): string {
    const flags: string[] = [];

    // Service/version detection is the sensible default
    const scanType = typeof options?.['scanType'] === 'string'
      ? options['scanType']
      : '-sV';
    flags.push(scanType);

    // Optional port specification
    if (typeof options?.['ports'] === 'string') {
      flags.push('-p', options['ports']);
    }

    // Optional output format
    if (typeof options?.['outputFormat'] === 'string') {
      const fmt = options['outputFormat'];
      if (fmt === 'xml') flags.push('-oX', '-');
      else if (fmt === 'greppable') flags.push('-oG', '-');
    }

    // Optional timing template
    if (typeof options?.['timing'] === 'number') {
      const t = Math.min(5, Math.max(0, options['timing']));
      flags.push(`-T${t}`);
    }

    // Optional extra flags (passed as a single string)
    if (typeof options?.['extraFlags'] === 'string') {
      flags.push(options['extraFlags']);
    }

    return `nmap ${flags.join(' ')} ${target}`;
  },

  // ── parseOutput ──────────────────────────────────────────────────────────

  parseOutput(raw: string): ToolOutput {
    const ports = parsePortLines(raw);
    const hostState = parseHostState(raw);

    return {
      raw,
      parsed: {
        hostState,
        ports,
        openPortCount: ports.filter((p) => p.state === 'open').length,
      },
      findings: ports
        .filter((p) => p.state === 'open')
        .map((p) => ({
          name: `Open port ${p.port}/${p.protocol}`,
          severity: 'INFO' as const,
          location: `${p.port}/${p.protocol}`,
          what: `${p.service}${p.version ? ` (${p.version})` : ''} is listening`,
        })),
    };
  },
};
