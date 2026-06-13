/**
 * @module core/agent
 *
 * Agent orchestration — the top-level coordinator for a CSage
 * security assessment.
 *
 * {@link SecurityAgent} wires together context building, static scanning,
 * LLM interaction, and response parsing into a coherent workflow.
 *
 * Lifecycle (`run()`):
 * 1. Build project context.
 * 2. Run static scan.
 * 3. Build LLM system prompt.
 * 4. Send initial message.
 * 5. Parse response → absorb findings → return.
 */

import { z } from 'zod';

import type { LLMProvider } from '../providers/types.js';
import { StaticScanner } from '../security/scanner.js';
import { classify } from '../tools/classifier.js';
import { executeCommand } from '../tools/executor.js';

import { buildContext, type ProjectContext } from './context.js';
import { Session, type SessionOptions, type ChainLogger } from './session.js';
import { buildSystemPrompt } from './planner.js';
import { StepExecutor } from './executor.js';
import { fuzzySeverity } from '../security/sanitizer.js';

import type { Finding, ParsedResponse, SuggestedCommand } from '../types/findings.js';
import {
  FindingSchema,
  SuggestedCommandSchema,
} from '../types/findings.js';
import type { Target } from '../types/agent.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Options for constructing a {@link SecurityAgent}. */
export interface AgentOptions {
  /** The assessment target. */
  readonly target: Target;
  /** The LLM provider to use for conversation. */
  readonly provider: LLMProvider;
  /** LLM model identifier (e.g. "gpt-4o"). */
  readonly model: string;
  /** Assessment scope (e.g. "all", "web", "ports"). */
  readonly scope: string;
  /** Whether cloud-safety guardrails should be active. */
  readonly isCloud?: boolean;
  /** Optional chain logger for audit trail. */
  readonly logger?: ChainLogger;
}

// ─── Regex Patterns for Response Parsing ────────────────────────────────────

/**
 * Regex to extract FINDING: blocks from LLM output.
 *
 * Captures the indented key-value body following the `FINDING:` marker.
 * Non-greedy match stops at the next block marker, double newline, or EOF.
 */
const FINDING_BLOCK_RE =
  /FINDING:\s*\n((?:[ \t]+\w[\w ]*:.*\n?)+)/g;

/**
 * Regex to extract COMMAND: blocks from LLM output.
 */
const COMMAND_BLOCK_RE =
  /COMMAND:\s*\n((?:[ \t]+\w[\w ]*:.*\n?)+)/g;

/**
 * Regex to extract a single `key: value` line from an indented block.
 */
const KV_LINE_RE = /^\s+(\w[\w ]*?)\s*:\s*(.+)$/;

// ─── SecurityAgent ──────────────────────────────────────────────────────────

/**
 * Top-level orchestrator for a CSage security assessment.
 *
 * @example
 * ```ts
 * const agent = new SecurityAgent({
 *   target: { path: '/project', scope: 'all' },
 *   provider: myLLMProvider,
 *   model: 'gpt-4o',
 *   scope: 'all',
 * });
 *
 * await agent.run();
 * const response = await agent.chat('What did you find?');
 * ```
 */
export class SecurityAgent {
  private readonly session: Session;
  private readonly provider: LLMProvider;
  private readonly scanner: StaticScanner;
  private readonly _executor: StepExecutor;
  private systemPrompt: string;
  private context: ProjectContext | undefined;

  /** Expose the step executor for the CLI interactive loop. */
  get executor(): StepExecutor {
    return this._executor;
  }

  constructor(options: AgentOptions) {
    const sessionOpts: SessionOptions = {
      target: options.target,
      model: options.model,
      scope: options.scope,
      logger: options.logger,
    };

    this.session = new Session(sessionOpts);
    this.provider = options.provider;
    this.scanner = new StaticScanner(options.target.path ?? '.');
    this._executor = new StepExecutor(executeCommand, classify);
    this.systemPrompt = '';

    // Build context eagerly so it's available for run() and chat()
    this.context = buildContext(
      options.target.path,
      options.target.url,
      options.isCloud,
    );
  }

