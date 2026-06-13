/**
 * @module providers/openai
 * LLM provider implementation for OpenAI-compatible APIs.
 *
 * Works with OpenAI, Groq, Together AI, Fireworks AI, Mistral, DeepSeek,
 * Perplexity, xAI, OpenRouter, and any other OpenAI-compatible endpoint.
 */

import type { ProviderConfig } from '../types/config.js';
import type {
  ChatOptions,
  ChatResponse,
  StreamChunk,
  HealthStatus,
  ToolCall,
} from '../types/provider.js';
import type { LLMProvider } from './types.js';
import { buildHeaders, parseSSEStream, handleProviderError } from './base.js';
import { fetchWithRetry } from '../utils/http.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

// ─── Response Types ──────────────────────────────────────────────────────────

interface OpenAIChatCompletion {
  readonly choices: ReadonlyArray<{
    readonly message: {
      readonly content: string | null;
      readonly tool_calls?: ReadonlyArray<OpenAIToolCall>;
    };
  }>;
  readonly model: string;
  readonly usage?: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
  };
}

interface OpenAIToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

interface OpenAIStreamDelta {
  readonly choices: ReadonlyArray<{
    readonly delta: {
      readonly content?: string;
      readonly tool_calls?: ReadonlyArray<{
        readonly index: number;
        readonly id?: string;
        readonly type?: 'function';
        readonly function?: {
          readonly name?: string;
          readonly arguments?: string;
        };
      }>;
    };
    readonly finish_reason: string | null;
  }>;
  readonly model?: string;
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * LLM provider for OpenAI-compatible chat completion APIs.
 *
 * Supports both synchronous and streaming modes. Designed to work with
 * any provider that speaks the OpenAI chat completions protocol.
 */
export class OpenAIProvider implements LLMProvider {
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
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = config.apiKey ?? '';
    this.model = config.model;
  }

  /**
   * Send a chat completion request and receive the full response.
   *
   * @param options - Chat options with messages, system prompt, and generation params.
   * @returns The complete chat response.
   */
  async chat(options: ChatOptions): Promise<ChatResponse> {
    try {
      const messages = this.buildMessages(options);
      const body = {
        model: this.model,
        messages,
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
        ...(options.tools && {
          tools: options.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
          tool_choice: options.toolChoice ?? 'auto',
        }),
      };

      const response = await fetchWithRetry(
        `${this.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: buildHeaders(this.apiKey),
          body: JSON.stringify(body),
        },
      );

      const data = (await response.json()) as OpenAIChatCompletion;
      const message = data.choices[0]?.message;
      const content = message?.content ?? '';
      const toolCalls = message?.tool_calls?.map((call) => this.normalizeToolCall(call)) ?? [];

      return {
        content,
        model: data.model,
        ...(toolCalls.length > 0 && { toolCalls }),
        ...(data.usage && {
          usage: {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
          },
        }),
      };
    } catch (error) {
      handleProviderError(error, this.id);
    }
  }

  /**
   * Send a streaming chat completion request.
   *
   * Yields incremental text chunks as they arrive from the API.
   *
   * @param options - Chat options with messages, system prompt, and generation params.
   * @yields Stream chunks with text deltas and a final done marker.
   */
  async *stream(options: ChatOptions): AsyncGenerator<StreamChunk> {
    try {
      const messages = this.buildMessages(options);
      const body = {
        model: this.model,
        messages,
        stream: true,
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
        ...(options.tools && {
          tools: options.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
          tool_choice: options.toolChoice ?? 'auto',
        }),
      };

      const response = await fetchWithRetry(
        `${this.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: buildHeaders(this.apiKey),
          body: JSON.stringify(body),
        },
      );

      const pendingToolCalls = new Map<number, { id: string; name: string; argumentsText: string }>();

      for await (const data of parseSSEStream(response)) {
        if (data === '[DONE]') {
          for (const call of pendingToolCalls.values()) {
            yield this.buildToolCallChunk(call.id, call.name, call.argumentsText);
          }
          yield { type: 'done', content: '' };
          return;
        }

        try {
          const parsed = JSON.parse(data) as OpenAIStreamDelta;
          const delta = parsed.choices[0]?.delta?.content;
          if (delta) {
            yield { type: 'text', content: delta };
          }

          const toolCallDeltas = parsed.choices[0]?.delta?.tool_calls ?? [];
          for (const toolCallDelta of toolCallDeltas) {
            const existing = pendingToolCalls.get(toolCallDelta.index) ?? {
              id: '',
              name: '',
              argumentsText: '',
            };
            pendingToolCalls.set(toolCallDelta.index, {
              id: toolCallDelta.id ?? existing.id,
              name: toolCallDelta.function?.name ?? existing.name,
              argumentsText: existing.argumentsText + (toolCallDelta.function?.arguments ?? ''),
            });
          }

          const finishReason = parsed.choices[0]?.finish_reason;
          if (finishReason === 'tool_calls' || finishReason === 'stop') {
            for (const call of pendingToolCalls.values()) {
              yield this.buildToolCallChunk(call.id, call.name, call.argumentsText);
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
   * Check whether the OpenAI-compatible API is reachable.
   *
   * @returns Health status with latency measurement.
   */
  async ping(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await fetchWithRetry(
        `${this.baseUrl}/models`,
        {
          method: 'GET',
          headers: buildHeaders(this.apiKey),
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
   * Build the messages array from chat options.
   *
   * Prepends the system prompt as a system message, followed
   * by the conversation messages.
   */
  private buildMessages(
    options: ChatOptions,
  ): ReadonlyArray<Record<string, unknown>> {
    return [
      { role: 'system', content: options.systemPrompt },
      ...options.messages.map((message) => {
        if (message.role === 'tool') {
          return {
            role: 'tool',
            tool_call_id: message.toolCallId,
            name: message.name,
            content: message.content,
          };
        }
        if (message.role === 'assistant' && message.toolCalls) {
          return {
            role: 'assistant',
            content: message.content,
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: 'function',
              function: {
                name: call.name,
                arguments: JSON.stringify(call.arguments),
              },
            })),
          };
        }
        return { role: message.role, content: message.content };
      }),
    ];
  }

  private normalizeToolCall(call: OpenAIToolCall): ToolCall {
    return {
      id: call.id,
      name: call.function.name,
      arguments: parseToolArguments(call.function.arguments),
    };
  }

  private buildToolCallChunk(
    id: string,
    name: string,
    argumentsText: string,
  ): StreamChunk {
    return {
      type: 'tool_call',
      call: {
        id,
        name,
        arguments: parseToolArguments(argumentsText),
      },
    };
  }
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to empty arguments for malformed provider payloads.
  }
  return {};
}

/**
 * Factory function to create an {@link OpenAIProvider} instance.
 *
 * @param config - Provider configuration.
 * @returns A configured OpenAI-compatible provider.
 */
export function createOpenAIProvider(config: ProviderConfig): LLMProvider {
  return new OpenAIProvider(config);
}
