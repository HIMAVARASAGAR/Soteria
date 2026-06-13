/**
 * @module storage/chain-logger
 * @description HMAC hash-chained tamper-evident session logging.
 *
 * Every log entry is chained to the previous via HMAC-SHA256. A
 * per-installation key (stored in `~/.csage/.env`) signs each entry.
 * Tampering with any entry breaks the chain — provable in court.
 *
 * **Why HMAC over plain SHA-256?**
 * SHA-256 alone only detects *accidental* corruption. Anyone with log
 * access can recompute hashes of modified entries. HMAC with a secret
 * key the attacker doesn't possess makes the chain genuinely
 * tamper-*evident*, not just tamper-*detectable*.
 *
 * Log files live at `~/.csage/logs/{sessionId}.jsonl`.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  appendFileSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';

import { computeHmac, generateKey, machineIdHash } from '../utils/crypto.js';
import { redactCommand, scrubRecord } from '../utils/text.js';
import { getConfigDir } from './config.js';
import { saveApiKey, loadApiKey } from './keychain.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Sentinel used as the genesis hash for the first entry in a chain. */
const GENESIS_SENTINEL = 'CODESAGE_GENESIS';

/** Env-var name under which the HMAC signing key is stored. */
const LOG_KEY_ENV_NAME = 'CSAGE_LOG';

/** Subdirectory inside `~/.csage/` where JSONL log files are stored. */
const LOGS_DIR_NAME = 'logs';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Summary returned by {@link listSessions}. */
export interface SessionSummary {
  /** Session identifier (filename stem). */
  readonly sessionId: string;
  /** ISO-8601 timestamp of the first entry. */
  readonly started: string;
  /** ISO-8601 timestamp of the last entry. */
  readonly ended: string;
  /** Total number of entries in the log file. */
  readonly entries: number;
  /** Type of the last entry (e.g. `session_end`). */
  readonly lastType: string;
}

/** Verification result returned by {@link verifyLog}. */
export interface VerifyResult {
  /** Whether the entire chain verified successfully. */
  readonly ok: boolean;
  /** Human-readable explanation of the outcome. */
  readonly message: string;
}

// ─── Key management ──────────────────────────────────────────────────────────

/**
 * Retrieve the HMAC signing key from `~/.csage/.env`, generating
 * and persisting a new 256-bit key if none exists.
 *
 * @returns The HMAC key as a `Buffer`.
 */
function getOrCreateLogKey(): Buffer {
  const existing = loadApiKey(LOG_KEY_ENV_NAME);

  if (existing) {
    try {
      return Buffer.from(existing, 'hex');
    } catch {
      // Corrupted hex — fall through and regenerate.
    }
  }

  const key = generateKey();
  saveApiKey(LOG_KEY_ENV_NAME, key.toString('hex'));
  return key;
}

/** Absolute path to the logs directory (`~/.csage/logs/`). */
function logsDir(): string {
  const dir = join(getConfigDir(), LOGS_DIR_NAME);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Absolute path to a specific session's log file. */
function logFilePath(sessionId: string): string {
  return join(logsDir(), `${sessionId}.jsonl`);
}

// ─── HMAC chain helpers ──────────────────────────────────────────────────────

/**
 * Compute the genesis hash — HMAC of the sentinel with the key.
 */
function genesisHash(key: Buffer): string {
  return computeHmac(key, '', GENESIS_SENTINEL);
}

/**
 * Read the hash field from the last entry in a log file, or
 * return the genesis hash if the file is empty or absent.
 */
function getPrevHash(filePath: string, key: Buffer): string {
  if (!existsSync(filePath)) {
    return genesisHash(key);
  }

  const content = readFileSync(filePath, 'utf-8');
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return genesisHash(key);
  }

  try {
    const last = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
    const hash = last['hash'];
    if (typeof hash === 'string' && hash.length > 0) {
      return hash;
    }
  } catch {
    // corrupted last line — fall through
  }

  return genesisHash(key);
}

/**
 * Compute the HMAC for a log entry.
 *
 * The hash covers `prev_hash` concatenated with the deterministic
 * JSON serialisation (sorted keys) of the entry *without* its own
 * `hash` field.
 */
