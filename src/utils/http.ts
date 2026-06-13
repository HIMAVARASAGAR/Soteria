// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Configuration for the retry / timeout behaviour of {@link fetchWithRetry}.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3). */
  readonly maxRetries?: number;
  /** Request timeout in milliseconds (default: 30 000). */
  readonly timeoutMs?: number;
  /** Base delay in milliseconds for exponential backoff (default: 1000). */
  readonly baseDelayMs?: number;
}

/**
 * An HTTP error carrying the status code, status text, and response body.
 *
 * Thrown by {@link fetchWithRetry} when the response status is not OK and
 * the status code is not retryable, or when all retries have been exhausted.
 */
export class HttpError extends Error {
  /** HTTP status code. */
  readonly status: number;
  /** HTTP status text (e.g. "Not Found"). */
  readonly statusText: string;
  /** Response body (may be empty). */
  readonly body: string;

  constructor(status: number, statusText: string, body: string) {
    super(`HTTP ${status} ${statusText}`);
    this.name = 'HttpError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** HTTP status codes that are safe to retry automatically. */
const RETRYABLE_STATUS_CODES: ReadonlySet<number> = new Set([
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
]);

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_BASE_DELAY_MS = 1_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Sleep for the specified number of milliseconds.
 *
 * @param ms - Duration in milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute a jittered exponential backoff delay.
 *
 * Formula: `baseDelay * 2^attempt + random(0..baseDelay)`.
 *
 * @param attempt   - Zero-based attempt index.
 * @param baseDelay - Base delay in milliseconds.
 * @returns Delay in milliseconds.
 */
function backoffDelay(attempt: number, baseDelay: number): number {
  const exponential = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelay;
  return exponential + jitter;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Wrapper around the native `fetch` API that adds:
 *
 * - **Timeout** via `AbortController` (default 30 s)
 * - **Automatic retries** with exponential backoff + jitter
 * - **Selective retry** — only retries on 429, 500, 502, 503, 504
 * - **Structured errors** — throws {@link HttpError} on non-OK responses
 *
 * The caller-supplied `options.signal` is respected: if the caller aborts,
 * the request is cancelled immediately without further retries.
 *
 * @param url     - The URL to fetch.
 * @param options - Standard `RequestInit` options forwarded to `fetch`.
 * @param config  - Optional retry / timeout configuration.
 * @returns The successful `Response` object.
 * @throws {HttpError} On a non-retryable error status, or after all retries fail.
 * @throws {Error}     On network errors, timeouts, or caller-initiated aborts.
 *
 * @example
 * ```ts
 * const res = await fetchWithRetry('https://api.example.com/data', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ query: 'test' }),
 * });
 * const data = await res.json();
 * ```
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  config: RetryConfig = {},
): Promise<Response> {
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseDelayMs = config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  // Respect a caller-supplied abort signal
  const callerSignal = options.signal;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Create a per-attempt timeout controller
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

    // If the caller has their own signal, we need to abort on either
    const combinedController = new AbortController();

    const onCallerAbort = () => combinedController.abort();
    const onTimeoutAbort = () => combinedController.abort();

    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
    timeoutController.signal.addEventListener('abort', onTimeoutAbort, { once: true });

    try {
      const response = await fetch(url, {
        ...options,
        signal: combinedController.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return response;
      }

      // Non-OK response — decide whether to retry
      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < maxRetries) {
        const delay = backoffDelay(attempt, baseDelayMs);
        await sleep(delay);
        continue;
      }

      // Non-retryable status or final attempt — throw
      const body = await response.text().catch(() => '');
      throw new HttpError(response.status, response.statusText, body);
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      // Re-throw HttpError as-is (already handled above)
      if (error instanceof HttpError) {
        throw error;
      }

      // If the caller aborted, propagate immediately — do not retry
      if (callerSignal?.aborted) {
        throw new Error('Request aborted by caller');
      }

      lastError = error instanceof Error ? error : new Error(String(error));

      // Only retry on network/timeout errors, not on programming errors
      if (attempt < maxRetries) {
        const delay = backoffDelay(attempt, baseDelayMs);
        await sleep(delay);
        continue;
      }
    } finally {
      callerSignal?.removeEventListener('abort', onCallerAbort);
      timeoutController.signal.removeEventListener('abort', onTimeoutAbort);
    }
  }

  // All retries exhausted
  throw lastError ?? new Error(`fetchWithRetry failed after ${maxRetries + 1} attempts`);
}
