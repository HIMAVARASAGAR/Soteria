import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join, extname, basename, relative } from 'node:path';
import { type Finding } from '../types/findings.js';
import { SCAN_PATTERNS, SENSITIVE_FILES, type ScanPattern } from './patterns.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Directories to skip during recursive walk. */
const IGNORED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '__pycache__',
  '.venv',
  'venv',
  'dist',
  'build',
  '.next',
  'coverage',
  'vendor',
]);

/** Maximum file size (in bytes) that will be scanned. */
const MAX_FILE_SIZE = 500 * 1024; // 500 KB

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Redact a matched secret value: show the first 4 characters then `...`.
 *
 * @param raw - The raw matched string.
 * @returns A partially-redacted representation.
 */
function redactValue(raw: string): string {
  if (raw.length <= 4) {
    return '****';
  }
  return `${raw.slice(0, 4)}...`;
}

/**
 * Check whether a file extension is accepted by a pattern.
 *
 * An empty `extensions` list means "match all files".
 */
function extensionMatches(
  fileExt: string,
  patternExtensions: readonly string[],
): boolean {
  if (patternExtensions.length === 0) {
    return true;
  }
  return patternExtensions.includes(fileExt.toLowerCase());
}

// ─── StaticScanner ───────────────────────────────────────────────────────────

/**
 * Walks a project directory and runs regex-based vulnerability patterns
 * against every qualifying file.
 *
 * @example
 * ```ts
 * const scanner = new StaticScanner('/path/to/project');
 * const findings = scanner.scan();
 * ```
 */
export class StaticScanner {
  /**
   * @param rootPath - Absolute path to the project root to scan.
   */
  constructor(private readonly rootPath: string) {}

  /**
   * Execute the full scan and return deduplicated findings.
   *
   * @returns An array of {@link Finding} objects sorted by severity.
   */
  scan(): Finding[] {
    const files = this.walkDirectory(this.rootPath);
    const seen = new Set<string>();
    const findings: Finding[] = [];

    for (const filepath of files) {
      for (const finding of this.scanFile(filepath)) {
        const key = `${finding.name}::${finding.location}`;
        if (!seen.has(key)) {
          seen.add(key);
          findings.push(finding);
        }
      }
    }

    return findings;
  }

  // ── Directory Walk ───────────────────────────────────────────────────────

  /**
   * Recursively list all files under `dir`, skipping ignored directories
   * and symlinks.
   *
   * @param dir - Directory to walk.
   * @returns Flat list of absolute file paths.
   */
  private walkDirectory(dir: string): string[] {
    const results: string[] = [];

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      // Permission denied or similar — skip silently.
      return results;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);

      // SECURITY: never follow symlinks — they could point outside the tree.
      let stat;
      try {
        stat = lstatSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isSymbolicLink()) {
        continue;
      }

      if (stat.isDirectory()) {
        if (!IGNORED_DIRS.has(entry)) {
          results.push(...this.walkDirectory(fullPath));
        }
      } else if (stat.isFile()) {
        results.push(fullPath);
      }
    }

    return results;
  }

  // ── File Scan ────────────────────────────────────────────────────────────

  /**
   * Scan a single file for vulnerability patterns and sensitive-file matches.
   *
   * @param filepath - Absolute path to the file.
   * @returns Findings detected in this file (one per pattern at most).
   */
  private scanFile(filepath: string): Finding[] {
    const findings: Finding[] = [];
    const relPath = relative(this.rootPath, filepath);
    const fileName = basename(filepath);
    const fileExt = extname(filepath).toLowerCase();

    // ── Sensitive filename check ──────────────────────────────────────────
    if (SENSITIVE_FILES.includes(fileName) || SENSITIVE_FILES.includes(fileExt)) {
      findings.push({
        name: 'Sensitive File Detected',
        severity: 'HIGH',
        location: relPath,
        what: `Sensitive file "${fileName}" found in the repository.`,
        impact: 'May contain credentials, private keys, or other secrets.',
        fix: 'Add to .gitignore and remove from version control history.',
      });
    }

    // ── Size guard ────────────────────────────────────────────────────────
    let stat;
    try {
      stat = lstatSync(filepath);
    } catch {
      return findings;
    }

    if (stat.size > MAX_FILE_SIZE) {
      return findings;
    }

    // ── Read file content ─────────────────────────────────────────────────
    let content: string;
    try {
      content = readFileSync(filepath, 'utf-8');
    } catch {
      // Binary or unreadable — skip.
      return findings;
    }

    const lines = content.split('\n');

    // Track which patterns already matched this file for dedup.
    const matchedPatterns = new Set<string>();

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];

      for (const rule of SCAN_PATTERNS) {
        // One finding per pattern per file.
        if (matchedPatterns.has(rule.name)) {
          continue;
        }

        if (!extensionMatches(fileExt, rule.extensions)) {
          continue;
        }

        const match = rule.pattern.exec(line);
        if (match) {
          matchedPatterns.add(rule.name);
          findings.push(
            this.buildFinding(rule, relPath, lineIdx + 1, match[0]),
          );
        }
      }
    }

    return findings;
  }

  // ── Finding Builder ──────────────────────────────────────────────────────

  /**
   * Construct a {@link Finding} from a matched pattern.
   *
   * @param rule     - The pattern that triggered the match.
   * @param relPath  - Relative file path from project root.
   * @param line     - 1-based line number of the match.
   * @param rawMatch - The raw regex match string.
   */
  private buildFinding(
    rule: ScanPattern,
    relPath: string,
    line: number,
    rawMatch: string,
  ): Finding {
    const redacted = redactValue(rawMatch);

    return {
      name: rule.name,
      severity: rule.severity,
      location: `${relPath}:${line}`,
      what: `${rule.description} (matched: ${redacted})`,
      fix: this.suggestFix(rule.name),
      confidence: 0.7,
    };
  }

  /**
   * Return a brief remediation suggestion for a given rule.
   *
   * @param ruleName - The canonical rule name.
   */
  private suggestFix(ruleName: string): string {
    const fixes: Record<string, string> = {
      'Hardcoded Secret':
        'Move secrets to environment variables or a dedicated secret manager.',
      'AWS Access Key':
        'Rotate the key immediately via IAM and use AWS Secrets Manager.',
      'Private Key in Source':
        'Remove the key, regenerate it, and store in a vault.',
      'Potential SQL Injection':
        'Use parameterised / prepared statements.',
      'XSS / innerHTML':
        'Use textContent or a framework-safe binding instead.',
      'Dangerous eval/exec':
        'Replace with a safer alternative (e.g., JSON.parse, Function constructor with caution).',
      'Insecure Deserialization':
        'Use safe loaders (yaml.safe_load, json) and avoid untrusted input.',
      'Weak Cryptographic Algorithm':
        'Upgrade to SHA-256 or stronger; use AES instead of DES.',
      'Debug Mode Enabled':
        'Set DEBUG to false in production configurations.',
      'CORS Wildcard Origin':
        'Restrict Access-Control-Allow-Origin to specific trusted domains.',
      'Hardcoded Private IP':
        'Use environment-based configuration or DNS names.',
      'Security TODO/FIXME':
        'Address the security concern noted in this comment.',
      'JWT Inline Secret':
        'Load JWT secrets from environment variables, not source code.',
      'Potential Command Injection':
        'Validate and sanitise all user inputs before passing to shell commands.',
      'Database URL with Credentials':
        'Store connection strings in environment variables or a secret manager.',
    };

    return fixes[ruleName] ?? 'Review and remediate this finding.';
  }
}
