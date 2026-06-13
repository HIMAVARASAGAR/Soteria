import { type Severity } from '../types/findings.js';

// ─── Pattern Interface ───────────────────────────────────────────────────────

/**
 * A single vulnerability detection rule used by the static scanner.
 *
 * When `extensions` is empty the pattern applies to every file;
 * otherwise the file's extension must appear in the list.
 */
export interface ScanPattern {
  /** Human-readable rule name shown in findings. */
  readonly name: string;
  /** Severity assigned when this pattern matches. */
  readonly severity: Severity;
  /** Regex executed against each line of the file. */
  readonly pattern: RegExp;
  /** File extensions this rule applies to (empty → all files). */
  readonly extensions: readonly string[];
  /** Explanation of the vulnerability this pattern detects. */
  readonly description: string;
}

// ─── Extension Groups ────────────────────────────────────────────────────────

/** Common source-code file extensions. */
const CODE_EXTENSIONS: readonly string[] = [
  '.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.rb', '.php',
  '.go', '.rs', '.cs', '.cpp', '.c', '.h', '.hpp', '.scala', '.kt',
] as const;

/** Config file extensions. */
const CONFIG_EXTENSIONS: readonly string[] = [
  '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env',
  '.xml', '.properties',
] as const;

/** Combined code + config extensions. */
const CODE_AND_CONFIG_EXTENSIONS: readonly string[] = [
  ...CODE_EXTENSIONS,
  ...CONFIG_EXTENSIONS,
] as const;

// ─── Scan Patterns ───────────────────────────────────────────────────────────

/**
 * All static vulnerability-detection patterns.
 *
 * Each pattern is tested line-by-line against qualifying files.
 * The order here defines the canonical display order in reports.
 */
export const SCAN_PATTERNS: readonly ScanPattern[] = [
  // 1 — Hardcoded Secrets
  {
    name: 'Hardcoded Secret',
    severity: 'CRITICAL',
    pattern:
      /(?:api[_-]?key|secret[_-]?key|password|passwd|token|auth[_-]?token)\s*[=:]\s*['"][^'"]{8,}['"]/i,
    extensions: CODE_AND_CONFIG_EXTENSIONS,
    description:
      'Hardcoded API key, password, token, or secret detected in source code.',
  },

  // 2 — AWS Access Key
  {
    name: 'AWS Access Key',
    severity: 'CRITICAL',
    pattern: /AKIA[0-9A-Z]{16}/,
    extensions: [],
    description:
      'AWS access key ID found. Rotate immediately and remove from source.',
  },

  // 3 — Private Key File
  {
    name: 'Private Key in Source',
    severity: 'HIGH',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    extensions: [],
    description:
      'Private key material detected. Keys must never be committed to version control.',
  },

  // 4 — SQL Injection
  {
    name: 'Potential SQL Injection',
    severity: 'HIGH',
    pattern:
      /(?:execute|cursor\.execute|query)\s*\(\s*['"].*?\s*[+%]\s*/,
    extensions: ['.py', '.js', '.ts', '.php', '.java', '.rb'],
    description:
      'SQL query built via string concatenation — use parameterised queries instead.',
  },

  // 5 — XSS / innerHTML
  {
    name: 'XSS / innerHTML',
    severity: 'HIGH',
    pattern: /innerHTML\s*=|document\.write\s*\(/,
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.html'],
    description:
      'Direct DOM mutation via innerHTML or document.write can lead to XSS.',
  },

  // 6 — eval / exec
  {
    name: 'Dangerous eval/exec',
    severity: 'HIGH',
    pattern: /\b(?:eval|exec)\s*\(/,
    extensions: ['.py', '.js', '.ts', '.php'],
    description:
      'Use of eval() or exec() can lead to arbitrary code execution.',
  },

  // 7 — Insecure Deserialization
  {
    name: 'Insecure Deserialization',
    severity: 'HIGH',
    pattern: /pickle\.loads|yaml\.load\b(?!.*Loader)|unserialize/,
    extensions: ['.py', '.php', '.java'],
    description:
      'Unsafe deserialization can allow remote code execution.',
  },

  // 8 — Weak Crypto
  {
    name: 'Weak Cryptographic Algorithm',
    severity: 'MEDIUM',
    pattern: /\bMD5\b|\bSHA1\b(?!\d)|\bDES\b(?!C)/,
    extensions: CODE_EXTENSIONS,
    description:
      'MD5, SHA-1, or DES are cryptographically weak — use SHA-256+ or AES.',
  },

  // 9 — Debug Mode
  {
    name: 'Debug Mode Enabled',
    severity: 'MEDIUM',
    pattern: /DEBUG\s*=\s*True|debug:\s*true/i,
    extensions: ['.py', '.js', '.ts', '.json', '.yaml', '.yml'],
    description:
      'Debug mode left enabled — disable before deploying to production.',
  },

  // 10 — CORS Wildcard
  {
    name: 'CORS Wildcard Origin',
    severity: 'MEDIUM',
    pattern: /Access-Control-Allow-Origin.*\*/,
    extensions: CODE_AND_CONFIG_EXTENSIONS,
    description:
      'Wildcard CORS origin allows any site to make authenticated requests.',
  },

  // 11 — Hardcoded Private IP
  {
    name: 'Hardcoded Private IP',
    severity: 'LOW',
    pattern:
      /\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/,
    extensions: CODE_AND_CONFIG_EXTENSIONS,
    description:
      'Private IP address hardcoded in source — use configuration or DNS instead.',
  },

  // 12 — TODO/FIXME Security
  {
    name: 'Security TODO/FIXME',
    severity: 'INFO',
    pattern:
      /(?:TODO|FIXME|HACK|XXX).*(?:security|vuln|auth|inject|xss|csrf)/i,
    extensions: [],
    description:
      'Developer note referencing a known security concern that has not been addressed.',
  },

  // 13 — JWT Secret Inline
  {
    name: 'JWT Inline Secret',
    severity: 'HIGH',
    pattern: /jwt\.(?:sign|verify)\s*\(/,
    extensions: ['.js', '.ts', '.py', '.rb', '.java'],
    description:
      'JWT signing/verification detected — ensure secrets are loaded from environment, not hardcoded.',
  },

  // 14 — Command Injection
  {
    name: 'Potential Command Injection',
    severity: 'HIGH',
    pattern:
      /child_process|subprocess|os\.system|shell_exec|Runtime\.exec/,
    extensions: CODE_EXTENSIONS,
    description:
      'Direct shell invocation detected — validate and sanitise all inputs.',
  },

  // 15 — Database URL with Credentials
  {
    name: 'Database URL with Credentials',
    severity: 'HIGH',
    pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s'">]+/,
    extensions: CODE_AND_CONFIG_EXTENSIONS,
    description:
      'Database connection string found — credentials should come from a secret store.',
  },
] as const;

// ─── Sensitive File Names ────────────────────────────────────────────────────

/**
 * Filenames (or extensions) whose mere presence is a finding.
 *
 * These are matched against the **basename** of every walked path.
 */
export const SENSITIVE_FILES: readonly string[] = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.staging',
  '.pem',
  '.key',
  '.pfx',
  '.p12',
  '.jks',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  '.htpasswd',
  '.netrc',
  'credentials.json',
  'service-account.json',
  'secrets.yaml',
  'secrets.yml',
] as const;
