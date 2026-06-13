/**
 * @module runtime/runtime
 * High-level agent runtime facade.
 */

import type { LLMProvider } from '../providers/types.js';
import type { ChainLogger } from '../core/session.js';
import type { Message, ToolDefinition } from '../types/provider.js';
import { EventBus } from './events.js';
import { ToolHistory, type ToolExecution } from './history.js';
import { ContextManager } from './context-manager.js';
import type { ApprovalPolicy } from './approval.js';
import { ExecutionLoop, DEFAULT_RESOURCE_BUDGET, type ResourceBudget } from './loop.js';
import { ToolRouter, type ToolHandler } from './tool-router.js';

/** Agent runtime configuration. */
export interface RuntimeConfig {
  /** LLM provider. */
  readonly provider: LLMProvider;
  /** System prompt. */
  readonly systemPrompt: string;
  /** Provider-visible tool definitions. */
  readonly tools: ToolDefinition[];
  /** Runtime tool handlers keyed by name. */
  readonly toolHandlers: Map<string, ToolHandler>;
  /** Tool approval policy. */
  readonly approvalPolicy: ApprovalPolicy;
  /** Optional resource budget overrides. */
  readonly budget?: Partial<ResourceBudget>;
  /** Optional audit logger. */
  readonly logger?: ChainLogger;
}

/** High-level runtime wrapper for one agent conversation. */
export class AgentRuntime {
  /** Public event bus for renderer/UI subscribers. */
  public readonly events: EventBus;

  private loop: ExecutionLoop;
  private history: ToolHistory;
  private readonly contextManager: ContextManager;
  private readonly toolRouter: ToolRouter;
  private abortController: AbortController;

  /**
   * Create an agent runtime.
   *
   * @param config - Runtime configuration.
   */
  constructor(private readonly config: RuntimeConfig) {
    this.events = new EventBus();
    this.history = new ToolHistory();
    this.contextManager = new ContextManager(config.systemPrompt);
    this.toolRouter = new ToolRouter();
    this.abortController = new AbortController();

    for (const [name, handler] of config.toolHandlers) {
      this.toolRouter.register(name, handler);
    }

    this.loop = this.createLoop();
    this.config.logger?.info('AGENT_RUNTIME_CREATED');
  }

  /**
   * Run the runtime with a new user message.
   *
   * @param userMessage - User message.
   */
  async run(userMessage: string): Promise<void> {
    this.contextManager.addMessage({ role: 'user', content: userMessage });
    this.abortController = new AbortController();
    await this.loop.execute(this.abortController.signal);
  }

  /** Cancel the active run. */
  cancel(): void {
    this.abortController.abort();
  }

  /** Get recorded tool history. */
  getHistory(): readonly ToolExecution[] {
    return this.history.getAll();
  }

  /** Get conversation messages. */
  getConversation(): readonly Message[] {
    return this.contextManager.getMessages();
  }

  /** Reset conversation and tool history. */
  reset(): void {
    this.contextManager.clear();
    this.history = new ToolHistory();
    this.loop = this.createLoop();
  }

  private createLoop(): ExecutionLoop {
    return new ExecutionLoop(
      this.config.provider,
      this.contextManager,
      this.toolRouter,
      this.config.approvalPolicy,
      this.history,
      this.events,
      { ...DEFAULT_RESOURCE_BUDGET, ...this.config.budget },
      this.config.tools,
    );
  }
}
