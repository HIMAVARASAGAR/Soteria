/**
 * @module runtime/tool-router
 * Tool registration, approval, execution, history, and event routing.
 */

import { randomUUID } from 'node:crypto';

import type { ApprovalPolicy } from './approval.js';
import type { EventBus, ToolStatus } from './events.js';
import type { ToolHistory, ToolExecution } from './history.js';

/** Function that executes a runtime tool. */
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolHandlerResult>;

/** Result returned by a runtime tool handler. */
export interface ToolHandlerResult {
  /** Tool output text. */
  readonly output: string;
  /** Whether execution succeeded. */
  readonly success: boolean;
  /** Optional handler metadata. */
  readonly metadata?: Record<string, unknown>;
}

/** Routes normalized tool calls to registered handlers. */
export class ToolRouter {
  private readonly handlers: Map<string, ToolHandler> = new Map();

  /**
   * Register a handler.
   *
   * @param name - Tool name.
   * @param handler - Tool handler.
   */
  register(name: string, handler: ToolHandler): void {
    this.handlers.set(name, handler);
  }

  /**
   * Check whether a handler is registered.
   *
   * @param name - Tool name.
   */
  has(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Route a tool call through approval, execution, history, and events.
   *
   * @param call - Normalized tool call.
   * @param policy - Approval policy.
   * @param history - Tool history.
   * @param events - Runtime events.
   * @param signal - Abort signal.
   * @param iterationIndex - Current loop iteration index.
   */
  async route(
    call: { readonly id: string; readonly name: string; readonly arguments: Record<string, unknown> },
    policy: ApprovalPolicy,
    history: ToolHistory,
    events: EventBus,
    signal: AbortSignal,
    iterationIndex: number,
  ): Promise<{ readonly output: string; readonly success: boolean }> {
    const execId = randomUUID();
    const pending: ToolExecution = {
      id: execId,
      callId: call.id,
      name: call.name,
      arguments: call.arguments,
      status: 'pending',
      iterationIndex,
    };
    history.record(pending);

    const deny = async (reason: string, durationMs = 0): Promise<{ readonly output: string; readonly success: boolean }> => {
      history.update(execId, {
        status: 'denied',
        error: reason,
        completedAt: new Date(),
        durationMs,
      });
      await events.emit({
        type: 'tool_result',
        id: call.id,
        name: call.name,
        status: 'denied',
        output: reason,
        durationMs,
      });
      return { output: reason, success: false };
    };

    const decision = policy.check(call);
    if (decision.action === 'deny') {
      return deny(decision.reason);
    }

    if (decision.action === 'ask') {
      const approved = await policy.requestApproval(call, decision.risk, decision.reason);
      if (!approved) {
        return deny(`Denied: ${decision.reason}`);
      }
    }

    history.update(execId, { status: 'approved' });

    if (signal.aborted) {
      return this.cancel(call, history, events, execId);
    }

    const startedAt = new Date();
    history.update(execId, { status: 'running', startedAt });
    await events.emit({
      type: 'tool_call',
      id: call.id,
      name: call.name,
      args: call.arguments,
    });

    const handler = this.handlers.get(call.name);
    if (!handler) {
      return this.fail(call, history, events, execId, startedAt, `Unknown tool: ${call.name}`);
    }

    try {
      const result = await handler(call.arguments);
      const durationMs = Date.now() - startedAt.getTime();
      const status: ToolStatus = result.success ? 'success' : 'failed';
      history.update(execId, {
        status: result.success ? 'completed' : 'failed',
        output: result.output,
        completedAt: new Date(),
        durationMs,
        metadata: result.metadata,
      });
      await events.emit({
        type: 'tool_result',
        id: call.id,
        name: call.name,
        status,
        output: result.output,
        durationMs,
      });
      return { output: result.output, success: result.success };
    } catch (error) {
      return this.fail(
        call,
        history,
        events,
        execId,
        startedAt,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async cancel(
    call: { readonly id: string; readonly name: string },
    history: ToolHistory,
    events: EventBus,
    execId: string,
  ): Promise<{ readonly output: string; readonly success: boolean }> {
    const output = 'Cancelled';
    history.update(execId, {
      status: 'cancelled',
      output,
      completedAt: new Date(),
      durationMs: 0,
    });
    await events.emit({
      type: 'tool_result',
      id: call.id,
      name: call.name,
      status: 'cancelled',
      output,
      durationMs: 0,
    });
    return { output, success: false };
  }

  private async fail(
    call: { readonly id: string; readonly name: string },
    history: ToolHistory,
    events: EventBus,
    execId: string,
    startedAt: Date,
    output: string,
  ): Promise<{ readonly output: string; readonly success: boolean }> {
    const durationMs = Date.now() - startedAt.getTime();
    history.update(execId, {
      status: 'failed',
      error: output,
      output,
      completedAt: new Date(),
      durationMs,
    });
    await events.emit({
      type: 'tool_result',
      id: call.id,
      name: call.name,
      status: 'failed',
      output,
      durationMs,
    });
    return { output, success: false };
  }
}
