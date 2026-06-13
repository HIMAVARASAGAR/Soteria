// ─── ANSI Stripping ──────────────────────────────────────────────────────────

/**
 * Regex matching ANSI escape sequences (CSI, OSC, and simple escapes).
 *
 * Covers SGR (colours/styles), cursor movement, and common OSC sequences.
 */
const ANSI_RE =
  /[\u001B\u009B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;

/**
 * Strip all ANSI escape codes from a string.
 *
 * @param text - Input that may contain ANSI colour / cursor sequences.
 * @returns The input with all ANSI escapes removed.
 *
 * @example
 * ```ts
 * stripAnsi('\u001B[31mError\u001B[0m'); // => 'Error'
 * ```
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

// ─── Markdown Stripping ──────────────────────────────────────────────────────

/**
 * Convert basic Markdown to plain text.
 *
 * Handles: ATX headers, bold, italic, inline code, fenced code blocks,
 * links, images, blockquotes, and horizontal rules.
 *
 * @param text - Markdown-formatted string.
 * @returns Approximated plain-text version.
 *
 * @example
 * ```ts
 * stripMarkdown('# Title\n**bold** and _italic_'); // => 'Title\nbold and italic'
 * ```
 */
export function stripMarkdown(text: string): string {
  let result = text;

  // Fenced code blocks → keep content, drop fences
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    const lines = match.split('\n');
    // Drop first and last lines (the ``` fences)
    return lines.slice(1, -1).join('\n');
  });

  // Inline code
  result = result.replace(/`([^`]+)`/g, '$1');

  // Images: ![alt](url) → alt
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

  // Links: [text](url) → text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // ATX headers: ## Header → Header
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '$1');

  // Bold: **text** or __text__ → text
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/__(.+?)__/g, '$1');

  // Italic: *text* or _text_ → text
  result = result.replace(/\*(.+?)\*/g, '$1');
  result = result.replace(/_(.+?)_/g, '$1');

  // Strikethrough: ~~text~~ → text
  result = result.replace(/~~(.+?)~~/g, '$1');

  // Blockquotes: > text → text
  result = result.replace(/^>\s?/gm, '');

  // Horizontal rules
  result = result.replace(/^[-*_]{3,}\s*$/gm, '');

  return result;
}

// ─── Truncation ──────────────────────────────────────────────────────────────

const DEFAULT_MAX_LINES = 200;
const DEFAULT_MAX_CHARS = 50_000;

/**
 * Truncate text that exceeds line or character limits.
 *
 * Keeps the first and last portions of the text and inserts a
 * `[...N lines omitted]` marker in the middle.
 *
 * @param text     - The text to truncate.
 * @param maxLines - Maximum number of lines to keep (default: 200).
 * @param maxChars - Maximum number of characters to keep (default: 50 000).
 * @returns The (possibly truncated) text.
 *
 * @example
 * ```ts
 * const long = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
 * const short = truncateOutput(long, 10);
 * // keeps first 5 + last 5 lines, with omission marker
 * ```
 */
export function truncateOutput(
  text: string,
  maxLines: number = DEFAULT_MAX_LINES,
  maxChars: number = DEFAULT_MAX_CHARS,
): string {
  // Character-level truncation first
  let truncated = text;
  if (truncated.length > maxChars) {
    const halfChars = Math.floor(maxChars / 2);
    const charsTrimmed = truncated.length - maxChars;
    truncated =
      truncated.slice(0, halfChars) +
      `\n[...${charsTrimmed} characters omitted]\n` +
      truncated.slice(-halfChars);
  }

  // Line-level truncation
  const lines = truncated.split('\n');
  if (lines.length <= maxLines) {
    return truncated;
  }

  const halfLines = Math.floor(maxLines / 2);
  const omitted = lines.length - maxLines;
  const head = lines.slice(0, halfLines);
  const tail = lines.slice(-halfLines);

  return [...head, `[...${omitted} lines omitted]`, ...tail].join('\n');
}

// ─── Entropy ─────────────────────────────────────────────────────────────────

const DEFAULT_ENTROPY_THRESHOLD = 3.8;

/**
 * Compute the Shannon entropy of a string (in bits per character).
 *
 * @param s - The input string.
 * @returns Entropy value in bits.
 */
function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;

  const freq = new Map<string, number>();
  for (const ch of s) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }

  let entropy = 0;
  const len = s.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

/**
 * Check whether a string has high Shannon entropy, which may indicate
 * it contains a secret (API key, token, password hash, etc.).
 *
 * @param s         - The string to test.
 * @param threshold - Entropy threshold in bits (default: 3.8).
 * @returns `true` if the entropy exceeds the threshold.
 *
 * @example
 * ```ts
 * highEntropy('aaaa');                       // false
 * highEntropy('aB3$kL9!mNqR2wXz');          // true
 * ```
 */
export function highEntropy(s: string, threshold: number = DEFAULT_ENTROPY_THRESHOLD): boolean {
  return shannonEntropy(s) > threshold;
}

// ─── Secret Scrubbing ────────────────────────────────────────────────────────

/**
 * Keywords that, when found adjacent to a high-entropy value, indicate
 * the value is likely a secret.
 */
const SECRET_KEYWORDS: readonly string[] = [
  'key',
  'token',
  'secret',
  'password',
  'passwd',
  'api_key',
  'apikey',
  'api-key',
  'auth',
  'bearer',
  'credential',
  'private',
  'access_token',
  'refresh_token',
  'client_secret',
  'session',
  'jwt',
  'authorization',
];

/**
 * Regex that matches `KEY=VALUE` or `KEY: VALUE` patterns where the key
 * contains a secret-related keyword (case-insensitive).
 */
const SECRET_PATTERN = new RegExp(
  `((?:${SECRET_KEYWORDS.join('|')})[\\w-]*)\\s*[=:]\\s*(['"]?)([^\\s'"]+)\\2`,
  'gi',
);

/**
 * Redact likely secrets from arbitrary text content.
 *
 * Scans for `KEY=VALUE` / `KEY: VALUE` patterns where the key matches
 * a secret keyword, and the value has high Shannon entropy.
 *
 * @param content - The text to scrub.
 * @returns The text with high-entropy secret values replaced by `[REDACTED]`.
 *
 * @example
 * ```ts
 * scrubSecrets('API_KEY=sk-abc123XYZ789_very_long_key');
 * // => 'API_KEY=[REDACTED]'
 * ```
 */
export function scrubSecrets(content: string): string {
  return content.replace(SECRET_PATTERN, (match, key: string, quote: string, value: string) => {
    if (value.length >= 8 && highEntropy(value)) {
      return `${key}=${quote}[REDACTED]${quote}`;
    }
    return match;
  });
}

// ─── Command Redaction ───────────────────────────────────────────────────────

/**
 * CLI flags whose *next* argument is likely a secret.
 *
 * Both short and long forms are listed. The regex matches the flag,
 * optional `=`, and then the value.
 */
const SENSITIVE_FLAGS: readonly string[] = [
  '-H',
  '--header',
  '--password',
  '--passwd',
  '--token',
  '--api-key',
  '--apikey',
  '--secret',
  '--auth',
  '--authorization',
  '--credential',
  '--private-key',
  '--client-secret',
  '--access-token',
  '--refresh-token',
];

/**
 * Build a single regex that matches any of the sensitive flags followed
 * by their value (space-separated or `=`-separated).
 */
const SENSITIVE_FLAG_RE = new RegExp(
  `(${SENSITIVE_FLAGS.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:[=\\s]+)(['"]?)([^\\s'"]+)\\2`,
  'gi',
);

/**
 * Redact sensitive CLI flags and their values from a command string.
 *
 * Matches flags like `--password`, `--token`, `-H`, etc. and replaces
 * their argument with `[REDACTED]`.
 *
 * @param command - The shell command to redact.
 * @returns The command with sensitive flag values replaced.
 *
 * @example
 * ```ts
 * redactCommand('curl -H "Authorization: Bearer sk-xyz" https://api.example.com');
 * // => 'curl -H [REDACTED] https://api.example.com'
 * ```
 */
export function redactCommand(command: string): string {
  return command.replace(
    SENSITIVE_FLAG_RE,
    (_match, flag: string, _quote: string, _value: string) => `${flag} [REDACTED]`,
  );
}

// ─── Record-Level Scrubbing ──────────────────────────────────────────────────

/**
 * Scrub secrets from an arbitrary key-value record.
 *
 * - Keys containing secret-related substrings → value replaced with `[REDACTED]`.
 * - String values with high Shannon entropy → replaced with
 *   `[REDACTED — high entropy value]`.
 * - All other values pass through unchanged.
 *
 * @param data - Input record to sanitise.
 * @returns A new record with secret values replaced.
 *
 * @example
 * ```ts
 * scrubRecord({ apiKey: 'sk-abc123...', name: 'test' });
 * // → { apiKey: '[REDACTED]', name: 'test' }
 * ```
 */
export function scrubRecord(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const keyLower = key.toLowerCase();

    if (SECRET_KEYWORDS.some((kw) => keyLower.includes(kw))) {
      clean[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length >= 16 && highEntropy(value)) {
      clean[key] = '[REDACTED — high entropy value]';
    } else {
      clean[key] = value;
    }
  }

  return clean;
}

// ─── Display Helpers ─────────────────────────────────────────────────────────

/**
 * Mask a secret string, revealing only the last `visible` characters.
 *
 * @param value   - The secret to mask.
 * @param visible - Number of trailing characters to reveal (default: 4).
 * @returns The masked string (e.g. `"••••••••abcd"`).
 */
export function maskSecret(value: string, visible = 4): string {
  if (value.length <= visible) return '•'.repeat(value.length);
  return '•'.repeat(value.length - visible) + value.slice(-visible);
}

/**
 * Truncate a string to the given length, appending `…` if truncated.
 *
 * @param text   - The string to truncate.
 * @param maxLen - Maximum length (default: 80).
 * @returns The (possibly truncated) string.
 */
export function truncate(text: string, maxLen = 80): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}
