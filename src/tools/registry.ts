/**
 * @module tools/registry
 *
 * Security-tool registry with discovery, registration, and persistence.
 *
 * **Built-in tools** (13 entries) are always available in-memory and cannot
 * be removed.  **User-added tools** are persisted to `~/.csage/tools.json`
 * and override any built-in entry with the same key.
 *
 * @example
 * ```ts
 * import { getToolEntry, listTools, addTool } from './registry.js';
 *
 * const nmap = getToolEntry('nmap');        // built-in
 * addTool('mytool', { ... });               // persisted to disk
 * const all = listTools();                  // built-in + user
 * ```
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

import type { ToolRegistryEntry, Platform } from './types.js';
import type { ToolCategory } from '../types/tool.js';

// ─── Built-in tool catalogue ─────────────────────────────────────────────────

/** Helper to create a typed registry entry inline. */
function entry(
  category: ToolCategory,
  linux: string,
  mac: string,
  win: string,
  documentationUrl: string,
): ToolRegistryEntry {
  return {
    category,
    installCommands: { linux, mac, win },
    documentationUrl,
  };
}

/** The 13 security tools that ship with CSage by default. */
const DEFAULT_TOOLS: ReadonlyMap<string, ToolRegistryEntry> = new Map<string, ToolRegistryEntry>([
  ['nmap', entry(
    'recon',
    'sudo apt-get install -y nmap',
    'brew install nmap',
    'winget install Insecure.Nmap',
    'https://nmap.org/docs.html',
  )],
  ['nikto', entry(
    'scanner',
    'sudo apt-get install -y nikto',
    'brew install nikto',
    'choco install nikto',
    'https://github.com/sullo/nikto/wiki',
  )],
  ['sqlmap', entry(
    'exploit',
    'sudo apt-get install -y sqlmap',
    'brew install sqlmap',
    'pip3 install sqlmap',
    'https://sqlmap.org/',
  )],
  ['gobuster', entry(
    'fuzzer',
    'sudo apt-get install -y gobuster',
    'brew install gobuster',
    'go install github.com/OJ/gobuster/v3@latest',
    'https://github.com/OJ/gobuster#readme',
  )],
  ['ffuf', entry(
    'fuzzer',
    'sudo apt-get install -y ffuf',
    'brew install ffuf',
    'go install github.com/ffuf/ffuf/v2@latest',
    'https://github.com/ffuf/ffuf#readme',
  )],
  ['wfuzz', entry(
    'fuzzer',
    'pip3 install wfuzz',
    'pip3 install wfuzz',
    'pip3 install wfuzz',
    'https://wfuzz.readthedocs.io/',
  )],
  ['hydra', entry(
    'brute-force',
    'sudo apt-get install -y hydra',
    'brew install hydra',
    'choco install thc-hydra',
    'https://github.com/vanhauser-thc/thc-hydra#readme',
  )],
  ['dirb', entry(
    'fuzzer',
    'sudo apt-get install -y dirb',
    'brew install dirb',
    'choco install dirb',
    'https://dirb.sourceforge.net/',
  )],
  ['dirsearch', entry(
    'fuzzer',
    'pip3 install dirsearch',
    'pip3 install dirsearch',
    'pip3 install dirsearch',
    'https://github.com/maurosoria/dirsearch#readme',
  )],
  ['sslyze', entry(
    'ssl',
    'pip3 install sslyze',
    'pip3 install sslyze',
    'pip3 install sslyze',
    'https://github.com/nabla-c0d3/sslyze#readme',
  )],
  ['testssl.sh', entry(
    'ssl',
    'sudo apt-get install -y testssl.sh',
    'brew install testssl',
    'choco install testssl',
    'https://testssl.sh/',
  )],
  ['semgrep', entry(
    'static',
    'pip3 install semgrep',
    'pip3 install semgrep',
    'pip3 install semgrep',
    'https://semgrep.dev/docs/',
  )],
  ['curl', entry(
    'recon',
    'sudo apt-get install -y curl',
    'brew install curl',
    'winget install cURL.cURL',
    'https://curl.se/docs/',
  )],
]);

// ─── Persistence helpers ─────────────────────────────────────────────────────

/** Resolve the path to `~/.csage/tools.json`. */
function userToolsPath(): string {
  return join(homedir(), '.csage', 'tools.json');
}