  /**
   * Execute the initial assessment workflow.
   *
   * 1. Transition to `planning`.
   * 2. Build project context.
   * 3. Run static scanner (if local target).
   * 4. Build the LLM system prompt.
   * 5. Send an initial message and parse the response.
   * 6. Absorb any findings.
   */
  async run(): Promise<void> {
    // ── Planning ──
    this.session.transition('planning');

    // Build system prompt from context
    this.systemPrompt = buildSystemPrompt(
      this.context!,
      this.session.scope,
    );

    // ── Static scan ──
    const staticFindings: Finding[] = [];
    if (this.context!.isLocal && this.session.target.path) {
      const scanResults = this.scanner.scan();
      for (const finding of scanResults) {
        staticFindings.push(finding);
        this.session.addFinding(finding);
      }
    }

    // ── Executing (initial LLM call) ──
    this.session.transition('executing');

    const initialMessage = this.buildInitialMessage(staticFindings);
    this.session.addMessage({ role: 'user', content: initialMessage });

    const response = await this.provider.chat({
      systemPrompt: this.systemPrompt,
      messages: [...this.session.conversation],
    });

    this.session.addMessage({ role: 'assistant', content: response.content });

    // Parse and absorb
    const parsed = this.parseResponse(response.content);
    for (const finding of parsed.findings) {
      this.session.addFinding(finding);
    }
  }

  /**
   * Send a user message and receive a parsed response.
   *
   * Appends to the session conversation, calls the LLM, parses
   * the response, and absorbs any new findings.
   *
   * @param userMessage - The user's message text.
   * @returns The parsed response with findings, commands, and narrative.
   */
  async chat(userMessage: string): Promise<ParsedResponse> {
    this.session.addMessage({ role: 'user', content: userMessage });

    const response = await this.provider.chat({
      systemPrompt: this.systemPrompt,
      messages: [...this.session.conversation],
    });

    this.session.addMessage({ role: 'assistant', content: response.content });

    const parsed = this.parseResponse(response.content);

    // Absorb findings
    for (const finding of parsed.findings) {
      this.session.addFinding(finding);
    }

    return parsed;
  }

  // ─── Accessors ─────────────────────────────────────────────────────────

  /** The step executor for running plan steps and ad-hoc commands. */
  getExecutor(): StepExecutor {
    return this.executor;
  }

  /** The active session instance. */
  getSession(): Session {
    return this.session;
  }

  // ─── Private Helpers ───────────────────────────────────────────────────

  /**
   * Build the initial user message that kicks off the assessment.
   *
   * Includes a summary of the target and any static-scan findings.
   *
   * @param staticFindings - Findings from the static scanner.
   * @returns The initial message string.
   */
  private buildInitialMessage(staticFindings: readonly Finding[]): string {
    const parts: string[] = [];

    parts.push(
      `Begin security assessment of the target.`,
    );

    if (this.context?.targetUrl) {
      parts.push(`Target URL: ${this.context.targetUrl}`);
    }
    if (this.context?.targetPath) {
      parts.push(`Target path: ${this.context.targetPath}`);
    }

    if (staticFindings.length > 0) {
      parts.push(
        `\nStatic analysis found ${staticFindings.length} potential issue(s):`,
      );
      for (const f of staticFindings) {
        parts.push(`- [${f.severity}] ${f.name} at ${f.location}: ${f.what}`);
      }
      parts.push(
        '\nPlease review these findings and suggest further dynamic testing.',
      );
    } else {
      parts.push(
        '\nNo issues found during static analysis. Proceed with dynamic testing.',
      );
    }

    return parts.join('\n');
  }

