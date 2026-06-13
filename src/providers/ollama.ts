/**
 * @module providers/ollama
 * LLM provider implementation for Ollama (local models).
 *
 * Ollama uses its own REST API with NDJSON streaming (not SSE),
 * and does not require authentication.
 */

import type { ProviderConfig } from '../types/config.js';
import type { ChatOptions, ChatResponse, StreamChunk, HealthStatus } from '../types/provider.js';
import type { LLMProvider } from './types.js';
import { handleProviderError } from './base.js';
import { fetchWithRetry } from '../utils/http.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'http://localhost:11434';

// ─── Response Types ──────────────────────────────────────────────────────────

interface OllamaChatResponse {
  readonly message: {
    readonly role: string;
    readonly content: string;
  };
  readonly model: string;
  readonly prompt_eval_count?: number;
  readonly eval_count?: number;
  readonly done: boolean;
}

interface OllamaStreamChunk {
  readonly message: {
    readonly role: string;
    readonly content: string;
  };
  readonly model: string;
  readonly done: boolean;
}

interface OllamaTagsResponse {
  readonly models: ReadonlyArray<{
    readonly name: string;
    readonly size: number;
    readonly digest: string;
    readonly modified_at: string;
  }>;
}

interface OllamaPullProgress {
  readonly status: string;
  readonly digest?: string;
  readonly total?: number;
  readonly completed?: number;
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * LLM provider for Ollama (locally-running models).
 *
 * Key differences from cloud providers:
 * - No authentication required
 * - Uses NDJSON streaming instead of SSE
 * - Endpoint is `/api/chat` instead of `/chat/completions`
 * - Supports model pulling and listing
 */
export class OllamaProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly type: 'cloud' | 'local';
  readonly supportsToolCalling = false;

  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.type = config.type;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.model = config.model;
  }

  /**
   * Send a chat request to Ollama's local API.
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
        stream: false,
        ...(options.temperature !== undefined && {
          options: { temperature: options.temperature },
        }),
      };

      const response = await fetchWithRetry(
        `${this.baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      const data = (await response.json()) as OllamaChatResponse;

      return {
        content: data.message.content,
        model: data.model,
        ...(data.prompt_eval_count !== undefined && data.eval_count !== undefined && {
          usage: {
            promptTokens: data.prompt_eval_count,
            completionTokens: data.eval_count,
          },
        }),
      };
    } catch (error) {
      handleProviderError(error, this.id);
    }
  }

  /**
   * Send a streaming chat request to Ollama.
   *
   * Ollama uses NDJSON (newline-delimited JSON) for streaming,
   * not Server-Sent Events. Each line is a complete JSON object.
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
        ...(options.temperature !== undefined && {
          options: { temperature: options.temperature },
        }),
      };

      const response = await fetchWithRetry(
        `${this.baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      for await (const line of this.parseNDJSON(response)) {
        try {
          const chunk = JSON.parse(line) as OllamaStreamChunk;

          if (chunk.done) {
            yield { type: 'done', content: '' };
            return;
          }

          if (chunk.message?.content) {
            yield { type: 'text', content: chunk.message.content };
          }
        } catch {
          // Skip malformed JSON lines
        }
      }

      yield { type: 'done', content: '' };
    } catch (error) {
      yield { type: 'error', content: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Check whether the Ollama server is reachable.
   *
   * Queries the `/api/tags` endpoint (model listing).
   *
   * @returns Health status with latency measurement.
   */
  async ping(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await fetchWithRetry(
        `${this.baseUrl}/api/tags`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
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
   * Parse a newline-delimited JSON (NDJSON) stream from a fetch response.
   *
   * Unlike SSE, NDJSON simply separates complete JSON objects with newlines.
   *
   * @param response - The fetch response with an NDJSON body.
   * @yields Each complete line from the stream.
   */
  private async *parseNDJSON(response: Response): AsyncGenerator<string> {
    const body = response.body;
    if (!body) {
      throw new Error('Response body is null — cannot parse NDJSON stream');
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          const trimmed = buffer.trim();
          if (trimmed.length > 0) {
            yield trimmed;
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.length > 0) {
            yield trimmed;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Build the messages array from chat options.
   *
   * Prepends the system prompt as a system message.
   */
  private buildMessages(
    options: ChatOptions,
  ): ReadonlyArray<{ readonly role: string; readonly content: string }> {
    return [
      { role: 'system', content: options.systemPrompt },
      ...options.messages.map((message) => ({
        role: message.role === 'tool' ? 'user' : message.role,
        content: message.role === 'tool'
          ? `Tool ${message.name} (${message.toolCallId}) result:\n${message.content}`
          : message.content,
      })),
    ];
  }
}

// ─── Ollama Helper Functions ─────────────────────────────────────────────────

/**
 * List all models available in the local Ollama instance.
 *
 * @param baseUrl - Ollama server URL (default: http://localhost:11434).
 * @returns Array of model names.
 */
export async function ollamaListModels(
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<readonly string[]> {
  const response = await fetchWithRetry(
    `${baseUrl}/api/tags`,
    {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    },
    { maxRetries: 1 },
  );

  const data = (await response.json()) as OllamaTagsResponse;
  return data.models.map((m) => m.name);
}

/**
 * Check whether the Ollama server is running and reachable.
 *
 * @param baseUrl - Ollama server URL (default: http://localhost:11434).
 * @returns `true` if Ollama is reachable, `false` otherwise.
 */
export async function ollamaIsRunning(
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<boolean> {
  try {
    await fetchWithRetry(
      `${baseUrl}/api/tags`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
      { maxRetries: 0 },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Pull a model from the Ollama registry.
 *
 * Streams progress updates as the model downloads.
 *
 * @param baseUrl - Ollama server URL (default: http://localhost:11434).
 * @param model - The model name to pull (e.g. "llama3.2").
 * @yields Progress updates with status and optional percentage.
 */
export async function* ollamaPullModel(
  baseUrl: string = DEFAULT_BASE_URL,
  model: string,
): AsyncGenerator<{ readonly status: string; readonly progress?: number }> {
  const response = await fetchWithRetry(
    `${baseUrl}/api/pull`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
    },
    { maxRetries: 0 },
  );

  const body = response.body;
  if (!body) {
    throw new Error('Response body is null — cannot stream pull progress');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        const trimmed = buffer.trim();
        if (trimmed.length > 0) {
          try {
            const chunk = JSON.parse(trimmed) as OllamaPullProgress;
            yield {
              status: chunk.status,
              progress: chunk.total && chunk.completed
                ? Math.round((chunk.completed / chunk.total) * 100)
                : undefined,
            };
          } catch {
            // Skip malformed JSON
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;

        try {
          const chunk = JSON.parse(trimmed) as OllamaPullProgress;
          yield {
            status: chunk.status,
            progress: chunk.total && chunk.completed
              ? Math.round((chunk.completed / chunk.total) * 100)
              : undefined,
          };
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Factory function to create an {@link OllamaProvider} instance.
 *
 * @param config - Provider configuration.
 * @returns A configured Ollama provider.
 */
export function createOllamaProvider(config: ProviderConfig): LLMProvider {
  return new OllamaProvider(config);
}
