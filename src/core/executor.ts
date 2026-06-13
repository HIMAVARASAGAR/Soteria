/**
 * @module core/executor
 *
 * Step execution coordinator.
 *
 * Bridges the agent's plan steps and the underlying tool executor.
 * Each step is classified for risk before execution, and results
 * are assembled into structured {@link StepResult} objects.
 *
 * Dependencies are injected via the constructor so the executor
 * can be tested in isolation with stubs.
 */

import type { PlanStep, StepResult } from '../types/agent.js';
import type { SuggestedCommand } from '../types/findings.js';
import type { RunResult } from '../types/tool.js';
import type { classify as ClassifyFn } from '../tools/classifier.js';
import type { executeCommand as ExecuteCommandFn } from '../tools/executor.js';
import type { Session } from './session.js';
import { sanitizeCommandOutput } from '../security/sanitizer.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Signature for the command execution function. */
export type ToolExecutorFn = typeof ExecuteCommandFn;

/** Signature for the command classification function. */
export type ClassifierFn = typeof ClassifyFn;

// ─── StepExecutor ────────────────────────────────────────────────────────────

/**
 * Coordinates the execution of individual plan steps.
 *
 * Each step goes through:
 * 1. Risk classification via the injected classifier.
 * 2. Execution via the injected tool executor.
 * 3. Output sanitisation and result assembly.
 *
 * @example
 * ```ts
 * import { classify } from '../tools/classifier.js';
 * import { executeCommand } from '../tools/executor.js';
 *
 * const executor = new StepExecutor(executeCommand, classify);
 * const result = await executor.executeStep(step, session);
 * ```
 */
export class StepExecutor {
  /**
   * @param toolExecutor - Function that safely executes a shell command.
   * @param classifier   - Function that classifies a command's risk level.
   */
  constructor(
    private readonly toolExecutor: ToolExecutorFn,
    private readonly classifier: ClassifierFn,
  ) {}

  /**
   * Execute a single plan step.
   *
   * Classifies the step's command, executes it (if not blocked),
   * and returns a structured result.
   *
   * @param step    - The plan step to execute.
   * @param session - The active session (for logging / context).
   * @returns A {@link StepResult} capturing success, output, and any findings.
   */
  async executeStep(step: PlanStep, session: Session): Promise<StepResult> {
    const classification = this.classifier(step.command);

    // Blocked commands are not executed
    if (classification.risk === 'HIGH' && !classification.safe) {
      session.addMessage({
        role: 'tool',
        toolCallId: step.id,
        name: step.tool,
        content: `Step "${step.id}" blocked: ${classification.reason}`,
      });

      return {
        stepId: step.id,
        success: false,
        error: `Command blocked by safety classifier: ${classification.reason}`,
      };
    }

    try {
      const runResult = await this.toolExecutor(step.command);

      const sanitisedOutput = sanitizeCommandOutput(
        runResult.stdout + (runResult.stderr ? `\n${runResult.stderr}` : ''),
      );

      session.addMessage({
        role: 'tool',
        toolCallId: step.id,
        name: step.tool,
        content: `[${step.tool}] ${sanitisedOutput}`,
      });

      return {
        stepId: step.id,
        success: runResult.success,
        output: sanitisedOutput,
        error: runResult.error,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        stepId: step.id,
        success: false,
        error: `Execution failed: ${errorMsg}`,
      };
    }
  }

  /**
   * Execute a risky command suggested by the LLM.
   *
   * Unlike {@link executeStep}, this method is called for ad-hoc commands
   * extracted from LLM responses (COMMAND: blocks). The command is
   * classified and executed, returning the raw {@link RunResult}.
   *
   * @param command - The suggested command to execute.
   * @param session - The active session.
   * @returns A {@link RunResult} from the underlying executor.
   */
  async executeRiskyCommand(
    command: SuggestedCommand,
    session: Session,
  ): Promise<RunResult> {
    const classification = this.classifier(command.command);

    if (classification.risk === 'HIGH' && !classification.safe) {
      return {
        command: command.command,
        allowed: false,
        ran: false,
        success: false,
        stdout: '',
        stderr: '',
        error: classification.reason,
        reason: classification.reason,
      };
    }

    const result = await this.toolExecutor(command.command);

    const sanitised = sanitizeCommandOutput(
      result.stdout + (result.stderr ? `\n${result.stderr}` : ''),
    );

    session.addMessage({
      role: 'tool',
      toolCallId: command.tool,
      name: command.tool,
      content: `[${command.tool}] ${sanitised}`,
    });

    return result;
  }
}
