/**
 * @module agents/security/agent
 * Runtime-backed security agent specialization.
 */

import type { LLMProvider } from '../../providers/types.js';
import type { ChainLogger } from '../../core/session.js';
import type { Target } from '../../types/agent.js';
import type { Finding } from '../../types/findings.js';
import type { ToolExecution } from '../../runtime/history.js';
import type { Message } from '../../types/provider.js';
import { AgentRuntime } from '../../runtime/runtime.js';
import { SecurityApprovalPolicy } from '../../runtime/approval.js';
import { classify } from '../../tools/classifier.js';
import { buildContext } from '../../core/context.js';
import { StaticScanner } from '../../security/scanner.js';
import { buildSecurityPrompt } from './prompts.js';
import { buildSecurityToolHandlers, getSecurityToolDefinitions } from './tools.js';

/** Options for constructing a runtime-backed security agent. */
export interface SecurityAgentOptions {
  /** LLM provider. */
  readonly provider: LLMProvider;
  /** Assessment target. */
  readonly target: Target;
  /** Assessment scope. */
  readonly scope: string;
  /** Whether cloud safety mode is active. */
  readonly isCloud?: boolean;
  /** Maximum runtime iterations. */
  readonly maxIterations?: number;
  /** Optional audit logger. */
  readonly logger?: ChainLogger;
  /** Prompt function used for risky tool approval. */
  readonly approvalPromptFn: (
    call: { readonly name: string; readonly arguments: Record<string, unknown> },
    risk: string,
    reason: string,
  ) => Promise<boolean>;
}

/** Runtime-backed security assessment agent. */
export class SecurityAgent {
  /** Underlying generic agent runtime. */
  public readonly runtime: AgentRuntime;

  private readonly target: Target;

  /**
   * Create a security agent.
   *
   * @param options - Security agent options.
   */
  constructor(options: SecurityAgentOptions) {
    this.target = options.target;
    const context = buildContext(options.target.path, options.target.url, options.isCloud);
    const systemPrompt = buildSecurityPrompt(context, options.scope);
    const tools = getSecurityToolDefinitions(options.scope);
    const toolHandlers = buildSecurityToolHandlers(options.target.path);
    const approvalPolicy = new SecurityApprovalPolicy(classify, options.approvalPromptFn);

    this.runtime = new AgentRuntime({
      provider: options.provider,
      systemPrompt,
      tools,
      toolHandlers,
      approvalPolicy,
      logger: options.logger,
      budget: {
        ...(options.maxIterations !== undefined && { maxIterations: options.maxIterations }),
      },
    });
  }

  /** Runtime event bus. */
  get events() {
    return this.runtime.events;
  }

  /** Run the agent for a user message. */
  run(message: string): Promise<void> {
    return this.runtime.run(message);
  }

  /** Cancel the active run. */
  cancel(): void {
    this.runtime.cancel();
  }

  /** Run static initialization checks for local targets. */
  async initialize(): Promise<Finding[]> {
    if (!this.target.path) {
      return [];
    }
    const scanner = new StaticScanner(this.target.path);
    return scanner.scan();
  }

  /** Get tool execution history. */
  getHistory(): readonly ToolExecution[] {
    return this.runtime.getHistory();
  }

  /** Get conversation messages. */
  getConversation(): readonly Message[] {
    return this.runtime.getConversation();
  }
}
