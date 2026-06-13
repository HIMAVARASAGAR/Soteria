/**
 * @module core/context
 *
 * Target analysis and project context building.
 *
 * Inspects a local project directory to detect technology stacks,
 * produce an ASCII file tree, and read "interesting" configuration
 * files — assembling a {@link ProjectContext} that informs the
 * LLM's security analysis.
 *
 * Ported from the Python v1 `context.py` with improvements:
 * - Never follows symlinks (security invariant)
 * - Files listed before directories in tree output
 * - Output capped at configurable character limits
 * - Config-file values are scrubbed before inclusion
 */

import { readdirSync, readFileSync, lstatSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Full context describing the analysis target.
 *
 * Passed to the planner and LLM so they understand what they're scanning.
 */
export interface ProjectContext {
  /** Local file-system path to the project root, if available. */
  readonly targetPath?: string;
  /** Remote URL target, if available. */
  readonly targetUrl?: string;
  /** Whether the target is a local directory (vs. remote URL only). */
  readonly isLocal: boolean;
  /** Detected technology stack identifiers. */
  readonly techStack: readonly string[];
  /** ASCII tree representation of the project layout. */
  readonly fileTree: string;
  /** Contents of interesting config/package files, keyed by relative path. */
  readonly packageFiles: Readonly<Record<string, string>>;
  /** Whether cloud-safety guardrails are active for this session. */
  readonly cloudSafetyActive: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Directories to skip when building the file tree. */
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
  '.idea',
  '.vscode',
  'target',
  '.gradle',
]);

/** Default maximum depth for the file tree. */
const DEFAULT_MAX_DEPTH = 4;

/** Maximum characters the file tree may occupy. */
const MAX_TREE_CHARS = 3000;

/** Maximum characters per interesting file. */
const MAX_FILE_CHARS = 1500;

/**
 * Tech-stack detection rules.
 * Key = human-readable tech label, Value = marker file (or dir) name.
 */
const TECH_MARKERS: ReadonlyArray<readonly [label: string, marker: string]> = [
  ['Node.js', 'package.json'],
  ['Python', 'requirements.txt'],
  ['Python (Poetry)', 'pyproject.toml'],
  ['Python (Pipenv)', 'Pipfile'],
  ['Java (Maven)', 'pom.xml'],
  ['Java (Gradle)', 'build.gradle'],
  ['Go', 'go.mod'],
  ['Rust', 'Cargo.toml'],
  ['Ruby', 'Gemfile'],
  ['PHP (Composer)', 'composer.json'],
  ['.NET', '*.csproj'], // handled specially below
  ['Docker', 'Dockerfile'],
  ['Docker Compose', 'docker-compose.yml'],
  ['Terraform', 'main.tf'],
  ['Kubernetes', 'k8s'],
  ['Next.js', 'next.config.js'],
  ['Next.js', 'next.config.mjs'],
  ['Next.js', 'next.config.ts'],
  ['React', 'vite.config.ts'],
  ['Angular', 'angular.json'],
  ['Vue', 'vue.config.js'],
  ['Svelte', 'svelte.config.js'],
] as const;

/**
 * Files whose contents are "interesting" for security context
 * (config, dependency manifests, CI, etc.).
 */
const INTERESTING_FILES: readonly string[] = [
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'Pipfile',
  'pom.xml',
  'build.gradle',
  'go.mod',
  'Cargo.toml',
  'Gemfile',
  'composer.json',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  '.env.example',
  '.eslintrc.json',
  'tsconfig.json',
  'nginx.conf',
  'webpack.config.js',
  '.github/workflows/ci.yml',
  '.github/workflows/deploy.yml',
] as const;

