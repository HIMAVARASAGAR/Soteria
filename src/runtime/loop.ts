/**
 * @module runtime/loop
 * Autonomous streaming execution loop for agent runs.
 */

import { randomUUID } from 'node:crypto';

import type { LLMProvider } from '../providers/types.js';
import type { ToolCall, ToolDefinition } from '../types/provider.js';
import type { ApprovalPolicy } from './approval.js';
import type { ContextManager } from './context-manager.js';
import type { EventBus } from './events.js';
import type { ToolHistory } from './history.js';
import type { ToolRouter } from './tool-router.js';

/** Resource limits for autonomous runtime execution. */
export interface ResourceBudget {
  /** Maximum LLM iterations. */
  readonly maxIterations: number;
  /** Maximum tool calls in one run. */
  readonly maxToolCalls: number;
  /** Maximum wall-clock execution time. */
  readonly maxExecutionTimeMs: number;
  /** Maximum estimated context token budget. */
  readonly maxTokenBudget: number;
}

/** Default runtime resource budget. */
export const DEFAULT_RESOURCE_BUDGET: ResourceBudget = {
  maxIterations: 25,
  maxToolCalls: 50,
  maxExecutionTimeMs: 600_000,
  maxTokenBudget: 200_000,
};

/** Runs the model/tool loop until completion, cancellation, or budget exit. */
export class ExecutionLoop {
  /**
   * Create an execution loop.
   *
   * @param provider - LLM provider.
   * @param contextManager - Runtime context manager.
   * @param toolRouter - Tool router.
   * @param approvalPolicy - Approval policy.
   * @param history - Tool history.
   * @param events - Runtime event bus.
   * @param budget - Resource budget.
   * @param tools - Tool definitions exposed to the provider.
   */
  constructor(
    private readonly provider: LLMProvider,
    private readonly contextManager: ContextManager,
    private readonly toolRouter: ToolRouter,
    private readonly approvalPolicy: ApprovalPolicy,
    private readonly history: ToolHistory,
    private readonly events: EventBus,
    private readonly budget: ResourceBudget,
    private readonly tools: ToolDefinition[],
  ) {}

  /**
   * Execute the autonomous loop.
   *
   * @param signal - Abort signal.
   */
  async execute(signal: AbortSignal): Promise<void> {
    let iteration = 0;
    let totalToolCalls = 0;
    const startTime = Date.now();

    while (
      iteration < this.budget.maxIterations &&
      totalToolCalls < this.budget.maxToolCalls &&
      Date.now() - startTime < this.budget.maxExecutionTimeMs &&
      this.contextManager.getTokenEstimate() < this.budget.maxTokenBudget &&
      !signal.aborted
    ) {
      iteration += 1;
      await this.events.emit({
        type: 'iteration',
        index: iteration,
        maxIterations: this.budget.maxIterations,
      });

      if (signal.aborted) {
        await this.events.emit({ type: 'done', reason: 'cancelled' });
        return;
      }

      const textParts: string[] = [];
      const pendingCalls: ToolCall[] = [];

      try {
        const stream = this.provider.stream({
          systemPrompt: this.contextManager.getSystemPrompt(),
          messages: [...this.contextManager.getMessages()],
          tools: this.provider.supportsToolCalling ? this.tools : undefined,
          toolChoice: this.provider.supportsToolCalling ? 'auto' : 'none',
        });

        for await (const chunk of stream) {
          if (signal.aborted) {
            await this.events.emit({ type: 'done', reason: 'cancelled' });
            return;
          }

          if (chunk.type === 'text') {
            textParts.push(chunk.content);
            await this.events.emit({ type: 'text', content: chunk.content });
          } else if (chunk.type === 'tool_call') {
            pendingCalls.push(chunk.call);
          } else if (chunk.type === 'error') {
            await this.events.emit({
              type: 'error',
              error: new Error(chunk.content),
              recoverable: false,
            });
            await this.events.emit({ type: 'done', reason: 'error' });
            return;
          } else if (chunk.type === 'done') {
            break;
          }
        }
      } catch (error) {
        await this.events.emit({
          type: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
          recoverable: false,
        });
        await this.events.emit({ type: 'done', reason: 'error' });
        return;
      }

      if (signal.aborted) {
        await this.events.emit({ type: 'done', reason: 'cancelled' });
        return;
      }

      const content = textParts.join('');
      this.contextManager.addMessage({
        role: 'assistant',
        content,
        ...(pendingCalls.length > 0 && { toolCalls: pendingCalls }),
      });

      if (pendingCalls.length === 0) {
        await this.events.emit({ type: 'done', reason: 'complete' });
        return;
      }

      for (const call of pendingCalls) {
        if (signal.aborted) {
          await this.events.emit({ type: 'done', reason: 'cancelled' });
          return;
        }
        if (totalToolCalls >= this.budget.maxToolCalls) {
          await this.events.emit({ type: 'done', reason: 'budget_exhausted' });
          return;
        }

        const routedCall = call.id.length > 0 ? call : { ...call, id: randomUUID() };
        const result = await this.toolRouter.route(
          routedCall,
          this.approvalPolicy,
          this.history,
          this.events,
          signal,
          iteration,
        );
        this.contextManager.addMessage({
          role: 'tool',
          toolCallId: routedCall.id,
          name: routedCall.name,
          content: result.output,
        });
        totalToolCalls += 1;
      }
    }

    if (signal.aborted) {
      await this.events.emit({ type: 'done', reason: 'cancelled' });
      return;
    }
    if (iteration >= this.budget.maxIterations) {
      await this.events.emit({ type: 'done', reason: 'max_iterations' });
      return;
    }
    await this.events.emit({ type: 'done', reason: 'budget_exhausted' });
  }
}
