#!/usr/bin/env node

// src/cli/ui/theme.ts
import chalk from "chalk";
var theme = {
  /** CSage Violet — primary brand accent. */
  brand: chalk.hex("#af5fff"),
  /** Green — success indicators. */
  success: chalk.green,
  /** Red — error messages. */
  error: chalk.red,
  /** Yellow — warning messages. */
  warning: chalk.yellow,
  /** Cyan — informational messages. */
  info: chalk.cyan,
  /** Gray — de-emphasised text. */
  dim: chalk.gray,
  /** Bold — structural emphasis. */
  bold: chalk.bold,
  /** Bold Violet — section headings. */
  heading: chalk.bold.hex("#af5fff"),
  /** REPL prompt color. */
  prompt: chalk.bold.hex("#af5fff"),
  /** Tool-call accent. */
  toolCall: chalk.hex("#ffd700"),
  /** Tool-result accent. */
  toolResult: chalk.gray,
  /** Slash-command accent. */
  slash: chalk.cyan,
  /** Box border color. */
  box: chalk.hex("#555555"),
  /** Thinking text color. */
  thinking: chalk.hex("#888888").italic,
  /** Approval prompt accent. */
  approval: chalk.hex("#ff8c00").bold,
  /** Colors keyed by finding severity level. */
  severity: {
    CRITICAL: chalk.red.bold,
    HIGH: chalk.hex("#ff8c00").bold,
    // orange
    MEDIUM: chalk.yellow,
    LOW: chalk.blue,
    INFO: chalk.cyan
  },
  /** Colors keyed by command risk level. */
  risk: {
    LOW: chalk.green,
    MEDIUM: chalk.yellow,
    HIGH: chalk.hex("#ff8c00")
  }
};

// src/storage/config.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// src/types/config.ts
import { z } from "zod";
var AppConfigSchema = z.object({
  /** Absolute path to the CSage configuration directory. */
  configDir: z.string().min(1),
  /** Semantic version of the running application. */
  version: z.string().min(1)
});
var ProviderProtocolSchema = z.enum([
  "openai",
  "anthropic",
  "gemini",
  "ollama"
]);
var ProviderTypeSchema = z.enum(["cloud", "local"]);
var ProviderConfigSchema = z.object({
  /** Unique identifier for this provider entry. */
  id: z.string().min(1),
  /** Human-readable display name. */
  name: z.string().min(1),
  /** Whether the provider is cloud-hosted or local. */
  type: ProviderTypeSchema,
  /** Model identifier (e.g. "gpt-4o", "claude-sonnet-4-20250514"). */
  model: z.string().min(1),
  /** API key for authentication (cloud providers). */
  apiKey: z.string().min(1).optional(),
  /** Base URL override (e.g. for proxies or local endpoints). */
  baseUrl: z.string().url().optional(),
  /** Wire protocol used to communicate with this provider. */
  protocol: ProviderProtocolSchema
});
var PlatformInstallCommandsSchema = z.object({
  /** Install command for Linux (e.g. `apt install nmap`). */
  linux: z.string().optional(),
  /** Install command for macOS (e.g. `brew install nmap`). */
  mac: z.string().optional(),
  /** Install command for Windows (e.g. `choco install nmap`). */
  win: z.string().optional()
});
var ToolConfigSchema = z.object({
  /** Canonical tool name (e.g. "nmap", "sqlmap"). */
  name: z.string().min(1),
  /** Install commands keyed by platform. */
  installCommands: PlatformInstallCommandsSchema,
  /** URL pointing to the tool's official documentation. */
  documentationUrl: z.string().url()
});

