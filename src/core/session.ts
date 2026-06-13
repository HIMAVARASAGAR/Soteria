/**
 * @module core/session
 *
 * Session lifecycle and state management for a single CSage assessment.
 *
 * A {@link Session} tracks conversation history, accumulated findings,
 * and the current lifecycle state. State transitions are validated
 * against a finite-state-machine definition, and all major events
 * are logged through a {@link ChainLogger} for tamper-evident audit.
 */

import { randomUUID } from 'node:crypto';
import type { Target, SessionState } from '../types/agent.js';
import type { Message } from '../types/provider.js';
import type { Finding } from '../types/findings.js';

// ─── ChainLogger Interface ───────────────────────────────────────────────────

/**
 * Minimal audit-logging interface consumed by Session.
 *
 * Implementations should produce tamper-evident (hash-chained) log entries.
 * This interface is intentionally narrow so the session module does not
 * depend on any concrete logger implementation.
 */
export interface ChainLogger {
  /** Append an informational log entry. */
  info(message: string): void;
  /** Append a warning-level log entry. */
  warn(message: string): void;
  /** Append an error-level log entry. */
  error(message: string): void;
}

// ─── Session Options ─────────────────────────────────────────────────────────

/** Options required to construct a new {@link Session}. */
export interface SessionOptions {
  /** The assessment target. */
  readonly target: Target;
  /** The LLM model identifier (e.g. "gpt-4o"). */
  readonly model: string;
  /** The assessment scope (e.g. "all", "web"). */
  readonly scope: string;
  /** Optional chain logger; if omitted a no-op logger is used. */
  readonly logger?: ChainLogger;
}

// ─── State Machine ───────────────────────────────────────────────────────────

/**
 * Valid state transitions.
 * Key = current state, Value = set of states that may follow.
 */
const VALID_TRANSITIONS: Readonly<Record<SessionState, ReadonlySet<SessionState>>> = {
  initializing: new Set<SessionState>(['planning', 'ended']),
  planning: new Set<SessionState>(['executing', 'ended']),
  executing: new Set<SessionState>(['planning', 'reporting', 'ended']),
  reporting: new Set<SessionState>(['ended']),
  ended: new Set<SessionState>([]),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate a unique session identifier (UUID v4).
 *
 * @returns A new UUID string.
 */
export function createSessionId(): string {
  return randomUUID();
}

/** No-op logger used when no logger is supplied. */
const NOOP_LOGGER: ChainLogger = {
  info() {},
  warn() {},
  error() {},
};

// ─── Session ─────────────────────────────────────────────────────────────────

/**
 * Manages the full lifecycle of a single security-assessment session.
 *
 * Responsibilities:
 * - Generates a unique session ID via {@link createSessionId}.
 * - Validates state transitions against a finite-state machine.
 * - Deduplicates findings by `(name, location)`.
 * - Logs SESSION_START on construction and SESSION_END when ended.
 *
 * @example
 * ```ts
 * const session = new Session({
 *   target: { path: '/project', scope: 'all' },
 *   model: 'gpt-4o',
 *   scope: 'all',
 * });
 *
 * session.transition('planning');
 * session.addMessage({ role: 'user', content: 'Start scan' });
 * session.transition('ended');
 * ```
 */
export class Session {
  /** Unique identifier for this session. */
  readonly id: string;
  /** Timestamp when the session was created. */
  readonly startedAt: Date;
  /** The assessment target. */
  readonly target: Target;
  /** LLM model identifier. */
  readonly model: string;
  /** Assessment scope label. */
  readonly scope: string;

  /** Current lifecycle state (private backing field). */
  private _state: SessionState;
  /** Ordered conversation history. */
  private readonly _conversation: Message[];
  /** Accumulated security findings (deduplicated). */
  private readonly _findings: Finding[];
  /** Keys of findings already added, for deduplication. */
  private readonly _findingKeys: Set<string>;
  /** Audit logger. */
  private readonly logger: ChainLogger;

  constructor(options: SessionOptions) {
    this.id = createSessionId();
    this.startedAt = new Date();
    this.target = options.target;
    this.model = options.model;
    this.scope = options.scope;
    this._state = 'initializing';
    this._conversation = [];
    this._findings = [];
    this._findingKeys = new Set();
    this.logger = options.logger ?? NOOP_LOGGER;

    this.logger.info(
      `SESSION_START id=${this.id} model=${this.model} scope=${this.scope}`,
    );
  }

  // ── Getters ─────────────────────────────────────────────────────────────

  /** Current lifecycle state. */
  get state(): SessionState {
    return this._state;
  }

  /** Read-only view of the conversation history. */
  get conversation(): readonly Message[] {
    return this._conversation;
  }

  /** Read-only view of accumulated findings. */
  get findings(): readonly Finding[] {
    return this._findings;
  }

  // ── State Transitions ───────────────────────────────────────────────────

  /**
   * Transition the session to a new lifecycle state.
   *
   * @param newState - The target state.
   * @throws {Error} If the transition is not allowed by the state machine.
   */
  transition(newState: SessionState): void {
    const allowed = VALID_TRANSITIONS[this._state];
    if (!allowed.has(newState)) {
      const msg = `Invalid state transition: ${this._state} → ${newState}`;
      this.logger.error(msg);
      throw new Error(msg);
    }

    this.logger.info(`STATE_TRANSITION ${this._state} → ${newState}`);
    this._state = newState;

    if (newState === 'ended') {
      this.logger.info(
        `SESSION_END id=${this.id} duration=${this.getDuration()}ms findings=${this._findings.length}`,
      );
    }
  }

  // ── Messages ────────────────────────────────────────────────────────────

  /**
   * Append a message to the conversation history.
   *
   * @param message - The chat message to record.
   */
  addMessage(message: Message): void {
    this._conversation.push(message);
  }

  // ── Findings ────────────────────────────────────────────────────────────

  /**
   * Record a security finding, deduplicating by `(name, location)`.
   *
   * @param finding - The finding to add.
   */
  addFinding(finding: Finding): void {
    const key = `${finding.name}::${finding.location}`;
    if (this._findingKeys.has(key)) return;

    this._findingKeys.add(key);
    this._findings.push(finding);
    this.logger.info(
      `FINDING_ADDED name="${finding.name}" severity=${finding.severity} location="${finding.location}"`,
    );
  }

  // ── Duration ────────────────────────────────────────────────────────────

  /**
   * Compute the elapsed duration of this session in milliseconds.
   *
   * @returns Milliseconds since {@link startedAt}.
   */
  getDuration(): number {
    return Date.now() - this.startedAt.getTime();
  }
}
