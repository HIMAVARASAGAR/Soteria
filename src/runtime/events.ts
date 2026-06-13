/**
 * @module runtime/events
 * Runtime event types and sequential event bus for agent execution.
 */

/** Tool execution status exposed to runtime observers. */
export type ToolStatus = 'success' | 'failed' | 'denied' | 'timeout' | 'cancelled';

/** Event emitted by the agent runtime. */
export type AgentEvent =
  | { readonly type: 'text'; readonly content: string }
  | { readonly type: 'thinking'; readonly content: string }
  | {
      readonly type: 'tool_call';
      readonly id: string;
      readonly name: string;
      readonly args: Record<string, unknown>;
    }
  | {
      readonly type: 'tool_result';
      readonly id: string;
      readonly name: string;
      readonly status: ToolStatus;
      readonly output: string;
      readonly durationMs: number;
    }
  | { readonly type: 'iteration'; readonly index: number; readonly maxIterations: number }
  | { readonly type: 'error'; readonly error: Error; readonly recoverable: boolean }
  | { readonly type: 'usage'; readonly promptTokens: number; readonly completionTokens: number }
  | {
      readonly type: 'done';
      readonly reason: 'complete' | 'max_iterations' | 'cancelled' | 'error' | 'budget_exhausted';
    };

/** Event handler callback. */
export type EventHandler = (event: AgentEvent) => void | Promise<void>;

/** Sequential event bus for runtime subscribers. */
export class EventBus {
  private readonly handlers: EventHandler[] = [];

  /**
   * Register an event handler.
   *
   * @param handler - Handler to invoke for future events.
   * @returns Unsubscribe function.
   */
  on(handler: EventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const index = this.handlers.indexOf(handler);
      if (index >= 0) {
        this.handlers.splice(index, 1);
      }
    };
  }

  /**
   * Emit an event to all handlers sequentially.
   *
   * Handler failures are isolated and do not abort later handlers.
   *
   * @param event - Runtime event.
   */
  async emit(event: AgentEvent): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler(event);
      } catch {
        // Event subscribers must not crash the runtime.
      }
    }
  }

  /** Remove all registered handlers. */
  removeAll(): void {
    this.handlers.splice(0, this.handlers.length);
  }
}
