import { type Finding, type Severity } from '../types/findings.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Regex matching ANSI escape sequences (colours, cursor movement, etc.). */
const ANSI_ESCAPE_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

/** Regex matching control characters except newline (\n) and tab (\t). */
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** Default maximum number of output lines to retain. */
const DEFAULT_MAX_LINES = 150;

/** Default maximum number of characters to retain. */
const DEFAULT_MAX_CHARS = 8000;

/** Canonical severity ordering — lower index = higher priority. */
const SEVERITY_ORDER: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

// ─── sanitizeCommandOutput ───────────────────────────────────────────────────

/**
 * Clean raw command output for safe downstream consumption.
 *
 * 1. Strips ANSI escape codes (colours, cursor motion, etc.).
 * 2. Strips control characters (except `\n` and `\t`).
 * 3. Truncates to `maxChars` characters and `maxLines` lines using a
 *    head + tail strategy so context from both ends is preserved.
 *
 * @param raw      - Raw command stdout / stderr.
 * @param maxLines - Maximum lines to keep (default {@link DEFAULT_MAX_LINES}).
 * @param maxChars - Maximum characters to keep (default {@link DEFAULT_MAX_CHARS}).
 * @returns The sanitised output string.
 */
export function sanitizeCommandOutput(
  raw: string,
  maxLines: number = DEFAULT_MAX_LINES,
  maxChars: number = DEFAULT_MAX_CHARS,
): string {
  // Step 1 – strip ANSI and control characters.
  let cleaned = raw
    .replace(ANSI_ESCAPE_RE, '')
    .replace(CONTROL_CHAR_RE, '');

  // Step 2 – character-level truncation.
  if (cleaned.length > maxChars) {
    const halfChars = Math.floor(maxChars / 2);
    cleaned =
      cleaned.slice(0, halfChars) +
      '\n[...output truncated...]\n' +
      cleaned.slice(-halfChars);
  }

  // Step 3 – line-level truncation (head + tail).
  const lines = cleaned.split('\n');
  if (lines.length > maxLines) {
    const headCount = Math.ceil(maxLines / 2);
    const tailCount = Math.floor(maxLines / 2);
    const omitted = lines.length - headCount - tailCount;

    const head = lines.slice(0, headCount);
    const tail = lines.slice(-tailCount);

    return [...head, `[...${omitted} lines omitted]`, ...tail].join('\n');
  }

  return cleaned;
}

// ─── sanitizeFindings ────────────────────────────────────────────────────────

/**
 * Deduplicate and sort an array of {@link Finding} objects.
 *
 * - Duplicates are identified by the tuple `(name, location)`.
 * - Results are sorted by severity (CRITICAL → INFO).
 *
 * @param findings - The raw findings array (may contain duplicates).
 * @returns A new, deduplicated, severity-sorted array.
 */
export function sanitizeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const unique: Finding[] = [];

  for (const f of findings) {
    const key = `${f.name}::${f.location}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(f);
    }
  }

  unique.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  return unique;
}

// ─── fuzzySeverity ───────────────────────────────────────────────────────────

/**
 * Map a non-standard severity string to a canonical {@link Severity} value.
 *
 * This is useful when parsing unstructured LLM output where severities may
 * be expressed in varied language.  The default is `'HIGH'` — we never bury
 * findings by defaulting to a low severity.
 *
 * @param raw - The raw severity string from an external source.
 * @returns A canonical {@link Severity} value.
 */
export function fuzzySeverity(raw: string): Severity {
  const normalised = raw.trim().toUpperCase();

  switch (normalised) {
    // ── CRITICAL ──
    case 'CRITICAL':
    case 'FATAL':
    case 'SEVERE':
      return 'CRITICAL';

    // ── HIGH ──
    case 'HIGH':
    case 'IMPORTANT':
    case 'MAJOR':
      return 'HIGH';

    // ── MEDIUM ──
    case 'MEDIUM':
    case 'MODERATE':
    case 'NOTABLE':
      return 'MEDIUM';

    // ── LOW ──
    case 'LOW':
    case 'MINOR':
    case 'NEGLIGIBLE':
      return 'LOW';

    // ── INFO ──
    case 'INFO':
    case 'INFORMATIONAL':
    case 'NOTE':
      return 'INFO';

    // ── Default — never bury unknown findings ──
    default:
      return 'HIGH';
  }
}
