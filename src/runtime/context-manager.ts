/**
 * @module runtime/context-manager
 * Conversation and token-estimate management for agent execution.
 */

import type { Message } from '../types/provider.js';

/** Maintains runtime conversation state and a lightweight token estimate. */
export class ContextManager {
  private messages: Message[] = [];
  private systemPrompt: string;
  private tokenEstimate: number;

  /**
   * Create a context manager.
   *
   * @param systemPrompt - Initial system prompt.
   */
  constructor(systemPrompt: string) {
    this.systemPrompt = systemPrompt;
    this.tokenEstimate = this.estimate(systemPrompt);
  }

  /**
   * Add a conversation message.
   *
   * @param msg - Message to append.
   */
  addMessage(msg: Message): void {
    this.messages.push(msg);
    this.tokenEstimate += this.estimateMessage(msg);
  }

  /** Get the current conversation messages. */
  getMessages(): readonly Message[] {
    return this.messages;
  }

  /** Get the current system prompt. */
  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  /** Get the approximate token count. */
  getTokenEstimate(): number {
    return this.tokenEstimate;
  }

  /** Clear conversation messages while preserving the system prompt. */
  clear(): void {
    this.messages = [];
    this.tokenEstimate = this.estimate(this.systemPrompt);
  }

  /**
   * Replace the system prompt.
   *
   * @param prompt - New system prompt.
   */
  setSystemPrompt(prompt: string): void {
    const messageTokens = this.messages.reduce(
      (total, message) => total + this.estimateMessage(message),
      0,
    );
    this.systemPrompt = prompt;
    this.tokenEstimate = this.estimate(prompt) + messageTokens;
  }

  private estimateMessage(message: Message): number {
    const extra = message.role === 'assistant' && message.toolCalls
      ? JSON.stringify(message.toolCalls).length
      : message.role === 'tool'
        ? message.toolCallId.length + message.name.length
        : 0;
    return this.estimate(message.content) + this.estimate(String(extra));
  }

  private estimate(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