/** Serialisable shape stored in `tools.json`. */
interface PersistedEntry {
  readonly category: ToolCategory;
  readonly installCommands: { linux?: string; mac?: string; win?: string };
  readonly documentationUrl: string;
}

/**
 * Load user-added tools from disk.
 * Returns an empty map when the file does not exist or is invalid.
 */
async function loadUserTools(): Promise<Map<string, ToolRegistryEntry>> {
  const map = new Map<string, ToolRegistryEntry>();
  try {
    const raw = await readFile(userToolsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, PersistedEntry>;
    for (const [name, value] of Object.entries(parsed)) {
      map.set(name, {
        category: value.category,
        installCommands: value.installCommands,
        documentationUrl: value.documentationUrl,
      });
    }
  } catch {
    // File does not exist yet or is corrupt — start fresh
  }
  return map;
}

/** Persist the user-tool map to disk. */
async function saveUserTools(tools: ReadonlyMap<string, ToolRegistryEntry>): Promise<void> {
  const obj: Record<string, PersistedEntry> = {};
  for (const [name, value] of tools) {
    obj[name] = {
      category: value.category,
      installCommands: value.installCommands,
      documentationUrl: value.documentationUrl,
    };
  }

  const dir = join(homedir(), '.csage');
  await mkdir(dir, { recursive: true });
  await writeFile(userToolsPath(), JSON.stringify(obj, null, 2), 'utf-8');
}

// ─── In-memory user-tool cache ───────────────────────────────────────────────

let userToolCache: Map<string, ToolRegistryEntry> | undefined;

/** Ensure the user-tool cache is populated. */
async function ensureCache(): Promise<Map<string, ToolRegistryEntry>> {
  if (userToolCache === undefined) {
    userToolCache = await loadUserTools();
  }
  return userToolCache;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Look up a tool entry by name.
 *
 * User-added tools shadow built-in entries with the same key.
 *
 * @param name - Canonical tool name (e.g. `"nmap"`).
 * @returns The registry entry, or `undefined` if no such tool is known.
 */
export async function getToolEntry(name: string): Promise<ToolRegistryEntry | undefined> {
  const cache = await ensureCache();
  return cache.get(name) ?? DEFAULT_TOOLS.get(name);
}

/**
 * Register a user-defined tool and persist it to disk.
 *
 * If `name` matches a built-in tool the user entry takes precedence.
 *
 * @param name  - Canonical tool name.
 * @param entry - Tool metadata.
 */
export async function addTool(name: string, toolEntry: ToolRegistryEntry): Promise<void> {
  const cache = await ensureCache();
  cache.set(name, toolEntry);
  await saveUserTools(cache);
}

/**
 * Remove a user-defined tool from the registry and persist the change.
 *
 * Built-in tools cannot be removed — calling this with a built-in name
 * that has no user override is a no-op.
 *
 * @param name - Tool name to remove.
 */
export async function removeTool(name: string): Promise<void> {
  const cache = await ensureCache();
  if (cache.has(name)) {
    cache.delete(name);
    await saveUserTools(cache);
  }
}

/**
 * List all known tools (built-in + user-added, user overrides win).
 *
 * @returns Array of `[name, entry]` pairs.
 */
export async function listTools(): Promise<Array<{ name: string; entry: ToolRegistryEntry }>> {
  const cache = await ensureCache();
  const merged = new Map<string, ToolRegistryEntry>(DEFAULT_TOOLS);
  for (const [name, value] of cache) {
    merged.set(name, value);
  }
  return Array.from(merged.entries()).map(([name, value]) => ({ name, entry: value }));
}

/**
 * Get the install command for a tool on a specific platform.
 *
 * @param name     - Canonical tool name.
 * @param platform - Target platform.
 * @returns The install command string, or `undefined` if not available.
 */
export async function getInstaller(name: string, platform: Platform): Promise<string | undefined> {
  const tool = await getToolEntry(name);
  if (tool === undefined) return undefined;

  const key = platform === 'windows' ? 'win' : platform;
  return tool.installCommands[key];
}

/**
 * Get the documentation URL for a tool.
 *
 * @param name - Canonical tool name.
 * @returns The URL string, or an empty string if the tool is unknown.
 */
export async function getDocUrl(name: string): Promise<string> {
  const tool = await getToolEntry(name);
  return tool?.documentationUrl ?? '';
}
