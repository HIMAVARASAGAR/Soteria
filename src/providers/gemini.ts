/**
 * @module providers/gemini
 * LLM provider implementation for Google's Gemini (Generative Language) API.
 *
 * SECURITY: API key is sent via `x-goog-api-key` header, NOT as a URL
 * query string parameter, to prevent key leakage in server logs and referer headers.
 */

import type { ProviderConfig } from '../types/config.js';
import type { ChatOptions, ChatResponse, StreamChunk, HealthStatus } from '../types/provider.js';
import type { LLMProvider } from './types.js';
import { parseSSEStream, handleProviderError } from './base.js';
import { fetchWithRetry } from '../utils/http.js';
import { randomUUID } from 'node:crypto';

// ─── Constants ───────────────────────────────────────────────────────────────

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta';

// ─── Response Types ──────────────────────────────────────────────────────────

interface GeminiContent {
  readonly role: string;
  readonly parts: ReadonlyArray<GeminiPart>;
}

interface GeminiPart {
  readonly text?: string;
  readonly functionCall?: {
    readonly name: string;
    readonly args?: unknown;
  };
  readonly functionResponse?: {
    readonly name: string;
    readonly response: Record<string, unknown>;
  };
}

interface GeminiGenerateResponse {
  readonly candidates: ReadonlyArray<{
    readonly content: {
      readonly parts: ReadonlyArray<GeminiPart>;
    };
  }>;
  readonly usageMetadata?: {
    readonly promptTokenCount: number;
    readonly candidatesTokenCount: number;
  };
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * LLM provider for Google Gemini (Generative Language API).
 *
 * Key differences from OpenAI-compatible providers:
 * - Uses `x-goog-api-key` header for authentication (NOT URL query param)
 * - Request body uses `contents` array with `parts` sub-arrays
 * - System prompt is a separate `systemInstruction` field
 * - Role mapping: 'assistant' → 'model'
 * - Streaming uses `streamGenerateContent?alt=sse`
 */
export class GeminiProvider implements LLMProvider {
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
    this.baseUrl = config.baseUrl ?? GEMINI_API_URL;
    this.apiKey = config.apiKey ?? '';
    this.model = config.model;
  }

  /**
   * Send a generateContent request to the Gemini API.
   *
   * @param options - Chat options with messages, system prompt, and generation params.
   * @returns The complete chat response.
   */
  async chat(options: ChatOptions): Promise<ChatResponse> {
    try {
      const body = this.buildRequestBody(options);

      const response = await fetchWithRetry(
        `${this.baseUrl}/models/${this.model}:generateContent`,
        {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify(body),
        },
      );

      const data = (await response.json()) as GeminiGenerateResponse;
      const content = data.candidates[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('') ?? '';
      const toolCalls = data.candidates[0]?.content?.parts
        ?.filter((part) => part.functionCall)
        .map((part) => ({
          id: randomUUID(),
          name: part.functionCall!.name,
          arguments: normalizeRecord(part.functionCall!.args),
        })) ?? [];

      return {
        content,
        model: this.model,
        ...(toolCalls.length > 0 && { toolCalls }),
        ...(data.usageMetadata && {
          usage: {
            promptTokens: data.usageMetadata.promptTokenCount,
            completionTokens: data.usageMetadata.candidatesTokenCount,
          },
        }),
      };
    } catch (error) {
      handleProviderError(error, this.id);
    }
  }

  /**
   * Send a streaming generateContent request to the Gemini API.
   *
   * Uses the `streamGenerateContent?alt=sse` endpoint which returns
   * Server-Sent Events with partial JSON responses.
   *
   * @param options - Chat options with messages, system prompt, and generation params.
   * @yields Stream chunks with text deltas and a final done marker.
   */
  async *stream(options: ChatOptions): AsyncGenerator<StreamChunk> {
    try {
      const body = this.buildRequestBody(options);

      const response = await fetchWithRetry(
        `${this.baseUrl}/models/${this.model}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify(body),
        },
      );

      for await (const data of parseSSEStream(response)) {
        try {
          const parsed = JSON.parse(data) as GeminiGenerateResponse;
          const text = parsed.candidates?.[0]?.content?.parts
            ?.map((p) => p.text ?? '')
            .join('');

          if (text) {
            yield { type: 'text', content: text };
          }

          const calls = parsed.candidates?.[0]?.content?.parts
            ?.filter((part) => part.functionCall) ?? [];
          for (const part of calls) {
            if (part.functionCall) {
              yield {
                type: 'tool_call',
                call: {
                  id: randomUUID(),
                  name: part.functionCall.name,
                  arguments: normalizeRecord(part.functionCall.args),
                },
              };
            }
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
   * Check whether the Gemini API is reachable.
   *
   * Queries the models list endpoint.
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
          headers: this.buildHeaders(),
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
   * Build Gemini-specific HTTP headers.
   *
   * SECURITY: Uses `x-goog-api-key` header for authentication
   * instead of URL query parameters to prevent key leakage.
   */
  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-goog-api-key': this.apiKey,
    };
  }

  /**
   * Build the Gemini API request body from chat options.
   *
   * Maps OpenAI-style roles to Gemini roles:
   * - 'user' → 'user'
   * - 'assistant' → 'model'
   *
   * System prompt is placed in the `systemInstruction` field.
   */
  private buildRequestBody(options: ChatOptions): Record<string, unknown> {
    const contents: GeminiContent[] = options.messages
      .filter((m) => m.role !== 'system')
      .map((message) => {
        if (message.role === 'tool') {
          return {
            role: 'function',
            parts: [
              {
                functionResponse: {
                  name: message.name,
                  response: { content: message.content },
                },
              },
            ],
          };
        }
        if (message.role === 'assistant' && message.toolCalls) {
          const parts: GeminiPart[] = [];
          if (message.content.length > 0) {
            parts.push({ text: message.content });
          }
          for (const call of message.toolCalls) {
            parts.push({ functionCall: { name: call.name, args: call.arguments } });
          }
          return { role: 'model', parts };
        }
        return {
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        };
      });

    return {
      contents,
      systemInstruction: {
        parts: [{ text: options.systemPrompt }],
      },
      generationConfig: {
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(options.maxTokens !== undefined && { maxOutputTokens: options.maxTokens }),
      },
      ...(options.tools && {
        tools: [
          {
            functionDeclarations: options.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            })),
          },
        ],
      }),
    };
  }
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * Factory function to create a {@link GeminiProvider} instance.
 *
 * @param config - Provider configuration.
 * @returns A configured Gemini provider.
 */
export function createGeminiProvider(config: ProviderConfig): LLMProvider {
  return new GeminiProvider(config);
}