function computeEntryHmac(
  key: Buffer,
  prevHash: string,
  entryWithoutHash: Record<string, unknown>,
): string {
  const payload = prevHash + JSON.stringify(entryWithoutHash, Object.keys(entryWithoutHash).sort());
  return computeHmac(key, '', payload);
}

// ─── ChainLogger class ──────────────────────────────────────────────────────

/**
 * Tamper-evident, HMAC-chained session logger.
 *
 * Each instance is bound to a single session. Log entries are appended
 * to `~/.csage/logs/{sessionId}.jsonl` with an HMAC chain linking
 * every entry to its predecessor.
 *
 * @example
 * ```ts
 * const logger = new ChainLogger('sess_abc123');
 * logger.logSessionStart('/app', null, 'gpt-4o', 'web');
 * logger.logCommand('nmap -sV target', 'MEDIUM', true, true, true);
 * logger.logFinding('Open SSH', 'MEDIUM', 'target:22');
 * logger.logSessionEnd(1, 42);
 * ```
 */
export class ChainLogger {
  /** Unique session identifier. */
  readonly sessionId: string;

  /** Absolute path to the JSONL log file. */
  private readonly logFile: string;

  /** HMAC signing key. */
  private readonly key: Buffer;

  /**
   * @param sessionId - Unique session identifier (e.g. UUID).
   */
  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.logFile = logFilePath(sessionId);
    this.key = getOrCreateLogKey();
  }

  /**
   * Append a new chained log entry.
   *
   * All values in `data` are automatically scrubbed for secrets
   * before being written.
   *
   * @param eventType - Discriminator for the entry (e.g. `"command"`,
   *                    `"finding"`, `"session_start"`).
   * @param data      - Arbitrary payload to include in the entry.
   */
  log(eventType: string, data: Record<string, unknown>): void {
    const cleanData: Record<string, unknown> = scrubRecord(data);

    const entryData: Record<string, unknown> = Object.assign(
      {
        timestamp: new Date().toISOString(),
        session_id: this.sessionId,
        type: eventType,
        machine_id: machineIdHash(),
      },
      cleanData,
    );

    const prevHash = getPrevHash(this.logFile, this.key);
    entryData['prev_hash'] = prevHash;

    const hash = computeEntryHmac(this.key, prevHash, entryData);
    entryData['hash'] = hash;

    appendFileSync(this.logFile, JSON.stringify(entryData) + '\n', 'utf-8');
  }

  /**
   * Log the start of a security assessment session.
   *
   * @param targetPath - Local filesystem path to scan (may be `null`).
   * @param targetUrl  - Remote URL to scan (may be `null`).
   * @param model      - LLM model identifier being used.
   * @param scope      - Assessment scope (e.g. `"web"`, `"all"`).
   */
  logSessionStart(
    targetPath: string | null,
    targetUrl: string | null,
    model: string,
    scope: string,
  ): void {
    this.log('session_start', {
      target_path: targetPath ?? '',
      target_url: targetUrl ?? '',
      model,
      scope,
    });
  }

  /**
   * Log a command that was proposed, approved, or executed.
   *
   * The command string is redacted before logging to strip
   * sensitive flags and values.
   *
   * @param command   - Raw shell command.
   * @param riskLevel - Risk assessment (`"LOW"` / `"MEDIUM"` / `"HIGH"`).
   * @param confirmed - Whether the user confirmed the command.
   * @param ran       - Whether the command was actually executed.
   * @param success   - Whether the command completed successfully.
   */
  logCommand(
    command: string,
    riskLevel: string,
    confirmed: boolean,
    ran: boolean = false,
    success: boolean = false,
  ): void {
    this.log('command', {
      command: redactCommand(command),
      risk_level: riskLevel,
      confirmed,
      ran,
      success,
    });
  }

  /**
   * Log a security finding.
   *
   * @param name     - Short finding title.
   * @param severity - Finding severity (e.g. `"CRITICAL"`, `"HIGH"`).
   * @param location - Where the issue was found.
   */
  logFinding(name: string, severity: string, location: string): void {
    this.log('finding', { name, severity, location });
  }

  /**
   * Log the end of a session with summary statistics.
   *
   * @param findingsCount   - Total findings discovered.
   * @param durationSeconds - Wall-clock session duration in seconds.
   */
  logSessionEnd(findingsCount: number, durationSeconds: number): void {
    this.log('session_end', {
      findings_count: findingsCount,
      duration_seconds: durationSeconds,
    });
  }
}