// src/storage/config.ts
var CONFIG_DIR_NAME = ".csage";
var CONFIG_FILE_NAME = "config.json";
function getConfigDir() {
  const dir = join(homedir(), CONFIG_DIR_NAME);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
function loadProviderConfig() {
  const filePath = join(getConfigDir(), CONFIG_FILE_NAME);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const result = ProviderConfigSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    return null;
  } catch {
    return null;
  }
}
function saveProviderConfig(config) {
  const dir = getConfigDir();
  const filePath = join(dir, CONFIG_FILE_NAME);
  const json = JSON.stringify(config, null, 2) + "\n";
  writeFileSync(filePath, json, { encoding: "utf-8", mode: 384 });
}
function resetConfig() {
  const filePath = join(getConfigDir(), CONFIG_FILE_NAME);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

// src/storage/keychain.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "fs";
import { join as join2 } from "path";
var ENV_FILE_NAME = ".env";
function toEnvKey(provider) {
  return `${provider.toUpperCase()}_API_KEY`;
}
function envFilePath() {
  return join2(getConfigDir(), ENV_FILE_NAME);
}
function readEnvLines() {
  const filePath = envFilePath();
  if (!existsSync2(filePath)) {
    return [];
  }
  return readFileSync2(filePath, "utf-8").split("\n");
}
function writeEnvLines(lines) {
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  const content = lines.join("\n") + "\n";
  writeFileSync2(envFilePath(), content, { encoding: "utf-8", mode: 384 });
}
function maskKey(key) {
  if (key.length < 10) {
    return "****";
  }
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
function saveApiKey(provider, key) {
  const envKey = toEnvKey(provider);
  const lines = readEnvLines();
  let found = false;
  const updated = lines.map((line) => {
    if (line.startsWith(`${envKey}=`)) {
      found = true;
      return `${envKey}=${key}`;
    }
    return line;
  });
  if (!found) {
    updated.push(`${envKey}=${key}`);
  }
  writeEnvLines(updated);
}
function loadApiKey(provider) {
  const envKey = toEnvKey(provider);
  for (const line of readEnvLines()) {
    if (line.startsWith(`${envKey}=`)) {
      const value = line.slice(envKey.length + 1).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}
function removeApiKey(provider) {
  const envKey = toEnvKey(provider);
  const lines = readEnvLines();
  const filtered = lines.filter((line) => !line.startsWith(`${envKey}=`));
  writeEnvLines(filtered);
}
function listApiKeys() {
  const results = [];
  const suffix = "_API_KEY=";
  for (const line of readEnvLines()) {
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;
    const rawKey = line.slice(0, eqIndex);
    if (!rawKey.endsWith("_API_KEY")) continue;
    const value = line.slice(eqIndex + 1).trim();
    if (value.length === 0) continue;
    const provider = rawKey.slice(0, rawKey.length - suffix.length + 1).toLowerCase();
    results.push({ provider, maskedKey: maskKey(value) });
  }
  return results;
}

// src/providers/base.ts
function buildHeaders(apiKey, extraHeaders) {
  const headers = {
    "Content-Type": "application/json"
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      headers[key] = value;
    }
  }
  return headers;
}
async function* parseSSEStream(response) {
  const body = response.body;
  if (!body) {
    throw new Error("Response body is null \u2014 cannot parse SSE stream");
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim().length > 0) {
          const lines = buffer.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data:")) {
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
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith(":")) {
          continue;
        }
        if (trimmed.startsWith("data:")) {
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
var ProviderError = class extends Error {
  /** The provider that encountered the error. */
  providerId;
  /** The original error that was caught. */
  cause;
  constructor(message, providerId, cause) {
    super(message);
    this.name = "ProviderError";
    this.providerId = providerId;
    this.cause = cause;
  }
};
function handleProviderError(error, providerId) {
  if (error instanceof ProviderError) {
    throw error;
  }
  const message = error instanceof Error ? `[${providerId}] ${error.message}` : `[${providerId}] Unknown error: ${String(error)}`;
  throw new ProviderError(message, providerId, error);
}

// src/utils/http.ts
var HttpError = class extends Error {
  /** HTTP status code. */
  status;
  /** HTTP status text (e.g. "Not Found"). */
  statusText;
  /** Response body (may be empty). */
  body;
  constructor(status, statusText, body) {
    super(`HTTP ${status} ${statusText}`);
    this.name = "HttpError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
};
var RETRYABLE_STATUS_CODES = /* @__PURE__ */ new Set([
  429,
  // Too Many Requests
  500,
  // Internal Server Error
  502,
  // Bad Gateway
  503,
  // Service Unavailable
  504
  // Gateway Timeout
]);
var DEFAULT_MAX_RETRIES = 3;
var DEFAULT_TIMEOUT_MS = 3e4;
var DEFAULT_BASE_DELAY_MS = 1e3;
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function backoffDelay(attempt, baseDelay) {
  const exponential = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelay;
  return exponential + jitter;
}
async function fetchWithRetry(url, options = {}, config = {}) {
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseDelayMs = config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const callerSignal = options.signal;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
    const combinedController = new AbortController();
    const onCallerAbort = () => combinedController.abort();
    const onTimeoutAbort = () => combinedController.abort();
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    timeoutController.signal.addEventListener("abort", onTimeoutAbort, { once: true });
    try {
      const response = await fetch(url, {
        ...options,
        signal: combinedController.signal
      });
      clearTimeout(timeoutId);
      if (response.ok) {
        return response;
      }
      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < maxRetries) {
        const delay = backoffDelay(attempt, baseDelayMs);
        await sleep(delay);
        continue;
      }
      const body = await response.text().catch(() => "");
      throw new HttpError(response.status, response.statusText, body);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof HttpError) {
        throw error;
      }
      if (callerSignal?.aborted) {
        throw new Error("Request aborted by caller");
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        const delay = backoffDelay(attempt, baseDelayMs);
        await sleep(delay);
        continue;
      }
    } finally {
      callerSignal?.removeEventListener("abort", onCallerAbort);
      timeoutController.signal.removeEventListener("abort", onTimeoutAbort);
    }
  }
  throw lastError ?? new Error(`fetchWithRetry failed after ${maxRetries + 1} attempts`);
}

// src/providers/openai.ts
var DEFAULT_BASE_URL = "https://api.openai.com/v1";
var OpenAIProvider = class {
  id;
  name;
  type;
  supportsToolCalling = true;
  baseUrl;
  apiKey;
  model;
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.type = config.type;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = config.apiKey ?? "";
    this.model = config.model;
  }
  /**
   * Send a chat completion request and receive the full response.
   *
   * @param options - Chat options with messages, system prompt, and generation params.
   * @returns The complete chat response.
   */
  async chat(options) {
    try {
      const messages = this.buildMessages(options);
      const body = {
        model: this.model,
        messages,
        ...options.temperature !== void 0 && { temperature: options.temperature },
        ...options.maxTokens !== void 0 && { max_tokens: options.maxTokens },
        ...options.tools && {
          tools: options.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters
            }
          })),
          tool_choice: options.toolChoice ?? "auto"
        }
      };
      const response = await fetchWithRetry(
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: buildHeaders(this.apiKey),
          body: JSON.stringify(body)
        }
      );
      const data = await response.json();
      const message = data.choices[0]?.message;
      const content = message?.content ?? "";
      const toolCalls = message?.tool_calls?.map((call) => this.normalizeToolCall(call)) ?? [];
      return {
        content,
        model: data.model,
        ...toolCalls.length > 0 && { toolCalls },
        ...data.usage && {
          usage: {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens
          }
        }
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
  async *stream(options) {
    try {
      const messages = this.buildMessages(options);
      const body = {
        model: this.model,
        messages,
        stream: true,
        ...options.temperature !== void 0 && { temperature: options.temperature },
        ...options.maxTokens !== void 0 && { max_tokens: options.maxTokens },
        ...options.tools && {
          tools: options.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters
            }
          })),
          tool_choice: options.toolChoice ?? "auto"
        }
      };
      const response = await fetchWithRetry(
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: buildHeaders(this.apiKey),
          body: JSON.stringify(body)
        }
      );
      const pendingToolCalls = /* @__PURE__ */ new Map();
      for await (const data of parseSSEStream(response)) {
        if (data === "[DONE]") {
          for (const call of pendingToolCalls.values()) {
            yield this.buildToolCallChunk(call.id, call.name, call.argumentsText);
          }
          yield { type: "done", content: "" };
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices[0]?.delta?.content;
          if (delta) {
            yield { type: "text", content: delta };
          }
          const toolCallDeltas = parsed.choices[0]?.delta?.tool_calls ?? [];
          for (const toolCallDelta of toolCallDeltas) {
            const existing = pendingToolCalls.get(toolCallDelta.index) ?? {
              id: "",
              name: "",
              argumentsText: ""
            };
            pendingToolCalls.set(toolCallDelta.index, {
              id: toolCallDelta.id ?? existing.id,
              name: toolCallDelta.function?.name ?? existing.name,
              argumentsText: existing.argumentsText + (toolCallDelta.function?.arguments ?? "")
            });
          }
          const finishReason = parsed.choices[0]?.finish_reason;
          if (finishReason === "tool_calls" || finishReason === "stop") {
            for (const call of pendingToolCalls.values()) {
              yield this.buildToolCallChunk(call.id, call.name, call.argumentsText);
            }
            yield { type: "done", content: "" };
            return;
          }
        } catch {
        }
      }
      yield { type: "done", content: "" };
    } catch (error) {
      yield { type: "error", content: error instanceof Error ? error.message : String(error) };
    }
  }
  /**
   * Check whether the OpenAI-compatible API is reachable.
   *
   * @returns Health status with latency measurement.
   */
  async ping() {
    const start = Date.now();
    try {
      await fetchWithRetry(
        `${this.baseUrl}/models`,
        {
          method: "GET",
          headers: buildHeaders(this.apiKey)
        },
        { maxRetries: 1 }
      );
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  /**
   * Build the messages array from chat options.
   *
   * Prepends the system prompt as a system message, followed
   * by the conversation messages.
   */
  buildMessages(options) {
    return [
      { role: "system", content: options.systemPrompt },
      ...options.messages.map((message) => {
        if (message.role === "tool") {
          return {
            role: "tool",
            tool_call_id: message.toolCallId,
            name: message.name,
            content: message.content
          };
        }
        if (message.role === "assistant" && message.toolCalls) {
          return {
            role: "assistant",
            content: message.content,
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.arguments)
              }
            }))
          };
        }
        return { role: message.role, content: message.content };
      })
    ];
  }
  normalizeToolCall(call) {
    return {
      id: call.id,
      name: call.function.name,
      arguments: parseToolArguments(call.function.arguments)
    };
  }
  buildToolCallChunk(id, name, argumentsText) {
    return {
      type: "tool_call",
      call: {
        id,
        name,
        arguments: parseToolArguments(argumentsText)
      }
    };
  }
};
function parseToolArguments(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
  }
  return {};
}
function createOpenAIProvider(config) {
  return new OpenAIProvider(config);
}

