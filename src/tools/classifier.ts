/**
 * @module tools/classifier
 *
 * Command safety classification engine.
 *
 * Ported from the Python v1 `tool_runner.py` — determines whether a command
 * is safe to auto-execute (setup/install only) or must be shown to the user
 * for manual confirmation.
 *
 * **Design invariant**: this module NEVER executes any shell code.
 * Tokenisation is performed by a hand-written parser that handles
 * single/double quotes and returns an explicit error on malformed input.
 */

import type { CommandRisk } from '../types/findings.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Prefixes that are unconditionally safe to auto-execute. */
const SAFE_INSTALL_PREFIXES = [
  'brew install', 'brew reinstall', 'brew upgrade',
  'apt-get install', 'apt install', 'sudo apt-get install', 'sudo apt install',
  'pip install', 'pip3 install', 'python3 -m pip install', 'python -m pip install',
  'go install', 'cargo install', 'npm install -g',
  'winget install', 'choco install', 'scoop install',
  'ollama pull', 'ollama serve', 'ollama list', 'ollama run',
] as const;

/** Sub-commands that are allowed when the first token is a known package manager. */
const SAFE_SUBCOMMANDS = [
  'install', 'pull', 'serve', 'list', 'version',
  '--version', '-v', '--help', '-h',
] as const;

/** Tools whose first-position presence marks a command as a pentest action. */
const PENTEST_TOOLS = [
  'nmap', 'nikto', 'sqlmap', 'gobuster', 'ffuf', 'wfuzz', 'hydra',
  'curl', 'wget', 'dirb', 'dirsearch', 'sslyze', 'testssl',
] as const;

/** Shell meta-characters that indicate chaining / injection. */
const SHELL_OPERATORS = [
  '|', '&&', '||', ';', '>', '>>', '<', '`', '$(',
] as const;

/** Patterns indicating destructive intent. */
const DESTRUCTIVE = [
  'rm ', 'del ', 'format ', 'mkfs', 'dd if=', ':(){', 'fork',
] as const;

/** Known package-manager binaries (first token). */
const PACKAGE_MANAGERS = new Set([
  'apt', 'apt-get', 'brew', 'pip', 'pip3', 'npm',
  'go', 'cargo', 'winget', 'choco', 'scoop',
  'ollama', 'python', 'python3', 'sudo',
]);

// ─── Types ───────────────────────────────────────────────────────────────────

/** Result of classifying a command's safety. */
export interface ClassifyResult {
  /** Whether the command is safe to auto-execute. */
  readonly safe: boolean;
  /** Risk level: LOW (install), MEDIUM (ambiguous), HIGH (pentest/destructive). */
  readonly risk: CommandRisk;
  /** Human-readable explanation of the classification decision. */
  readonly reason: string;
}

/** Result of tokenising a command string. */
export interface TokenizeResult {
  /** Whether tokenisation succeeded. */
  readonly ok: boolean;
  /** The extracted tokens (empty on failure). */
  readonly tokens: readonly string[];
  /** Error message when `ok` is `false`. */
  readonly error?: string;
}

// ─── safeTokenize ────────────────────────────────────────────────────────────

/**
 * Split a command string into tokens, respecting single and double quotes.
 *
 * **Implementation**: hand-written finite-state parser — no shell execution,
 * no `eval`, no `child_process`.
 *
 * Unclosed quotes produce an explicit error rather than silently falling back
 * to naive splitting.
 *
 * @param command - The raw command string to tokenise.
 * @returns A `TokenizeResult` with the parsed tokens or an error.
 */
export function safeTokenize(command: string): TokenizeResult {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    // Handle backslash escaping (only inside double quotes or unquoted)
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && !inSingle) {
      escaped = true;
      continue;
    }

    // Toggle single-quote mode (no escaping inside single quotes)
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    // Toggle double-quote mode
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    // Whitespace outside quotes: emit current token
    if ((ch === ' ' || ch === '\t') && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  // Trailing escape character
  if (escaped) {
    return {
      ok: false,
      tokens: [],
      error: 'Trailing backslash with no character to escape.',
    };
  }

  // Unclosed quotes
  if (inSingle) {
    return {
      ok: false,
      tokens: [],
      error: "Unclosed single quote (') — check for unmatched quotes.",
    };
  }
  if (inDouble) {
    return {
      ok: false,
      tokens: [],
      error: 'Unclosed double quote (") — check for unmatched quotes.',
    };
  }

  // Flush last token
  if (current.length > 0) {
    tokens.push(current);
  }

  return { ok: true, tokens };
}

