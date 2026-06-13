/**
 * @module providers/anthropic
 * LLM provider implementation for Anthropic's Messages API.
 *
 * Implements the Anthropic-specific wire format where the system prompt
 * is a top-level field rather than a message in the conversation array.
 */

import type { ProviderConfig } from '../types/config.js';
import type {
  ChatOptions,
  ChatResponse,
  StreamChunk,
  HealthStatus,
} from '../types/provider.js';
import type { LLMProvider } from './types.js';
import { parseSSEStream, handleProviderError } from './base.js';
import { fetchWithRetry } from '../utils/http.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;

// ─── Response Types ──────────────────────────────────────────────────────────

interface AnthropicMessage {
  readonly content: ReadonlyArray<AnthropicContentBlock>;
  readonly model: string;
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
  };
}

type AnthropicContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: unknown };

interface AnthropicStreamEvent {
  readonly type: string;
  readonly index?: number;
  readonly delta?: {
    readonly type?: string;
    readonly text?: string;
    readonly partial_json?: string;
  };
  readonly content_block?: {
    readonly type: string;
    readonly text?: string;
    readonly id?: string;
    readonly name?: string;
    readonly input?: unknown;
  };
  readonly message?: {
    readonly model: string;
    readonly usage: {
      readonly input_tokens: number;
      readonly output_tokens: number;
    };
  };
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * LLM provider for Anthropic's Messages API.
 *
 * Key differences from OpenAI-compatible providers:
 * - System prompt is a top-level `system` field, not a message
 * - Authentication uses `x-api-key` header instead of Bearer token
 * - Response format uses content blocks instead of a single string
 * - Streaming events use Anthropic-specific event types
 */
export class AnthropicProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly type: 'cloud' | 'local';
  readonly supportsToolCalling = true;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.type = config.type;
    this.baseUrl = config.baseUrl ?? ANTHROPIC_API_URL;
    this.apiKey = config.apiKey ?? '';
    this.model = config.model;
  }

  /**
   * Send a chat completion request to the Anthropic Messages API.
   *
   * The system prompt is sent as a top-level `system` field,
   * not as part of the messages array.
   *
   * @param options - Chat options with messages, system prompt, and generation params.
   * @returns The complete chat response.
   */
  async chat(options: ChatOptions): Promise<ChatResponse> {
    try {
      const body = {
        model: this.model,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: options.systemPrompt,
        messages: this.buildMessages(options),
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(options.tools && {
          tools: options.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters,
          })),
          tool_choice: options.toolChoice === 'required'
            ? { type: 'any' }
            : options.toolChoice === 'none'
              ? { type: 'none' }
              : { type: 'auto' },
        }),
      };

      const response = await fetchWithRetry(
        `${this.baseUrl}/messages`,
        {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify(body),
        },
      );

      const data = (await response.json()) as AnthropicMessage;
      const content = data.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
      const toolCalls = data.content
        .filter((block): block is Extract<AnthropicContentBlock, { readonly type: 'tool_use' }> => (
          block.type === 'tool_use'
        ))
        .map((block) => ({
          id: block.id,
          name: block.name,
          arguments: normalizeRecord(block.input),
        }));

      return {
        content,
        model: data.model,
        ...(toolCalls.length > 0 && { toolCalls }),
        usage: {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
        },
      };
    } catch (error) {
      handleProviderError(error, this.id);
    }
  }

  /**
   * Send a streaming chat completion request to Anthropic.
   *
   * Parses Anthropic-specific SSE events:
   * - `content_block_delta` — contains text fragments
   * - `message_stop` — signals the end of the stream
   *
   * @param options - Chat options with messages, system prompt, and generation params.
   * @yields Stream chunks with text deltas and a final done marker.
   */
  async *stream(options: ChatOptions): AsyncGenerator<StreamChunk> {
    try {
      const body = {
        model: this.model,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: options.systemPrompt,
        messages: this.buildMessages(options),
        stream: true,
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(options.tools && {
          tools: options.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters,
          })),
          tool_choice: options.toolChoice === 'required'
            ? { type: 'any' }
            : options.toolChoice === 'none'
              ? { type: 'none' }
              : { type: 'auto' },
        }),
      };

      const response = await fetchWithRetry(
        `${this.baseUrl}/messages`,
        {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify(body),
        },
      );

      const pendingToolCalls = new Map<number, { id: string; name: string; argumentsText: string }>();

      for await (const data of parseSSEStream(response)) {
        try {
          const event = JSON.parse(data) as AnthropicStreamEvent;

          if (event.type === 'content_block_delta' && event.delta?.text) {
            yield { type: 'text', content: event.delta.text };
          } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            pendingToolCalls.set(event.index ?? pendingToolCalls.size, {
              id: event.content_block.id ?? '',
              name: event.content_block.name ?? '',
              argumentsText: '',
            });
          } else if (event.type === 'content_block_delta' && event.delta?.partial_json) {
            const index = event.index ?? 0;
            const existing = pendingToolCalls.get(index) ?? { id: '', name: '', argumentsText: '' };
            pendingToolCalls.set(index, {
              ...existing,
              argumentsText: existing.argumentsText + event.delta.partial_json,
            });
          } else if (event.type === 'message_stop') {
            for (const call of pendingToolCalls.values()) {
              yield {
                type: 'tool_call',
                call: {
                  id: call.id,
                  name: call.name,
                  arguments: parseToolArguments(call.argumentsText),
                },
              };
            }
            yield { type: 'done', content: '' };
            return;
          }
        } catch {
          // Skip malformed JSON chunks
        }
      }

      yield { type: 'done', content: '' };
    } catch (error) {
      yield { type: 'error', content: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Check whether the Anthropic API is reachable.
   *
   * Sends a minimal chat request with `max_tokens: 1` since Anthropic
   * does not have a dedicated health/models endpoint.
   *
   * @returns Health status with latency measurement.
   */
  async ping(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const body = {
        model: this.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      };

      await fetchWithRetry(
        `${this.baseUrl}/messages`,
        {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify(body),
        },
        { maxRetries: 1 },
      );

      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Build Anthropic-specific HTTP headers.
   *
   * Uses `x-api-key` for authentication and includes the required
   * `anthropic-version` header.
   */
  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    };
  }

  /**
   * Build the messages array from chat options.
   *
   * Filters out system messages since Anthropic uses a top-level
   * `system` field instead.
   */
  private buildMessages(
    options: ChatOptions,
  ): ReadonlyArray<Record<string, unknown>> {
    return options.messages
      .filter((m) => m.role !== 'system')
      .map((message) => {
        if (message.role === 'tool') {
          return {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: message.toolCallId,
                content: message.content,
              },
            ],
          };
        }
        if (message.role === 'assistant' && message.toolCalls) {
          const contentBlocks: Record<string, unknown>[] = [];
          if (message.content.length > 0) {
            contentBlocks.push({ type: 'text', text: message.content });
          }
          for (const call of message.toolCalls) {
            contentBlocks.push({
              type: 'tool_use',
              id: call.id,
              name: call.name,
              input: call.arguments,
            });
          }
          return { role: 'assistant', content: contentBlocks };
        }
        return {
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.content,
        };
      });
  }
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    return normalizeRecord(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

/**
 * Factory function to create an {@link AnthropicProvider} instance.
 *
 * @param config - Provider configuration.
 * @returns A configured Anthropic provider.
 */
export function createAnthropicProvider(config: ProviderConfig): LLMProvider {
  return new AnthropicProvider(config);
}
