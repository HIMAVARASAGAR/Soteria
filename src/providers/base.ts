/**
 * @module providers/base
 * Shared utilities for LLM provider implementations.
 *
 * Provides header construction, SSE stream parsing, and error normalization
 * used across all provider implementations.
 */

// ─── Headers ─────────────────────────────────────────────────────────────────

/**
 * Build a standard set of HTTP headers for provider API calls.
 *
 * Always includes `Content-Type: application/json`. Adds an
 * `Authorization: Bearer` header if an API key is provided.
 *
 * @param apiKey - Optional API key for Bearer authentication.
 * @param extraHeaders - Additional headers to merge in.
 * @returns A record of header name → value pairs.
 */
export function buildHeaders(
  apiKey?: string,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      headers[key] = value;
    }
  }

  return headers;
}

// ─── SSE Stream Parsing ──────────────────────────────────────────────────────

/**
 * Parse a Server-Sent Events (SSE) stream from a fetch response body.
 *
 * Yields the `data:` field content for each SSE event. Handles multiline
 * data fields and ignores comment lines (starting with `:`).
 *
 * @param response - The fetch `Response` whose body is an SSE stream.
 * @yields Each `data:` payload as a string.
 * @throws {Error} If the response body is null.
 */
export async function* parseSSEStream(response: Response): AsyncGenerator<string> {
  const body = response.body;
  if (!body) {
    throw new Error('Response body is null — cannot parse SSE stream');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Process any remaining data in the buffer
        if (buffer.trim().length > 0) {
          const lines = buffer.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data:')) {
              const data = trimmed.slice(5).trim();
              if (data.length > 0) {
                yield data;
              }
            }
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines (events are separated by double newlines)
      const parts = buffer.split('\n');
      // Keep the last potentially-incomplete line in the buffer
      buffer = parts.pop() ?? '';

      for (const line of parts) {
        const trimmed = line.trim();

        // Skip empty lines and comments
        if (trimmed.length === 0 || trimmed.startsWith(':')) {
          continue;
        }

        if (trimmed.startsWith('data:')) {
          const data = trimmed.slice(5).trim();
          if (data.length > 0) {
            yield data;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Error Handling ──────────────────────────────────────────────────────────

/**
 * Error class for provider-specific failures.
 *
 * Wraps any underlying error with the provider ID for context.
 */
export class ProviderError extends Error {
  /** The provider that encountered the error. */
  readonly providerId: string;
  /** The original error that was caught. */
  readonly cause: unknown;

  constructor(message: string, providerId: string, cause?: unknown) {
    super(message);
    this.name = 'ProviderError';
    this.providerId = providerId;
    this.cause = cause;
  }
}

/**
 * Normalize and rethrow an error with provider context.
 *
 * Wraps any caught error into a {@link ProviderError} that includes
 * the provider ID for easier debugging.
 *
 * @param error - The caught error (unknown type).
 * @param providerId - The provider that encountered the error.
 * @throws {ProviderError} Always — this function never returns.
 */
export function handleProviderError(error: unknown, providerId: string): never {
  if (error instanceof ProviderError) {
    throw error;
  }

  const message =
    error instanceof Error
      ? `[${providerId}] ${error.message}`
      : `[${providerId}] Unknown error: ${String(error)}`;

  throw new ProviderError(message, providerId, error);
}