// ─── classify ────────────────────────────────────────────────────────────────

/**
 * Classify a command as safe (auto-executable) or blocked.
 *
 * Classification pipeline:
 * 1. Reject empty commands.
 * 2. Reject commands containing shell operators (injection vectors).
 * 3. Reject commands containing destructive patterns.
 * 4. Allow commands matching a known `SAFE_INSTALL_PREFIXES`.
 * 5. Allow if the first token is a known package manager with a safe sub-command.
 * 6. Block if the first token is a pentest tool.
 * 7. Default: block with explanation.
 *
 * @param command - The command string to classify.
 * @returns A `ClassifyResult` describing the decision.
 */
export function classify(command: string): ClassifyResult {
  const cmd = command.trim();

  // 1 — Empty
  if (cmd.length === 0) {
    return { safe: false, risk: 'HIGH', reason: 'Empty command' };
  }

  // 2 — Shell operators
  for (const op of SHELL_OPERATORS) {
    if (cmd.includes(op)) {
      return {
        safe: false,
        risk: 'HIGH',
        reason: `Contains shell operator '${op}' — potential injection vector`,
      };
    }
  }

  // 3 — Destructive patterns
  const cmdLower = cmd.toLowerCase();
  for (const pattern of DESTRUCTIVE) {
    if (cmdLower.includes(pattern)) {
      return {
        safe: false,
        risk: 'HIGH',
        reason: `Contains destructive pattern '${pattern.trim()}'`,
      };
    }
  }

  // 4 — Safe install prefixes (exact prefix match, case-insensitive)
  for (const prefix of SAFE_INSTALL_PREFIXES) {
    if (cmdLower.startsWith(prefix)) {
      return {
        safe: true,
        risk: 'LOW',
        reason: `Matches safe install prefix '${prefix}'`,
      };
    }
  }

  // Tokenise for deeper inspection
  const tokenResult = safeTokenize(cmd);
  if (!tokenResult.ok || tokenResult.tokens.length === 0) {
    return {
      safe: false,
      risk: 'MEDIUM',
      reason: `Cannot parse command: ${tokenResult.error ?? 'unknown error'}`,
    };
  }

  const first = tokenResult.tokens[0].toLowerCase().replace(/^\.\//, '');
  const sub = tokenResult.tokens.length > 1
    ? tokenResult.tokens[1].toLowerCase()
    : undefined;

  // 5 — Known package manager + safe sub-command
  if (PACKAGE_MANAGERS.has(first)) {
    // 'sudo' — look one level deeper
    if (first === 'sudo' && sub !== undefined) {
      const actualBin = sub;
      const actualSub = tokenResult.tokens.length > 2
        ? tokenResult.tokens[2].toLowerCase()
        : undefined;
      if (PACKAGE_MANAGERS.has(actualBin) && actualSub !== undefined) {
        const subSet = new Set<string>(SAFE_SUBCOMMANDS);
        if (subSet.has(actualSub)) {
          return {
            safe: true,
            risk: 'LOW',
            reason: `'sudo ${actualBin} ${actualSub}' is a safe setup command`,
          };
        }
      }
      return {
        safe: false,
        risk: 'MEDIUM',
        reason: `'sudo ${sub ?? ''}' — sub-command not in the safe list`,
      };
    }

    if (sub !== undefined) {
      const subSet = new Set<string>(SAFE_SUBCOMMANDS);
      if (subSet.has(sub)) {
        return {
          safe: true,
          risk: 'LOW',
          reason: `'${first} ${sub}' is a safe setup command`,
        };
      }
    }

    return {
      safe: false,
      risk: 'MEDIUM',
      reason: `'${first}' is a package manager but '${sub ?? '(none)'}' is not a safe sub-command`,
    };
  }

  // 6 — Pentest tools
  const pentestSet = new Set<string>(PENTEST_TOOLS);
  if (pentestSet.has(first)) {
    return {
      safe: false,
      risk: 'HIGH',
      reason: `'${first}' is a security testing tool — must be run manually`,
    };
  }

  // 7 — Default: block
  return {
    safe: false,
    risk: 'MEDIUM',
    reason: `'${first}' is not a recognised setup/install command — run manually`,
  };
}