/** Regex that matches values we should scrub in config files. */
const SECRET_VALUE_RE =
  /(?:password|secret|key|token|auth|credential|apikey|api_key)\s*[=:]\s*['"]?[^\s'"]+/gi;

// ─── buildContext ────────────────────────────────────────────────────────────

/**
 * Build a complete {@link ProjectContext} for the given target.
 *
 * @param targetPath - Local file-system path to scan.
 * @param targetUrl  - Remote URL to scan.
 * @param isCloud    - Whether cloud-safety guardrails should be active.
 * @returns A frozen {@link ProjectContext}.
 */
export function buildContext(
  targetPath?: string,
  targetUrl?: string,
  isCloud = false,
): ProjectContext {
  const isLocal = targetPath !== undefined && existsSync(targetPath);

  const techStack = isLocal ? detectTech(targetPath!) : [];
  const fileTree = isLocal ? buildFileTree(targetPath!) : '';
  const packageFiles = isLocal ? readInterestingFiles(targetPath!) : {};

  return Object.freeze({
    targetPath,
    targetUrl,
    isLocal,
    techStack,
    fileTree,
    packageFiles,
    cloudSafetyActive: isCloud,
  });
}

// ─── detectTech ──────────────────────────────────────────────────────────────

/**
 * Detect the technology stack by looking for well-known marker files
 * in the project root directory.
 *
 * @param rootPath - Absolute path to the project root.
 * @returns Array of human-readable technology labels.
 */
export function detectTech(rootPath: string): string[] {
  const detected: string[] = [];
  const seen = new Set<string>();

  let entries: string[];
  try {
    entries = readdirSync(rootPath);
  } catch {
    return detected;
  }

  const entrySet = new Set(entries);

  for (const [label, marker] of TECH_MARKERS) {
    if (seen.has(label)) continue;

    // Handle glob pattern for .csproj files
    if (marker === '*.csproj') {
      if (entries.some((e) => e.endsWith('.csproj'))) {
        seen.add(label);
        detected.push(label);
      }
      continue;
    }

    if (entrySet.has(marker)) {
      seen.add(label);
      detected.push(label);
    }
  }

  return detected;
}

// ─── buildFileTree ───────────────────────────────────────────────────────────

/**
 * Produce an ASCII directory tree of the project.
 *
 * Rules:
 * - Files are listed before directories at each level.
 * - Symlinks are never followed.
 * - Ignored directories (node_modules, .git, etc.) are skipped.
 * - Output is truncated to {@link MAX_TREE_CHARS} characters.
 *
 * @param rootPath - Absolute path to the project root.
 * @param maxDepth - Maximum directory depth to traverse (default 4).
 * @returns A UTF-8 ASCII tree string.
 */
export function buildFileTree(
  rootPath: string,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): string {
  const lines: string[] = [];
  const rootName = basename(rootPath);
  lines.push(rootName + '/');

  walkTree(rootPath, '', 0, maxDepth, lines);

  let result = lines.join('\n');
  if (result.length > MAX_TREE_CHARS) {
    result = result.slice(0, MAX_TREE_CHARS - 30) + '\n[...tree truncated]';
  }

  return result;
}

/**
 * Recursive helper that appends tree lines.
 *
 * @param dir     - Current directory absolute path.
 * @param prefix  - Indentation prefix for the current level.
 * @param depth   - Current depth (0 = root).
 * @param maxDepth - Maximum depth to recurse.
 * @param lines   - Accumulator for output lines.
 */
function walkTree(
  dir: string,
  prefix: string,
  depth: number,
  maxDepth: number,
  lines: string[],
): void {
  if (depth >= maxDepth) return;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  // Classify into files and directories (skipping symlinks & ignored dirs)
  const files: string[] = [];
  const dirs: string[] = [];

  for (const entry of entries.sort()) {
    const fullPath = join(dir, entry);

    let stat;
    try {
      stat = lstatSync(fullPath);
    } catch {
      continue;
    }

    // Never follow symlinks
    if (stat.isSymbolicLink()) continue;

    if (stat.isDirectory()) {
      if (!IGNORED_DIRS.has(entry) && !entry.startsWith('.')) {
        dirs.push(entry);
      }
    } else if (stat.isFile()) {
      files.push(entry);
    }
  }

  // Files first, then directories
  const all = [...files, ...dirs.map((d) => d + '/')];
  const total = all.length;

  for (let i = 0; i < total; i++) {
    const isLast = i === total - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';
    const name = all[i];

    lines.push(`${prefix}${connector}${name}`);

    // If it's a directory (ends with /), recurse
    if (name.endsWith('/')) {
      const dirName = name.slice(0, -1);
      walkTree(
        join(dir, dirName),
        prefix + childPrefix,
        depth + 1,
        maxDepth,
        lines,
      );
    }
  }
}

// ─── readInterestingFiles ────────────────────────────────────────────────────

/**
 * Read and scrub "interesting" configuration files from the project root.
 *
 * Each file's content is truncated to {@link MAX_FILE_CHARS} characters
 * and secret-looking values are redacted.
 *
 * @param rootPath - Absolute path to the project root.
 * @returns Record mapping relative file paths to their scrubbed content.
 */
export function readInterestingFiles(rootPath: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const relPath of INTERESTING_FILES) {
    const fullPath = join(rootPath, relPath);

    let stat;
    try {
      stat = lstatSync(fullPath);
    } catch {
      continue;
    }

    // Skip symlinks and non-files
    if (stat.isSymbolicLink() || !stat.isFile()) continue;

    try {
      let content = readFileSync(fullPath, 'utf-8');

      // Truncate oversized files
      if (content.length > MAX_FILE_CHARS) {
        content = content.slice(0, MAX_FILE_CHARS) + '\n[...truncated]';
      }

      // Scrub potential secrets
      content = scrubSecrets(content);

      result[relPath] = content;
    } catch {
      // Unreadable — skip silently.
    }
  }

  return result;
}

// ─── scrubSecrets ────────────────────────────────────────────────────────────

/**
 * Redact secret-looking values from a configuration file's content.
 *
 * @param text - Raw file content.
 * @returns Content with secret values replaced by `[REDACTED]`.
 */
function scrubSecrets(text: string): string {
  return text.replace(SECRET_VALUE_RE, (match) => {
    const eqIdx = match.search(/[=:]/);
    if (eqIdx === -1) return match;
    return match.slice(0, eqIdx + 1) + ' [REDACTED]';
  });
}