// src/providers/anthropic.ts
var ANTHROPIC_API_URL = "https://api.anthropic.com/v1";
var ANTHROPIC_VERSION = "2023-06-01";
var DEFAULT_MAX_TOKENS = 4096;
var AnthropicProvider = class {
  id;
  name;
  type;
  supportsToolCalling = true;
  baseUrl;
  apiKey;
  model;
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.type = config.type;
    this.baseUrl = config.baseUrl ?? ANTHROPIC_API_URL;
    this.apiKey = config.apiKey ?? "";
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
  async chat(options) {
    try {
      const body = {
        model: this.model,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: options.systemPrompt,
        messages: this.buildMessages(options),
        ...options.temperature !== void 0 && { temperature: options.temperature },
        ...options.tools && {
          tools: options.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters
          })),
          tool_choice: options.toolChoice === "required" ? { type: "any" } : options.toolChoice === "none" ? { type: "none" } : { type: "auto" }
        }
      };
      const response = await fetchWithRetry(
        `${this.baseUrl}/messages`,
        {
          method: "POST",
          headers: this.buildHeaders(),
          body: JSON.stringify(body)
        }
      );
      const data = await response.json();
      const content = data.content.filter((block) => block.type === "text").map((block) => block.text).join("");
      const toolCalls = data.content.filter((block) => block.type === "tool_use").map((block) => ({
        id: block.id,
        name: block.name,
        arguments: normalizeRecord(block.input)
      }));
      return {
        content,
        model: data.model,
        ...toolCalls.length > 0 && { toolCalls },
        usage: {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens
        }
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
  async *stream(options) {
    try {
      const body = {
        model: this.model,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: options.systemPrompt,
        messages: this.buildMessages(options),
        stream: true,
        ...options.temperature !== void 0 && { temperature: options.temperature },
        ...options.tools && {
          tools: options.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters
          })),
          tool_choice: options.toolChoice === "required" ? { type: "any" } : options.toolChoice === "none" ? { type: "none" } : { type: "auto" }
        }
      };
      const response = await fetchWithRetry(
        `${this.baseUrl}/messages`,
        {
          method: "POST",
          headers: this.buildHeaders(),
          body: JSON.stringify(body)
        }
      );
      const pendingToolCalls = /* @__PURE__ */ new Map();
      for await (const data of parseSSEStream(response)) {
        try {
          const event = JSON.parse(data);
          if (event.type === "content_block_delta" && event.delta?.text) {
            yield { type: "text", content: event.delta.text };
          } else if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
            pendingToolCalls.set(event.index ?? pendingToolCalls.size, {
              id: event.content_block.id ?? "",
              name: event.content_block.name ?? "",
              argumentsText: ""
            });
          } else if (event.type === "content_block_delta" && event.delta?.partial_json) {
            const index = event.index ?? 0;
            const existing = pendingToolCalls.get(index) ?? { id: "", name: "", argumentsText: "" };
            pendingToolCalls.set(index, {
              ...existing,
              argumentsText: existing.argumentsText + event.delta.partial_json
            });
          } else if (event.type === "message_stop") {
            for (const call of pendingToolCalls.values()) {
              yield {
                type: "tool_call",
                call: {
                  id: call.id,
                  name: call.name,
                  arguments: parseToolArguments2(call.argumentsText)
                }
              };
            }
            yield { type: "done", content: "" };
            return;
          }
        } catch {
        }
      }
      yield { type: "done", content: "" };
    } catch (error) {
      yield { type: "error", content: error instanceof Error ? error.message : String(error) };
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
  async ping() {
    const start = Date.now();
    try {
      const body = {
        model: this.model,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }]
      };
      await fetchWithRetry(
        `${this.baseUrl}/messages`,
        {
          method: "POST",
          headers: this.buildHeaders(),
          body: JSON.stringify(body)
        },
        { maxRetries: 1 }
      );
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  /**
   * Build Anthropic-specific HTTP headers.
   *
   * Uses `x-api-key` for authentication and includes the required
   * `anthropic-version` header.
   */
  buildHeaders() {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": ANTHROPIC_VERSION
    };
  }
  /**
   * Build the messages array from chat options.
   *
   * Filters out system messages since Anthropic uses a top-level
   * `system` field instead.
   */
  buildMessages(options) {
    return options.messages.filter((m) => m.role !== "system").map((message) => {
      if (message.role === "tool") {
        return {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: message.toolCallId,
              content: message.content
            }
          ]
        };
      }
      if (message.role === "assistant" && message.toolCalls) {
        const contentBlocks = [];
        if (message.content.length > 0) {
          contentBlocks.push({ type: "text", text: message.content });
        }
        for (const call of message.toolCalls) {
          contentBlocks.push({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.arguments
          });
        }
        return { role: "assistant", content: contentBlocks };
      }
      return {
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content
      };
    });
  }
};
function normalizeRecord(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return {};
}
function parseToolArguments2(raw) {
  try {
    return normalizeRecord(JSON.parse(raw));
  } catch {
    return {};
  }
}
function createAnthropicProvider(config) {
  return new AnthropicProvider(config);
}