  /**
   * Parse an LLM response into structured findings, commands, and narrative.
   *
   * Extracts FINDING: and COMMAND: blocks using regex, validates each
   * with Zod schemas, and collects any parse warnings.
   *
   * @param text - Raw LLM response text.
   * @returns A validated {@link ParsedResponse}.
   */
  private parseResponse(text: string): ParsedResponse {
    const findings: Finding[] = [];
    const commands: SuggestedCommand[] = [];
    const parseWarnings: string[] = [];

    // ── Extract findings ──
    let findingMatch: RegExpExecArray | null;
    // Reset regex state
    FINDING_BLOCK_RE.lastIndex = 0;
    while ((findingMatch = FINDING_BLOCK_RE.exec(text)) !== null) {
      const block = findingMatch[1];
      const kv = parseKeyValueBlock(block);

      try {
        const finding = FindingSchema.parse({
          name: kv['name'] ?? 'Unnamed Finding',
          severity: fuzzySeverity(kv['severity'] ?? 'HIGH'),
          location: kv['location'] ?? 'unknown',
          what: kv['what'] ?? 'No description provided.',
          impact: kv['impact'],
          fix: kv['fix'],
          exploitCmd: kv['exploitCmd'] ?? kv['exploit_cmd'] ?? kv['exploit'],
          confidence: kv['confidence'] ? parseFloat(kv['confidence']) : undefined,
        });
        findings.push(finding);
      } catch (err: unknown) {
        const msg = err instanceof z.ZodError
          ? err.issues.map((i) => i.message).join(', ')
          : String(err);
        parseWarnings.push(`Failed to parse FINDING block: ${msg}`);
      }
    }

    // ── Extract commands ──
    let commandMatch: RegExpExecArray | null;
    COMMAND_BLOCK_RE.lastIndex = 0;
    while ((commandMatch = COMMAND_BLOCK_RE.exec(text)) !== null) {
      const block = commandMatch[1];
      const kv = parseKeyValueBlock(block);

      try {
        const command = SuggestedCommandSchema.parse({
          command: kv['command'] ?? '',
          tool: kv['tool'] ?? 'unknown',
          why: kv['why'] ?? 'No justification provided.',
          flags: kv['flags'],
          risk: normaliseRisk(kv['risk'] ?? 'MEDIUM'),
        });
        commands.push(command);
      } catch (err: unknown) {
        const msg = err instanceof z.ZodError
          ? err.issues.map((i) => i.message).join(', ')
          : String(err);
        parseWarnings.push(`Failed to parse COMMAND block: ${msg}`);
      }
    }

    // ── Narrative: everything outside blocks ──
    const narrative = text
      .replace(FINDING_BLOCK_RE, '')
      .replace(COMMAND_BLOCK_RE, '')
      .trim();

    // Reset regex state after replacement calls
    FINDING_BLOCK_RE.lastIndex = 0;
    COMMAND_BLOCK_RE.lastIndex = 0;

    return { findings, commands, narrative, parseWarnings };
  }
}

// ─── Block Parsing Helpers ──────────────────────────────────────────────────

/**
 * Parse an indented key-value block into a record.
 *
 * @param block - The indented text body of a FINDING: or COMMAND: block.
 * @returns A record of lowercase key → value.
 */
function parseKeyValueBlock(block: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = block.split('\n');

  for (const line of lines) {
    const match = KV_LINE_RE.exec(line);
    if (match) {
      const key = match[1].trim().toLowerCase().replace(/\s+/g, '_');
      result[key] = match[2].trim();
    }
  }

  return result;
}

/**
 * Normalise a risk string to one of the valid CommandRisk values.
 *
 * @param raw - Raw risk string from LLM output.
 * @returns A valid CommandRisk value.
 */
function normaliseRisk(raw: string): 'LOW' | 'MEDIUM' | 'HIGH' {
  const upper = raw.trim().toUpperCase();
  if (upper === 'LOW') return 'LOW';
  if (upper === 'HIGH') return 'HIGH';
  return 'MEDIUM';
}
