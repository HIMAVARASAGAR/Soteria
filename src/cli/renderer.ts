/**
 * @module cli/renderer
 * Streaming terminal renderer for the agent REPL.
 */

import readline from 'node:readline';

import { theme } from './ui/theme.js';
import type { ToolStatus } from '../runtime/events.js';

/** Terminal renderer for runtime events. */
export class StreamRenderer {
  private buffer = '';
  private lastWasNewline = true;

  /** Stream raw assistant text. */
  streamText(content: string): void {
    process.stdout.write(content);
    this.buffer += content;
    this.lastWasNewline = content.endsWith('\n');
  }

  /** Finish the current assistant text stream. */
  finalize(): void {
    if (this.buffer.length > 0 && !this.lastWasNewline) {
      process.stdout.write('\n');
    }
    this.buffer = '';
    this.lastWasNewline = true;
  }

  /** Show a tool call event. */
  showToolCall(event: { readonly id: string; readonly name: string; readonly args: Record<string, unknown> }): void {
    this.ensureBlankLine();
    console.log(theme.box('┌─ ') + theme.toolCall(`tool: ${event.name}`));
    if (event.name === 'shell_exec' && typeof event.args.command === 'string') {
      console.log(theme.box('│ ') + theme.toolCall(`$ ${event.args.command}`));
    } else {
      console.log(theme.box('│ ') + theme.dim(`args: ${JSON.stringify(event.args)}`));
    }
    console.log(theme.box('└─'));
  }

  /** Ask the user to approve a risky tool call. */
  async promptApproval(risk: string, reason: string): Promise<boolean> {
    this.ensureBlankLine();
    console.log(theme.approval(`Approval required [${risk}]`));
    console.log(theme.dim(reason));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await new Promise<string>((resolve) => {
        rl.question('Allow? [y/N] ', resolve);
      });
      return answer.trim().toLowerCase() === 'y';
    } finally {
      rl.close();
      process.stdin.resume();
    }
  }

  /** Show a tool result event. */
  showToolResult(event: {
    readonly id: string;
    readonly name: string;
    readonly status: ToolStatus;
    readonly output: string;
    readonly durationMs: number;
  }): void {
    const lines = event.output.split('\n');
    const visible = lines.slice(0, 30);
    const remaining = lines.length - visible.length;
    console.log(theme.box('┌─ ') + theme.toolResult(`${event.name}: ${event.status} (${event.durationMs}ms)`));
    for (const line of visible) {
      console.log(theme.box('│ ') + theme.toolResult(line));
    }
    if (remaining > 0) {
      console.log(theme.box('│ ') + theme.dim(`... ${remaining} more line(s)`));
    }
    console.log(theme.box('└─'));
  }

  /** Show an iteration separator. */
  showIteration(event: { readonly index: number; readonly maxIterations: number }): void {
    if (event.index > 1) {
      this.ensureBlankLine();
      console.log(theme.dim(`--- iteration ${event.index}/${event.maxIterations} ---`));
    }
  }

  /** Show an error. */
  showError(error: Error): void {
    this.ensureBlankLine();
    console.error(theme.error(`x ${error.message}`));
  }

  /** Show Ctrl+C interruption state. */
  showInterrupted(): void {
    this.ensureBlankLine();
    console.log(theme.warning('Interrupted. Press Ctrl+C again to exit.'));
  }

  /** Show startup banner. */
  showBanner(): void {
    console.log('');
    console.log(theme.heading('CSage'));
    console.log(theme.dim('AI Security Navigator'));
    console.log('');
  }

  private ensureBlankLine(): void {
    if (!this.lastWasNewline) {
      process.stdout.write('\n');
      this.lastWasNewline = true;
    }
  }
}