// src/providers/gemini.ts
import { randomUUID } from "crypto";
var GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta";
var GeminiProvider = class {
  id;
  name;
  type;
  supportsToolCalling = true;
  baseUrl;
  apiKey;
  model;
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.type = config.type;
    this.baseUrl = config.baseUrl ?? GEMINI_API_URL;
    this.apiKey = config.apiKey ?? "";
    this.model = config.model;
  }
  /**
   * Send a generateContent request to the Gemini API.
   *
   * @param options - Chat options with messages, system prompt, and generation params.
   * @returns The complete chat response.
   */
  async chat(options) {
    try {
      const body = this.buildRequestBody(options);
      const response = await fetchWithRetry(
        `${this.baseUrl}/models/${this.model}:generateContent`,
        {
          method: "POST",
          headers: this.buildHeaders(),
          body: JSON.stringify(body)
        }
      );
      const data = await response.json();
      const content = data.candidates[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      const toolCalls = data.candidates[0]?.content?.parts?.filter((part) => part.functionCall).map((part) => ({
        id: randomUUID(),
        name: part.functionCall.name,
        arguments: normalizeRecord2(part.functionCall.args)
      })) ?? [];
      return {
        content,
        model: this.model,
        ...toolCalls.length > 0 && { toolCalls },
        ...data.usageMetadata && {
          usage: {
            promptTokens: data.usageMetadata.promptTokenCount,
            completionTokens: data.usageMetadata.candidatesTokenCount
          }
        }
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
  async *stream(options) {
    try {
      const body = this.buildRequestBody(options);
      const response = await fetchWithRetry(
        `${this.baseUrl}/models/${this.model}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: this.buildHeaders(),
          body: JSON.stringify(body)
        }
      );
      for await (const data of parseSSEStream(response)) {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
          if (text) {
            yield { type: "text", content: text };
          }
          const calls = parsed.candidates?.[0]?.content?.parts?.filter((part) => part.functionCall) ?? [];
          for (const part of calls) {
            if (part.functionCall) {
              yield {
                type: "tool_call",
                call: {
                  id: randomUUID(),
                  name: part.functionCall.name,
                  arguments: normalizeRecord2(part.functionCall.args)
                }
              };
            }
          }
        } catch {
        }
      }
      yield { type: "done", content: "" };
    } catch (error) {
      yield { type: "error", content: error instanceof Error ? error.message : String(error) };
    }
  }
  /**
   * Check whether the Gemini API is reachable.
   *
   * Queries the models list endpoint.
   *
   * @returns Health status with latency measurement.
   */
  async ping() {
    const start = Date.now();
    try {
      await fetchWithRetry(
        `${this.baseUrl}/models`,
        {
          method: "GET",
          headers: this.buildHeaders()
        },
        { maxRetries: 1 }
      );
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  /**
   * Build Gemini-specific HTTP headers.
   *
   * SECURITY: Uses `x-goog-api-key` header for authentication
   * instead of URL query parameters to prevent key leakage.
   */
  buildHeaders() {
    return {
      "Content-Type": "application/json",
      "x-goog-api-key": this.apiKey
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
  buildRequestBody(options) {
    const contents = options.messages.filter((m) => m.role !== "system").map((message) => {
      if (message.role === "tool") {
        return {
          role: "function",
          parts: [
            {
              functionResponse: {
                name: message.name,
                response: { content: message.content }
              }
            }
          ]
        };
      }
      if (message.role === "assistant" && message.toolCalls) {
        const parts = [];
        if (message.content.length > 0) {
          parts.push({ text: message.content });
        }
        for (const call of message.toolCalls) {
          parts.push({ functionCall: { name: call.name, args: call.arguments } });
        }
        return { role: "model", parts };
      }
      return {
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }]
      };
    });
    return {
      contents,
      systemInstruction: {
        parts: [{ text: options.systemPrompt }]
      },
      generationConfig: {
        ...options.temperature !== void 0 && { temperature: options.temperature },
        ...options.maxTokens !== void 0 && { maxOutputTokens: options.maxTokens }
      },
      ...options.tools && {
        tools: [
          {
            functionDeclarations: options.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters
            }))
          }
        ]
      }
    };
  }
};
function normalizeRecord2(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return {};
}
function createGeminiProvider(config) {
  return new GeminiProvider(config);
}

// src/providers/ollama.ts
var DEFAULT_BASE_URL2 = "http://localhost:11434";
var OllamaProvider = class {
  id;
  name;
  type;
  supportsToolCalling = false;
  baseUrl;
  model;
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.type = config.type;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL2;
    this.model = config.model;
  }
  /**
   * Send a chat request to Ollama's local API.
   *
   * @param options - Chat options with messages, system prompt, and generation params.
   * @returns The complete chat response.
   */
  async chat(options) {
    try {
      const messages = this.buildMessages(options);
      const body = {
        model: this.model,
        messages,
        stream: false,
        ...options.temperature !== void 0 && {
          options: { temperature: options.temperature }
        }
      };
      const response = await fetchWithRetry(
        `${this.baseUrl}/api/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }
      );
      const data = await response.json();
      return {
        content: data.message.content,
        model: data.model,
        ...data.prompt_eval_count !== void 0 && data.eval_count !== void 0 && {
          usage: {
            promptTokens: data.prompt_eval_count,
            completionTokens: data.eval_count
          }
        }
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
  async *stream(options) {
    try {
      const messages = this.buildMessages(options);
      const body = {
        model: this.model,
        messages,
        stream: true,
        ...options.temperature !== void 0 && {
          options: { temperature: options.temperature }
        }
      };
      const response = await fetchWithRetry(
        `${this.baseUrl}/api/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }
      );
      for await (const line of this.parseNDJSON(response)) {
        try {
          const chunk = JSON.parse(line);
          if (chunk.done) {
            yield { type: "done", content: "" };
            return;
          }
          if (chunk.message?.content) {
            yield { type: "text", content: chunk.message.content };
          }
        } catch {
        }
      }
      yield { type: "done", content: "" };
    } catch (error) {
      yield { type: "error", content: error instanceof Error ? error.message : String(error) };
    }
  }
  /**
   * Check whether the Ollama server is reachable.
   *
   * Queries the `/api/tags` endpoint (model listing).
   *
   * @returns Health status with latency measurement.
   */
  async ping() {
    const start = Date.now();
    try {
      await fetchWithRetry(
        `${this.baseUrl}/api/tags`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" }
        },
        { maxRetries: 1 }
      );
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error)
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
  async *parseNDJSON(response) {
    const body = response.body;
    if (!body) {
      throw new Error("Response body is null \u2014 cannot parse NDJSON stream");
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
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
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
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
  buildMessages(options) {
    return [
      { role: "system", content: options.systemPrompt },
      ...options.messages.map((message) => ({
        role: message.role === "tool" ? "user" : message.role,
        content: message.role === "tool" ? `Tool ${message.name} (${message.toolCallId}) result:
${message.content}` : message.content
      }))
    ];
  }
};
function createOllamaProvider(config) {
  return new OllamaProvider(config);
}

// src/providers/registry.ts
var registry = /* @__PURE__ */ new Map();
function registerProvider(id, factory, definition) {
  if (registry.has(id)) {
    throw new Error(`Provider "${id}" is already registered`);
  }
  registry.set(id, { factory, definition });
}
function createProvider(config) {
  const entry = registry.get(config.id);
  if (!entry) {
    throw new Error(
      `No provider registered with ID "${config.id}". Available: ${[...registry.keys()].join(", ")}`
    );
  }
  return entry.factory(config);
}
function listCloudProviders() {
  return [...registry.values()].map((entry) => entry.definition).filter((def) => def.type === "cloud");
}
function listLocalProviders() {
  return [...registry.values()].map((entry) => entry.definition).filter((def) => def.type === "local");
}
function registerAllProviders() {
  registerProvider("openai", createOpenAIProvider, {
    id: "openai",
    name: "OpenAI",
    type: "cloud",
    keyEnvVar: "OPENAI_API_KEY",
    keyUrl: "https://platform.openai.com/api-keys",
    defaultModel: "gpt-4o",
    suggestedModels: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o3-mini"],
    protocol: "openai"
  });
  registerProvider("anthropic", createAnthropicProvider, {
    id: "anthropic",
    name: "Anthropic",
    type: "cloud",
    keyEnvVar: "ANTHROPIC_API_KEY",
    keyUrl: "https://console.anthropic.com/settings/keys",
    defaultModel: "claude-sonnet-4-20250514",
    suggestedModels: [
      "claude-sonnet-4-20250514",
      "claude-opus-4-20250514",
      "claude-3-5-haiku-20241022"
    ],
    protocol: "anthropic"
  });
  registerProvider("gemini", createGeminiProvider, {
    id: "gemini",
    name: "Google Gemini",
    type: "cloud",
    keyEnvVar: "GEMINI_API_KEY",
    keyUrl: "https://aistudio.google.com/app/apikey",
    defaultModel: "gemini-2.5-flash",
    suggestedModels: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    protocol: "gemini"
  });
  registerProvider("groq", createOpenAIProvider, {
    id: "groq",
    name: "Groq",
    type: "cloud",
    keyEnvVar: "GROQ_API_KEY",
    keyUrl: "https://console.groq.com/keys",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    suggestedModels: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "mixtral-8x7b-32768"
    ],
    protocol: "openai"
  });
  registerProvider("together", createOpenAIProvider, {
    id: "together",
    name: "Together AI",
    type: "cloud",
    keyEnvVar: "TOGETHER_API_KEY",
    keyUrl: "https://api.together.xyz/settings/api-keys",
    baseUrl: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
    suggestedModels: [
      "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
      "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
      "mistralai/Mixtral-8x7B-Instruct-v0.1"
    ],
    protocol: "openai"
  });
  registerProvider("fireworks", createOpenAIProvider, {
    id: "fireworks",
    name: "Fireworks AI",
    type: "cloud",
    keyEnvVar: "FIREWORKS_API_KEY",
    keyUrl: "https://fireworks.ai/account/api-keys",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    defaultModel: "accounts/fireworks/models/llama-v3p1-70b-instruct",
    suggestedModels: [
      "accounts/fireworks/models/llama-v3p1-70b-instruct",
      "accounts/fireworks/models/llama-v3p1-8b-instruct",
      "accounts/fireworks/models/mixtral-8x7b-instruct"
    ],
    protocol: "openai"
  });
  registerProvider("mistral", createOpenAIProvider, {
    id: "mistral",
    name: "Mistral AI",
    type: "cloud",
    keyEnvVar: "MISTRAL_API_KEY",
    keyUrl: "https://console.mistral.ai/api-keys",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
    suggestedModels: [
      "mistral-large-latest",
      "mistral-medium-latest",
      "mistral-small-latest"
    ],
    protocol: "openai"
  });
  registerProvider("deepseek", createOpenAIProvider, {
    id: "deepseek",
    name: "DeepSeek",
    type: "cloud",
    keyEnvVar: "DEEPSEEK_API_KEY",
    keyUrl: "https://platform.deepseek.com/api_keys",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    suggestedModels: ["deepseek-chat", "deepseek-coder", "deepseek-reasoner"],
    protocol: "openai"
  });
  registerProvider("perplexity", createOpenAIProvider, {
    id: "perplexity",
    name: "Perplexity",
    type: "cloud",
    keyEnvVar: "PERPLEXITY_API_KEY",
    keyUrl: "https://www.perplexity.ai/settings/api",
    baseUrl: "https://api.perplexity.ai",
    defaultModel: "sonar-pro",
    suggestedModels: ["sonar-pro", "sonar", "sonar-reasoning"],
    protocol: "openai"
  });
  registerProvider("xai", createOpenAIProvider, {
    id: "xai",
    name: "xAI",
    type: "cloud",
    keyEnvVar: "XAI_API_KEY",
    keyUrl: "https://console.x.ai",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-3-mini",
    suggestedModels: ["grok-3-mini", "grok-3", "grok-2"],
    protocol: "openai"
  });
  registerProvider("openrouter", createOpenAIProvider, {
    id: "openrouter",
    name: "OpenRouter",
    type: "cloud",
    keyEnvVar: "OPENROUTER_API_KEY",
    keyUrl: "https://openrouter.ai/keys",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-sonnet-4-20250514",
    suggestedModels: [
      "anthropic/claude-sonnet-4-20250514",
      "openai/gpt-4o",
      "google/gemini-2.5-flash",
      "meta-llama/llama-3.1-70b-instruct"
    ],
    protocol: "openai"
  });
  registerProvider("ollama", createOllamaProvider, {
    id: "ollama",
    name: "Ollama",
    type: "local",
    baseUrl: "http://localhost:11434",
    defaultModel: "llama3.2",
    suggestedModels: [
      "llama3.2",
      "llama3.1",
      "mistral",
      "codellama",
      "deepseek-coder-v2"
    ],
    protocol: "ollama"
  });
}
registerAllProviders();

// src/tools/classifier.ts
var SAFE_INSTALL_PREFIXES = [
  "brew install",
  "brew reinstall",
  "brew upgrade",
  "apt-get install",
  "apt install",
  "sudo apt-get install",
  "sudo apt install",
  "pip install",
  "pip3 install",
  "python3 -m pip install",
  "python -m pip install",
  "go install",
  "cargo install",
  "npm install -g",
  "winget install",
  "choco install",
  "scoop install",
  "ollama pull",
  "ollama serve",
  "ollama list",
  "ollama run"
];
var SAFE_SUBCOMMANDS = [
  "install",
  "pull",
  "serve",
  "list",
  "version",
  "--version",
  "-v",
  "--help",
  "-h"
];
var PENTEST_TOOLS = [
  "nmap",
  "nikto",
  "sqlmap",
  "gobuster",
  "ffuf",
  "wfuzz",
  "hydra",
  "curl",
  "wget",
  "dirb",
  "dirsearch",
  "sslyze",
  "testssl"
];
var SHELL_OPERATORS = [
  "|",
  "&&",
  "||",
  ";",
  ">",
  ">>",
  "<",
  "`",
  "$("
];
var DESTRUCTIVE = [
  "rm ",
  "del ",
  "format ",
  "mkfs",
  "dd if=",
  ":(){",
  "fork"
];
var PACKAGE_MANAGERS = /* @__PURE__ */ new Set([
  "apt",
  "apt-get",
  "brew",
  "pip",
  "pip3",
  "npm",
  "go",
  "cargo",
  "winget",
  "choco",
  "scoop",
  "ollama",
  "python",
  "python3",
  "sudo"
]);
function safeTokenize(command) {
  const tokens = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && !inSingle) {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if ((ch === " " || ch === "	") && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (escaped) {
    return {
      ok: false,
      tokens: [],
      error: "Trailing backslash with no character to escape."
    };
  }
  if (inSingle) {
    return {
      ok: false,
      tokens: [],
      error: "Unclosed single quote (') \u2014 check for unmatched quotes."
    };
  }
  if (inDouble) {
    return {
      ok: false,
      tokens: [],
      error: 'Unclosed double quote (") \u2014 check for unmatched quotes.'
    };
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return { ok: true, tokens };
}
function classify(command) {
  const cmd = command.trim();
  if (cmd.length === 0) {
    return { safe: false, risk: "HIGH", reason: "Empty command" };
  }
  for (const op of SHELL_OPERATORS) {
    if (cmd.includes(op)) {
      return {
        safe: false,
        risk: "HIGH",
        reason: `Contains shell operator '${op}' \u2014 potential injection vector`
      };
    }
  }
  const cmdLower = cmd.toLowerCase();
  for (const pattern of DESTRUCTIVE) {
    if (cmdLower.includes(pattern)) {
      return {
        safe: false,
        risk: "HIGH",
        reason: `Contains destructive pattern '${pattern.trim()}'`
      };
    }
  }
  for (const prefix of SAFE_INSTALL_PREFIXES) {
    if (cmdLower.startsWith(prefix)) {
      return {
        safe: true,
        risk: "LOW",
        reason: `Matches safe install prefix '${prefix}'`
      };
    }
  }
  const tokenResult = safeTokenize(cmd);
  if (!tokenResult.ok || tokenResult.tokens.length === 0) {
    return {
      safe: false,
      risk: "MEDIUM",
      reason: `Cannot parse command: ${tokenResult.error ?? "unknown error"}`
    };
  }
  const first = tokenResult.tokens[0].toLowerCase().replace(/^\.\//, "");
  const sub = tokenResult.tokens.length > 1 ? tokenResult.tokens[1].toLowerCase() : void 0;
  if (PACKAGE_MANAGERS.has(first)) {
    if (first === "sudo" && sub !== void 0) {
      const actualBin = sub;
      const actualSub = tokenResult.tokens.length > 2 ? tokenResult.tokens[2].toLowerCase() : void 0;
      if (PACKAGE_MANAGERS.has(actualBin) && actualSub !== void 0) {
        const subSet = new Set(SAFE_SUBCOMMANDS);
        if (subSet.has(actualSub)) {
          return {
            safe: true,
            risk: "LOW",
            reason: `'sudo ${actualBin} ${actualSub}' is a safe setup command`
          };
        }
      }
      return {
        safe: false,
        risk: "MEDIUM",
        reason: `'sudo ${sub ?? ""}' \u2014 sub-command not in the safe list`
      };
    }
    if (sub !== void 0) {
      const subSet = new Set(SAFE_SUBCOMMANDS);
      if (subSet.has(sub)) {
        return {
          safe: true,
          risk: "LOW",
          reason: `'${first} ${sub}' is a safe setup command`
        };
      }
    }
    return {
      safe: false,
      risk: "MEDIUM",
      reason: `'${first}' is a package manager but '${sub ?? "(none)"}' is not a safe sub-command`
    };
  }
  const pentestSet = new Set(PENTEST_TOOLS);
  if (pentestSet.has(first)) {
    return {
      safe: false,
      risk: "HIGH",
      reason: `'${first}' is a security testing tool \u2014 must be run manually`
    };
  }
  return {
    safe: false,
    risk: "MEDIUM",
    reason: `'${first}' is not a recognised setup/install command \u2014 run manually`
  };
}

// src/tools/executor.ts
import { spawn } from "child_process";
import { access, constants } from "fs/promises";
import { join as join3 } from "path";
import { platform as osPlatform } from "os";
async function resolveExecutable(name) {
  const pathEnv = process.env["PATH"] ?? "";
  const delimiter = osPlatform() === "win32" ? ";" : ":";
  const dirs = pathEnv.split(delimiter).filter(Boolean);
  const isWin = osPlatform() === "win32";
  const extensions = isWin && !/\.\w+$/.test(name) ? [".exe", ".cmd", ".bat", ".com"] : [""];
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = join3(dir, `${name}${ext}`);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
      }
    }
  }
  return void 0;
}
async function isToolInstalled(name) {
  const resolved = await resolveExecutable(name);
  return resolved !== void 0;
}
var DEFAULT_TIMEOUT_MS2 = 3e5;
async function executeCommand(command, options) {
  const { timeout = DEFAULT_TIMEOUT_MS2, cwd, env } = options ?? {};
  const tokenResult = safeTokenize(command);
  if (!tokenResult.ok || tokenResult.tokens.length === 0) {
    return {
      command,
      allowed: true,
      ran: false,
      success: false,
      stdout: "",
      stderr: "",
      error: `Tokenisation failed: ${tokenResult.error ?? "empty command"}`,
      reason: tokenResult.error
    };
  }
  const [program, ...args] = tokenResult.tokens;
  return new Promise((resolve) => {
    let stdoutBuf = "";
    let stderrBuf = "";
    let timedOut = false;
    let settled = false;
    const mergedEnv = {
      ...process.env,
      ...env ?? {}
    };
    const child = spawn(program, args, {
      cwd,
      env: mergedEnv,
      stdio: ["ignore", "pipe", "pipe"]
      // shell is intentionally omitted (defaults to false)
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);
    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({
        command,
        allowed: true,
        ran: false,
        success: false,
        stdout: stdoutBuf,
        stderr: stderrBuf,
        error: err.code === "ENOENT" ? `Command not found: ${program}` : `Spawn error: ${err.message}`
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (timedOut) {
        resolve({
          command,
          allowed: true,
          ran: true,
          success: false,
          stdout: stdoutBuf,
          stderr: stderrBuf,
          error: `Command timed out after ${timeout}ms`
        });
        return;
      }
      resolve({
        command,
        allowed: true,
        ran: true,
        success: code === 0,
        stdout: stdoutBuf,
        stderr: stderrBuf,
        error: code !== 0 ? `Process exited with code ${code ?? "null"}` : void 0
      });
    });
  });
}

export {
  theme,
  getConfigDir,
  loadProviderConfig,
  saveProviderConfig,
  resetConfig,
  saveApiKey,
  loadApiKey,
  removeApiKey,
  listApiKeys,
  createProvider,
  listCloudProviders,
  listLocalProviders,
  classify,
  isToolInstalled,
  executeCommand
};
//# sourceMappingURL=chunk-M7XSJMYQ.js.map