// ─── Standalone verification ─────────────────────────────────────────────────

/**
 * Walk the entire HMAC chain for a session and verify every entry.
 *
 * Returns `{ ok: true, message }` when the full chain is intact,
 * or `{ ok: false, message }` with a description of the first
 * broken link.
 *
 * @param sessionId - Session whose log to verify.
 * @returns A {@link VerifyResult} describing the outcome.
 *
 * @example
 * ```ts
 * const result = verifyLog('sess_abc123');
 * if (!result.ok) {
 *   console.error(`Tampered! ${result.message}`);
 * }
 * ```
 */
export function verifyLog(sessionId: string): VerifyResult {
  const filePath = logFilePath(sessionId);

  if (!existsSync(filePath)) {
    return { ok: false, message: `Log file not found: ${filePath}` };
  }

  const key = getOrCreateLogKey();
  const content = readFileSync(filePath, 'utf-8');
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { ok: true, message: 'Log is empty.' };
  }

  const genesis = genesisHash(key);
  let prevHash = genesis;

  for (let i = 0; i < lines.length; i++) {
    let entry: Record<string, unknown>;

    try {
      entry = JSON.parse(lines[i]!) as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        message: `Entry ${i + 1}: JSON parse error — log may be corrupted.`,
      };
    }

    const storedHash = entry['hash'];
    const storedPrev = entry['prev_hash'];

    if (typeof storedHash !== 'string' || typeof storedPrev !== 'string') {
      return {
        ok: false,
        message: `Entry ${i + 1}: missing hash or prev_hash field.`,
      };
    }

    // Verify prev_hash linkage
    const expectedPrev = i === 0 ? genesis : prevHash;
    if (storedPrev !== expectedPrev) {
      const entryType = typeof entry['type'] === 'string' ? entry['type'] : '?';
      const entryTs = typeof entry['timestamp'] === 'string' ? entry['timestamp'] : '?';
      return {
        ok: false,
        message:
          `Entry ${i + 1} (${entryType} at ${entryTs}): ` +
          'prev_hash mismatch — chain broken here.',
      };
    }

    // Recompute HMAC without the hash field
    const checkData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entry)) {
      if (k !== 'hash') {
        checkData[k] = v;
      }
    }

    const expectedHash = computeEntryHmac(key, storedPrev, checkData);

    if (storedHash !== expectedHash) {
      const entryType = typeof entry['type'] === 'string' ? entry['type'] : '?';
      const entryTs = typeof entry['timestamp'] === 'string' ? entry['timestamp'] : '?';
      return {
        ok: false,
        message:
          `Entry ${i + 1} (${entryType} at ${entryTs}): ` +
          'HMAC mismatch — this entry was tampered with.',
      };
    }

    prevHash = storedHash;
  }

  return {
    ok: true,
    message: `✓ All ${lines.length} entries verified — log integrity intact.`,
  };
}

/**
 * List summary information for all logged sessions.
 *
 * Scans `~/.csage/logs/` for `.jsonl` files and reads the first and
 * last entry of each to build a summary.
 *
 * @returns An array of {@link SessionSummary} objects, most recent first.
 *
 * @example
 * ```ts
 * for (const s of listSessions()) {
 *   console.log(`${s.sessionId}: ${s.entries} entries`);
 * }
 * ```
 */
export function listSessions(): SessionSummary[] {
  const dir = join(getConfigDir(), LOGS_DIR_NAME);

  if (!existsSync(dir)) {
    return [];
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .reverse();

  const sessions: SessionSummary[] = [];

  for (const file of files) {
    const filePath = join(dir, file);
    const content = readFileSync(filePath, 'utf-8');
    const lines = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) continue;

    try {
      const first = JSON.parse(lines[0]!) as Record<string, unknown>;
      const last = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;

      sessions.push({
        sessionId: file.replace('.jsonl', ''),
        started: typeof first['timestamp'] === 'string' ? first['timestamp'] : '?',
        ended: typeof last['timestamp'] === 'string' ? last['timestamp'] : '?',
        entries: lines.length,
        lastType: typeof last['type'] === 'string' ? last['type'] : '?',
      });
    } catch {
      // Skip corrupted files
    }
  }

  return sessions;
}
