/**
 * @module runtime/history
 * Tool execution audit history for agent runs.
 */

/** Recorded tool execution lifecycle entry. */
export interface ToolExecution {
  /** Internal execution identifier. */
  readonly id: string;
  /** Provider tool-call identifier. */
  readonly callId: string;
  /** Tool name. */
  readonly name: string;
  /** Tool call arguments. */
  readonly arguments: Record<string, unknown>;
  /** Execution lifecycle status. */
  readonly status:
    | 'pending'
    | 'approved'
    | 'denied'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled';
  /** Tool output, if any. */
  readonly output?: string;
  /** Error text, if any. */
  readonly error?: string;
  /** Start time. */
  readonly startedAt?: Date;
  /** Completion time. */
  readonly completedAt?: Date;
  /** Duration in milliseconds. */
  readonly durationMs?: number;
  /** Runtime iteration index. */
  readonly iterationIndex: number;
  /** Optional handler metadata. */
  readonly metadata?: Record<string, unknown>;
}

/** Mutable in-memory history of tool executions. */
export class ToolHistory {
  private readonly executions: ToolExecution[] = [];

  /**
   * Record a new execution.
   *
   * @param exec - Execution entry.
   */
  record(exec: ToolExecution): void {
    this.executions.push(exec);
  }

  /**
   * Patch an existing execution by id.
   *
   * @param id - Internal execution id.
   * @param patch - Partial entry update.
   */
  update(id: string, patch: Partial<ToolExecution>): void {
    const index = this.executions.findIndex((exec) => exec.id === id);
    if (index < 0) {
      return;
    }
    this.executions[index] = { ...this.executions[index]!, ...patch };
  }

  /** Get every recorded execution. */
  getAll(): readonly ToolExecution[] {
    return this.executions;
  }

  /**
   * Get executions for a tool.
   *
   * @param name - Tool name.
   */
  getByTool(name: string): readonly ToolExecution[] {
    return this.executions.filter((exec) => exec.name === name);
  }

  /**
   * Get executions from one runtime iteration.
   *
   * @param index - Iteration index.
   */
  getByIteration(index: number): readonly ToolExecution[] {
    return this.executions.filter((exec) => exec.iterationIndex === index);
  }
}
