#!/usr/bin/env node
import {
  classify,
  createProvider,
  executeCommand,
  loadApiKey,
  loadProviderConfig,
  theme
} from "./chunk-M7XSJMYQ.js";

// src/cli/repl.ts
import readline2 from "readline";
import prompts from "prompts";

// src/runtime/events.ts
var EventBus = class {
  handlers = [];
  /**
   * Register an event handler.
   *
   * @param handler - Handler to invoke for future events.
   * @returns Unsubscribe function.
   */
  on(handler) {
    this.handlers.push(handler);
    return () => {
      const index = this.handlers.indexOf(handler);
      if (index >= 0) {
        this.handlers.splice(index, 1);
      }
    };
  }
  /**
   * Emit an event to all handlers sequentially.
   *
   * Handler failures are isolated and do not abort later handlers.
   *
   * @param event - Runtime event.
   */
  async emit(event) {
    for (const handler of this.handlers) {
      try {
        await handler(event);
      } catch {
      }
    }
  }
  /** Remove all registered handlers. */
  removeAll() {
    this.handlers.splice(0, this.handlers.length);
  }
};

// src/runtime/history.ts
var ToolHistory = class {
  executions = [];
  /**
   * Record a new execution.
   *
   * @param exec - Execution entry.
   */
  record(exec) {
    this.executions.push(exec);
  }
  /**
   * Patch an existing execution by id.
   *
   * @param id - Internal execution id.
   * @param patch - Partial entry update.
   */
  update(id, patch) {
    const index = this.executions.findIndex((exec) => exec.id === id);
    if (index < 0) {
      return;
    }
    this.executions[index] = { ...this.executions[index], ...patch };
  }
  /** Get every recorded execution. */
  getAll() {
    return this.executions;
  }
  /**
   * Get executions for a tool.
   *
   * @param name - Tool name.
   */
  getByTool(name) {
    return this.executions.filter((exec) => exec.name === name);
  }
  /**
   * Get executions from one runtime iteration.
   *
   * @param index - Iteration index.
   */
  getByIteration(index) {
    return this.executions.filter((exec) => exec.iterationIndex === index);
  }
};

// src/runtime/context-manager.ts
var ContextManager = class {
  messages = [];
  systemPrompt;
  tokenEstimate;
  /**
   * Create a context manager.
   *
   * @param systemPrompt - Initial system prompt.
   */
  constructor(systemPrompt) {
    this.systemPrompt = systemPrompt;
    this.tokenEstimate = this.estimate(systemPrompt);
  }
  /**
   * Add a conversation message.
   *
   * @param msg - Message to append.
   */
  addMessage(msg) {
    this.messages.push(msg);
    this.tokenEstimate += this.estimateMessage(msg);
  }
  /** Get the current conversation messages. */
  getMessages() {
    return this.messages;
  }
  /** Get the current system prompt. */
  getSystemPrompt() {
    return this.systemPrompt;
  }
  /** Get the approximate token count. */
  getTokenEstimate() {
    return this.tokenEstimate;
  }
  /** Clear conversation messages while preserving the system prompt. */
  clear() {
    this.messages = [];
    this.tokenEstimate = this.estimate(this.systemPrompt);
  }
  /**
   * Replace the system prompt.
   *
   * @param prompt - New system prompt.
   */
  setSystemPrompt(prompt) {
    const messageTokens = this.messages.reduce(
      (total, message) => total + this.estimateMessage(message),
      0
    );
    this.systemPrompt = prompt;
    this.tokenEstimate = this.estimate(prompt) + messageTokens;
  }
  estimateMessage(message) {
    const extra = message.role === "assistant" && message.toolCalls ? JSON.stringify(message.toolCalls).length : message.role === "tool" ? message.toolCallId.length + message.name.length : 0;
    return this.estimate(message.content) + this.estimate(String(extra));
  }
  estimate(text) {
    return Math.ceil(text.length / 4);
  }
};

// src/runtime/loop.ts
import { randomUUID } from "crypto";
var DEFAULT_RESOURCE_BUDGET = {
  maxIterations: 25,
  maxToolCalls: 50,
  maxExecutionTimeMs: 6e5,
  maxTokenBudget: 2e5
};
var ExecutionLoop = class {
  /**
   * Create an execution loop.
   *
   * @param provider - LLM provider.
   * @param contextManager - Runtime context manager.
   * @param toolRouter - Tool router.
   * @param approvalPolicy - Approval policy.
   * @param history - Tool history.
   * @param events - Runtime event bus.
   * @param budget - Resource budget.
   * @param tools - Tool definitions exposed to the provider.
   */
  constructor(provider, contextManager, toolRouter, approvalPolicy, history, events, budget, tools) {
    this.provider = provider;
    this.contextManager = contextManager;
    this.toolRouter = toolRouter;
    this.approvalPolicy = approvalPolicy;
    this.history = history;
    this.events = events;
    this.budget = budget;
    this.tools = tools;
  }
  provider;
  contextManager;
  toolRouter;
  approvalPolicy;
  history;
  events;
  budget;
  tools;
  /**
   * Execute the autonomous loop.
   *
   * @param signal - Abort signal.
   */
  async execute(signal) {
    let iteration = 0;
    let totalToolCalls = 0;
    const startTime = Date.now();
    while (iteration < this.budget.maxIterations && totalToolCalls < this.budget.maxToolCalls && Date.now() - startTime < this.budget.maxExecutionTimeMs && this.contextManager.getTokenEstimate() < this.budget.maxTokenBudget && !signal.aborted) {
      iteration += 1;
      await this.events.emit({
        type: "iteration",
        index: iteration,
        maxIterations: this.budget.maxIterations
      });
      if (signal.aborted) {
        await this.events.emit({ type: "done", reason: "cancelled" });
        return;
      }
      const textParts = [];
      const pendingCalls = [];
      try {
        const stream = this.provider.stream({
          systemPrompt: this.contextManager.getSystemPrompt(),
          messages: [...this.contextManager.getMessages()],
          tools: this.provider.supportsToolCalling ? this.tools : void 0,
          toolChoice: this.provider.supportsToolCalling ? "auto" : "none"
        });
        for await (const chunk of stream) {
          if (signal.aborted) {
            await this.events.emit({ type: "done", reason: "cancelled" });
            return;
          }
          if (chunk.type === "text") {
            textParts.push(chunk.content);
            await this.events.emit({ type: "text", content: chunk.content });
          } else if (chunk.type === "tool_call") {
            pendingCalls.push(chunk.call);
          } else if (chunk.type === "error") {
            await this.events.emit({
              type: "error",
              error: new Error(chunk.content),
              recoverable: false
            });
            await this.events.emit({ type: "done", reason: "error" });
            return;
          } else if (chunk.type === "done") {
            break;
          }
        }
      } catch (error) {
        await this.events.emit({
          type: "error",
          error: error instanceof Error ? error : new Error(String(error)),
          recoverable: false
        });
        await this.events.emit({ type: "done", reason: "error" });
        return;
      }
      if (signal.aborted) {
        await this.events.emit({ type: "done", reason: "cancelled" });
        return;
      }
      const content = textParts.join("");
      this.contextManager.addMessage({
        role: "assistant",
        content,
        ...pendingCalls.length > 0 && { toolCalls: pendingCalls }
      });
      if (pendingCalls.length === 0) {
        await this.events.emit({ type: "done", reason: "complete" });
        return;
      }
      for (const call of pendingCalls) {
        if (signal.aborted) {
          await this.events.emit({ type: "done", reason: "cancelled" });
          return;
        }
        if (totalToolCalls >= this.budget.maxToolCalls) {
          await this.events.emit({ type: "done", reason: "budget_exhausted" });
          return;
        }
        const routedCall = call.id.length > 0 ? call : { ...call, id: randomUUID() };
        const result = await this.toolRouter.route(
          routedCall,
          this.approvalPolicy,
          this.history,
          this.events,
          signal,
          iteration
        );
        this.contextManager.addMessage({
          role: "tool",
          toolCallId: routedCall.id,
          name: routedCall.name,
          content: result.output
        });
        totalToolCalls += 1;
      }
    }
    if (signal.aborted) {
      await this.events.emit({ type: "done", reason: "cancelled" });
      return;
    }
    if (iteration >= this.budget.maxIterations) {
      await this.events.emit({ type: "done", reason: "max_iterations" });
      return;
    }
    await this.events.emit({ type: "done", reason: "budget_exhausted" });
  }
};

// src/runtime/tool-router.ts
import { randomUUID as randomUUID2 } from "crypto";
var ToolRouter = class {
  handlers = /* @__PURE__ */ new Map();
  /**
   * Register a handler.
   *
   * @param name - Tool name.
   * @param handler - Tool handler.
   */
  register(name, handler) {
    this.handlers.set(name, handler);
  }
  /**
   * Check whether a handler is registered.
   *
   * @param name - Tool name.
   */
  has(name) {
    return this.handlers.has(name);
  }
  /**
   * Route a tool call through approval, execution, history, and events.
   *
   * @param call - Normalized tool call.
   * @param policy - Approval policy.
   * @param history - Tool history.
   * @param events - Runtime events.
   * @param signal - Abort signal.
   * @param iterationIndex - Current loop iteration index.
   */
  async route(call, policy, history, events, signal, iterationIndex) {
    const execId = randomUUID2();
    const pending = {
      id: execId,
      callId: call.id,
      name: call.name,
      arguments: call.arguments,
      status: "pending",
      iterationIndex
    };
    history.record(pending);
    const deny = async (reason, durationMs = 0) => {
      history.update(execId, {
        status: "denied",
        error: reason,
        completedAt: /* @__PURE__ */ new Date(),
        durationMs
      });
      await events.emit({
        type: "tool_result",
        id: call.id,
        name: call.name,
        status: "denied",
        output: reason,
        durationMs
      });
      return { output: reason, success: false };
    };
    const decision = policy.check(call);
    if (decision.action === "deny") {
      return deny(decision.reason);
    }
    if (decision.action === "ask") {
      const approved = await policy.requestApproval(call, decision.risk, decision.reason);
      if (!approved) {
        return deny(`Denied: ${decision.reason}`);
      }
    }
    history.update(execId, { status: "approved" });
    if (signal.aborted) {
      return this.cancel(call, history, events, execId);
    }
    const startedAt = /* @__PURE__ */ new Date();
    history.update(execId, { status: "running", startedAt });
    await events.emit({
      type: "tool_call",
      id: call.id,
      name: call.name,
      args: call.arguments
    });
    const handler = this.handlers.get(call.name);
    if (!handler) {
      return this.fail(call, history, events, execId, startedAt, `Unknown tool: ${call.name}`);
    }
    try {
      const result = await handler(call.arguments);
      const durationMs = Date.now() - startedAt.getTime();
      const status = result.success ? "success" : "failed";
      history.update(execId, {
        status: result.success ? "completed" : "failed",
        output: result.output,
        completedAt: /* @__PURE__ */ new Date(),
        durationMs,
        metadata: result.metadata
      });
      await events.emit({
        type: "tool_result",
        id: call.id,
        name: call.name,
        status,
        output: result.output,
        durationMs
      });
      return { output: result.output, success: result.success };
    } catch (error) {
      return this.fail(
        call,
        history,
        events,
        execId,
        startedAt,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  async cancel(call, history, events, execId) {
    const output = "Cancelled";
    history.update(execId, {
      status: "cancelled",
      output,
      completedAt: /* @__PURE__ */ new Date(),
      durationMs: 0
    });
    await events.emit({
      type: "tool_result",
      id: call.id,
      name: call.name,
      status: "cancelled",
      output,
      durationMs: 0
    });
    return { output, success: false };
  }
  async fail(call, history, events, execId, startedAt, output) {
    const durationMs = Date.now() - startedAt.getTime();
    history.update(execId, {
      status: "failed",
      error: output,
      output,
      completedAt: /* @__PURE__ */ new Date(),
      durationMs
    });
    await events.emit({
      type: "tool_result",
      id: call.id,
      name: call.name,
      status: "failed",
      output,
      durationMs
    });
    return { output, success: false };
  }
};

// src/runtime/runtime.ts
var AgentRuntime = class {
  /**
   * Create an agent runtime.
   *
   * @param config - Runtime configuration.
   */
  constructor(config) {
    this.config = config;
    this.events = new EventBus();
    this.history = new ToolHistory();
    this.contextManager = new ContextManager(config.systemPrompt);
    this.toolRouter = new ToolRouter();
    this.abortController = new AbortController();
    for (const [name, handler] of config.toolHandlers) {
      this.toolRouter.register(name, handler);
    }
    this.loop = this.createLoop();
    this.config.logger?.info("AGENT_RUNTIME_CREATED");
  }
  config;
  /** Public event bus for renderer/UI subscribers. */
  events;
  loop;
  history;
  contextManager;
  toolRouter;
  abortController;
  /**
   * Run the runtime with a new user message.
   *
   * @param userMessage - User message.
   */
  async run(userMessage) {
    this.contextManager.addMessage({ role: "user", content: userMessage });
    this.abortController = new AbortController();
    await this.loop.execute(this.abortController.signal);
  }
  /** Cancel the active run. */
  cancel() {
    this.abortController.abort();
  }
  /** Get recorded tool history. */
  getHistory() {
    return this.history.getAll();
  }
  /** Get conversation messages. */
  getConversation() {
    return this.contextManager.getMessages();
  }
  /** Reset conversation and tool history. */
  reset() {
    this.contextManager.clear();
    this.history = new ToolHistory();
    this.loop = this.createLoop();
  }
  createLoop() {
    return new ExecutionLoop(
      this.config.provider,
      this.contextManager,
      this.toolRouter,
      this.config.approvalPolicy,
      this.history,
      this.events,
      { ...DEFAULT_RESOURCE_BUDGET, ...this.config.budget },
      this.config.tools
    );
  }
};

// src/runtime/approval.ts
var SecurityApprovalPolicy = class {
  /**
   * Create a security approval policy.
   *
   * @param classifier - Command classifier function.
   * @param promptFn - User approval prompt function.
   */
  constructor(classifier, promptFn) {
    this.classifier = classifier;
    this.promptFn = promptFn;
  }
  classifier;
  promptFn;
  check(call) {
    if (call.name !== "shell_exec") {
      return { action: "allow" };
    }
    const command = typeof call.arguments.command === "string" ? call.arguments.command : "";
    const result = this.classifier(command);
    if (result.safe) {
      return { action: "allow" };
    }
    if (result.risk === "HIGH") {
      return { action: "ask", risk: "HIGH", reason: result.reason };
    }
    return { action: "ask", risk: result.risk, reason: result.reason };
  }
  requestApproval(call, risk, reason) {
    return this.promptFn(call, risk, reason);
  }
};

// src/core/context.ts
import { readdirSync, readFileSync, lstatSync, existsSync } from "fs";
import { join, basename } from "path";
var IGNORED_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
  ".idea",
  ".vscode",
  "target",
  ".gradle"
]);
var DEFAULT_MAX_DEPTH = 4;
var MAX_TREE_CHARS = 3e3;
var MAX_FILE_CHARS = 1500;
var TECH_MARKERS = [
  ["Node.js", "package.json"],
  ["Python", "requirements.txt"],
  ["Python (Poetry)", "pyproject.toml"],
  ["Python (Pipenv)", "Pipfile"],
  ["Java (Maven)", "pom.xml"],
  ["Java (Gradle)", "build.gradle"],
  ["Go", "go.mod"],
  ["Rust", "Cargo.toml"],
  ["Ruby", "Gemfile"],
  ["PHP (Composer)", "composer.json"],
  [".NET", "*.csproj"],
  // handled specially below
  ["Docker", "Dockerfile"],
  ["Docker Compose", "docker-compose.yml"],
  ["Terraform", "main.tf"],
  ["Kubernetes", "k8s"],
  ["Next.js", "next.config.js"],
  ["Next.js", "next.config.mjs"],
  ["Next.js", "next.config.ts"],
  ["React", "vite.config.ts"],
  ["Angular", "angular.json"],
  ["Vue", "vue.config.js"],
  ["Svelte", "svelte.config.js"]
];
var INTERESTING_FILES = [
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "Pipfile",
  "pom.xml",
  "build.gradle",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  "composer.json",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  ".env.example",
  ".eslintrc.json",
  "tsconfig.json",
  "nginx.conf",
  "webpack.config.js",
  ".github/workflows/ci.yml",
  ".github/workflows/deploy.yml"
];
var SECRET_VALUE_RE = /(?:password|secret|key|token|auth|credential|apikey|api_key)\s*[=:]\s*['"]?[^\s'"]+/gi;
function buildContext(targetPath, targetUrl, isCloud = false) {
  const isLocal = targetPath !== void 0 && existsSync(targetPath);
  const techStack = isLocal ? detectTech(targetPath) : [];
  const fileTree = isLocal ? buildFileTree(targetPath) : "";
  const packageFiles = isLocal ? readInterestingFiles(targetPath) : {};
  return Object.freeze({
    targetPath,
    targetUrl,
    isLocal,
    techStack,
    fileTree,
    packageFiles,
    cloudSafetyActive: isCloud
  });
}
function detectTech(rootPath) {
  const detected = [];
  const seen = /* @__PURE__ */ new Set();
  let entries;
  try {
    entries = readdirSync(rootPath);
  } catch {
    return detected;
  }
  const entrySet = new Set(entries);
  for (const [label, marker] of TECH_MARKERS) {
    if (seen.has(label)) continue;
    if (marker === "*.csproj") {
      if (entries.some((e) => e.endsWith(".csproj"))) {
        seen.add(label);
        detected.push(label);
      }
      continue;
    }
    if (entrySet.has(marker)) {
      seen.add(label);
      detected.push(label);
    }
  }
  return detected;
}
function buildFileTree(rootPath, maxDepth = DEFAULT_MAX_DEPTH) {
  const lines = [];
  const rootName = basename(rootPath);
  lines.push(rootName + "/");
  walkTree(rootPath, "", 0, maxDepth, lines);
  let result = lines.join("\n");
  if (result.length > MAX_TREE_CHARS) {
    result = result.slice(0, MAX_TREE_CHARS - 30) + "\n[...tree truncated]";
  }
  return result;
}
function walkTree(dir, prefix, depth, maxDepth, lines) {
  if (depth >= maxDepth) return;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const files = [];
  const dirs = [];
  for (const entry of entries.sort()) {
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = lstatSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      if (!IGNORED_DIRS.has(entry) && !entry.startsWith(".")) {
        dirs.push(entry);
      }
    } else if (stat.isFile()) {
      files.push(entry);
    }
  }
  const all = [...files, ...dirs.map((d) => d + "/")];
  const total = all.length;
  for (let i = 0; i < total; i++) {
    const isLast = i === total - 1;
    const connector = isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
    const childPrefix = isLast ? "    " : "\u2502   ";
    const name = all[i];
    lines.push(`${prefix}${connector}${name}`);
    if (name.endsWith("/")) {
      const dirName = name.slice(0, -1);
      walkTree(
        join(dir, dirName),
        prefix + childPrefix,
        depth + 1,
        maxDepth,
        lines
      );
    }
  }
}
function readInterestingFiles(rootPath) {
  const result = {};
  for (const relPath of INTERESTING_FILES) {
    const fullPath = join(rootPath, relPath);
    let stat;
    try {
      stat = lstatSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) continue;
    try {
      let content = readFileSync(fullPath, "utf-8");
      if (content.length > MAX_FILE_CHARS) {
        content = content.slice(0, MAX_FILE_CHARS) + "\n[...truncated]";
      }
      content = scrubSecrets(content);
      result[relPath] = content;
    } catch {
    }
  }
  return result;
}
function scrubSecrets(text) {
  return text.replace(SECRET_VALUE_RE, (match) => {
    const eqIdx = match.search(/[=:]/);
    if (eqIdx === -1) return match;
    return match.slice(0, eqIdx + 1) + " [REDACTED]";
  });
}

// src/security/scanner.ts
import { readdirSync as readdirSync2, readFileSync as readFileSync2, lstatSync as lstatSync2 } from "fs";
import { join as join2, extname, basename as basename2, relative } from "path";

// src/security/patterns.ts
var CODE_EXTENSIONS = [
  ".py",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".java",
  ".rb",
  ".php",
  ".go",
  ".rs",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".hpp",
  ".scala",
  ".kt"
];
var CONFIG_EXTENSIONS = [
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".env",
  ".xml",
  ".properties"
];
var CODE_AND_CONFIG_EXTENSIONS = [
  ...CODE_EXTENSIONS,
  ...CONFIG_EXTENSIONS
];
var SCAN_PATTERNS = [
  // 1 — Hardcoded Secrets
  {
    name: "Hardcoded Secret",
    severity: "CRITICAL",
    pattern: /(?:api[_-]?key|secret[_-]?key|password|passwd|token|auth[_-]?token)\s*[=:]\s*['"][^'"]{8,}['"]/i,
    extensions: CODE_AND_CONFIG_EXTENSIONS,
    description: "Hardcoded API key, password, token, or secret detected in source code."
  },
  // 2 — AWS Access Key
  {
    name: "AWS Access Key",
    severity: "CRITICAL",
    pattern: /AKIA[0-9A-Z]{16}/,
    extensions: [],
    description: "AWS access key ID found. Rotate immediately and remove from source."
  },
  // 3 — Private Key File
  {
    name: "Private Key in Source",
    severity: "HIGH",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    extensions: [],
    description: "Private key material detected. Keys must never be committed to version control."
  },
  // 4 — SQL Injection
  {
    name: "Potential SQL Injection",
    severity: "HIGH",
    pattern: /(?:execute|cursor\.execute|query)\s*\(\s*['"].*?\s*[+%]\s*/,
    extensions: [".py", ".js", ".ts", ".php", ".java", ".rb"],
    description: "SQL query built via string concatenation \u2014 use parameterised queries instead."
  },
  // 5 — XSS / innerHTML
  {
    name: "XSS / innerHTML",
    severity: "HIGH",
    pattern: /innerHTML\s*=|document\.write\s*\(/,
    extensions: [".js", ".ts", ".jsx", ".tsx", ".html"],
    description: "Direct DOM mutation via innerHTML or document.write can lead to XSS."
  },
  // 6 — eval / exec
  {
    name: "Dangerous eval/exec",
    severity: "HIGH",
    pattern: /\b(?:eval|exec)\s*\(/,
    extensions: [".py", ".js", ".ts", ".php"],
    description: "Use of eval() or exec() can lead to arbitrary code execution."
  },
  // 7 — Insecure Deserialization
  {
    name: "Insecure Deserialization",
    severity: "HIGH",
    pattern: /pickle\.loads|yaml\.load\b(?!.*Loader)|unserialize/,
    extensions: [".py", ".php", ".java"],
    description: "Unsafe deserialization can allow remote code execution."
  },
  // 8 — Weak Crypto
  {
    name: "Weak Cryptographic Algorithm",
    severity: "MEDIUM",
    pattern: /\bMD5\b|\bSHA1\b(?!\d)|\bDES\b(?!C)/,
    extensions: CODE_EXTENSIONS,
    description: "MD5, SHA-1, or DES are cryptographically weak \u2014 use SHA-256+ or AES."
  },
  // 9 — Debug Mode
  {
    name: "Debug Mode Enabled",
    severity: "MEDIUM",
    pattern: /DEBUG\s*=\s*True|debug:\s*true/i,
    extensions: [".py", ".js", ".ts", ".json", ".yaml", ".yml"],
    description: "Debug mode left enabled \u2014 disable before deploying to production."
  },
  // 10 — CORS Wildcard
  {
    name: "CORS Wildcard Origin",
    severity: "MEDIUM",
    pattern: /Access-Control-Allow-Origin.*\*/,
    extensions: CODE_AND_CONFIG_EXTENSIONS,
    description: "Wildcard CORS origin allows any site to make authenticated requests."
  },
  // 11 — Hardcoded Private IP
  {
    name: "Hardcoded Private IP",
    severity: "LOW",
    pattern: /\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/,
    extensions: CODE_AND_CONFIG_EXTENSIONS,
    description: "Private IP address hardcoded in source \u2014 use configuration or DNS instead."
  },
  // 12 — TODO/FIXME Security
  {
    name: "Security TODO/FIXME",
    severity: "INFO",
    pattern: /(?:TODO|FIXME|HACK|XXX).*(?:security|vuln|auth|inject|xss|csrf)/i,
    extensions: [],
    description: "Developer note referencing a known security concern that has not been addressed."
  },
  // 13 — JWT Secret Inline
  {
    name: "JWT Inline Secret",
    severity: "HIGH",
    pattern: /jwt\.(?:sign|verify)\s*\(/,
    extensions: [".js", ".ts", ".py", ".rb", ".java"],
    description: "JWT signing/verification detected \u2014 ensure secrets are loaded from environment, not hardcoded."
  },
  // 14 — Command Injection
  {
    name: "Potential Command Injection",
    severity: "HIGH",
    pattern: /child_process|subprocess|os\.system|shell_exec|Runtime\.exec/,
    extensions: CODE_EXTENSIONS,
    description: "Direct shell invocation detected \u2014 validate and sanitise all inputs."
  },
  // 15 — Database URL with Credentials
  {
    name: "Database URL with Credentials",
    severity: "HIGH",
    pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s'">]+/,
    extensions: CODE_AND_CONFIG_EXTENSIONS,
    description: "Database connection string found \u2014 credentials should come from a secret store."
  }
];
var SENSITIVE_FILES = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.staging",
  ".pem",
  ".key",
  ".pfx",
  ".p12",
  ".jks",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  ".htpasswd",
  ".netrc",
  "credentials.json",
  "service-account.json",
  "secrets.yaml",
  "secrets.yml"
];

// src/security/scanner.ts
var IGNORED_DIRS2 = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor"
]);
var MAX_FILE_SIZE = 500 * 1024;
function redactValue(raw) {
  if (raw.length <= 4) {
    return "****";
  }
  return `${raw.slice(0, 4)}...`;
}
function extensionMatches(fileExt, patternExtensions) {
  if (patternExtensions.length === 0) {
    return true;
  }
  return patternExtensions.includes(fileExt.toLowerCase());
}
var StaticScanner = class {
  /**
   * @param rootPath - Absolute path to the project root to scan.
   */
  constructor(rootPath) {
    this.rootPath = rootPath;
  }
  rootPath;
  /**
   * Execute the full scan and return deduplicated findings.
   *
   * @returns An array of {@link Finding} objects sorted by severity.
   */
  scan() {
    const files = this.walkDirectory(this.rootPath);
    const seen = /* @__PURE__ */ new Set();
    const findings = [];
    for (const filepath of files) {
      for (const finding of this.scanFile(filepath)) {
        const key = `${finding.name}::${finding.location}`;
        if (!seen.has(key)) {
          seen.add(key);
          findings.push(finding);
        }
      }
    }
    return findings;
  }
  // ── Directory Walk ───────────────────────────────────────────────────────
  /**
   * Recursively list all files under `dir`, skipping ignored directories
   * and symlinks.
   *
   * @param dir - Directory to walk.
   * @returns Flat list of absolute file paths.
   */
  walkDirectory(dir) {
    const results = [];
    let entries;
    try {
      entries = readdirSync2(dir);
    } catch {
      return results;
    }
    for (const entry of entries) {
      const fullPath = join2(dir, entry);
      let stat;
      try {
        stat = lstatSync2(fullPath);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        continue;
      }
      if (stat.isDirectory()) {
        if (!IGNORED_DIRS2.has(entry)) {
          results.push(...this.walkDirectory(fullPath));
        }
      } else if (stat.isFile()) {
        results.push(fullPath);
      }
    }
    return results;
  }
  // ── File Scan ────────────────────────────────────────────────────────────
  /**
   * Scan a single file for vulnerability patterns and sensitive-file matches.
   *
   * @param filepath - Absolute path to the file.
   * @returns Findings detected in this file (one per pattern at most).
   */
  scanFile(filepath) {
    const findings = [];
    const relPath = relative(this.rootPath, filepath);
    const fileName = basename2(filepath);
    const fileExt = extname(filepath).toLowerCase();
    if (SENSITIVE_FILES.includes(fileName) || SENSITIVE_FILES.includes(fileExt)) {
      findings.push({
        name: "Sensitive File Detected",
        severity: "HIGH",
        location: relPath,
        what: `Sensitive file "${fileName}" found in the repository.`,
        impact: "May contain credentials, private keys, or other secrets.",
        fix: "Add to .gitignore and remove from version control history."
      });
    }
    let stat;
    try {
      stat = lstatSync2(filepath);
    } catch {
      return findings;
    }
    if (stat.size > MAX_FILE_SIZE) {
      return findings;
    }
    let content;
    try {
      content = readFileSync2(filepath, "utf-8");
    } catch {
      return findings;
    }
    const lines = content.split("\n");
    const matchedPatterns = /* @__PURE__ */ new Set();
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      for (const rule of SCAN_PATTERNS) {
        if (matchedPatterns.has(rule.name)) {
          continue;
        }
        if (!extensionMatches(fileExt, rule.extensions)) {
          continue;
        }
        const match = rule.pattern.exec(line);
        if (match) {
          matchedPatterns.add(rule.name);
          findings.push(
            this.buildFinding(rule, relPath, lineIdx + 1, match[0])
          );
        }
      }
    }
    return findings;
  }
  // ── Finding Builder ──────────────────────────────────────────────────────
  /**
   * Construct a {@link Finding} from a matched pattern.
   *
   * @param rule     - The pattern that triggered the match.
   * @param relPath  - Relative file path from project root.
   * @param line     - 1-based line number of the match.
   * @param rawMatch - The raw regex match string.
   */
  buildFinding(rule, relPath, line, rawMatch) {
    const redacted = redactValue(rawMatch);
    return {
      name: rule.name,
      severity: rule.severity,
      location: `${relPath}:${line}`,
      what: `${rule.description} (matched: ${redacted})`,
      fix: this.suggestFix(rule.name),
      confidence: 0.7
    };
  }
  /**
   * Return a brief remediation suggestion for a given rule.
   *
   * @param ruleName - The canonical rule name.
   */
  suggestFix(ruleName) {
    const fixes = {
      "Hardcoded Secret": "Move secrets to environment variables or a dedicated secret manager.",
      "AWS Access Key": "Rotate the key immediately via IAM and use AWS Secrets Manager.",
      "Private Key in Source": "Remove the key, regenerate it, and store in a vault.",
      "Potential SQL Injection": "Use parameterised / prepared statements.",
      "XSS / innerHTML": "Use textContent or a framework-safe binding instead.",
      "Dangerous eval/exec": "Replace with a safer alternative (e.g., JSON.parse, Function constructor with caution).",
      "Insecure Deserialization": "Use safe loaders (yaml.safe_load, json) and avoid untrusted input.",
      "Weak Cryptographic Algorithm": "Upgrade to SHA-256 or stronger; use AES instead of DES.",
      "Debug Mode Enabled": "Set DEBUG to false in production configurations.",
      "CORS Wildcard Origin": "Restrict Access-Control-Allow-Origin to specific trusted domains.",
      "Hardcoded Private IP": "Use environment-based configuration or DNS names.",
      "Security TODO/FIXME": "Address the security concern noted in this comment.",
      "JWT Inline Secret": "Load JWT secrets from environment variables, not source code.",
      "Potential Command Injection": "Validate and sanitise all user inputs before passing to shell commands.",
      "Database URL with Credentials": "Store connection strings in environment variables or a secret manager."
    };
    return fixes[ruleName] ?? "Review and remediate this finding.";
  }
};

// src/core/planner.ts
var SCOPE_TOOLS = {
  all: ["nmap", "nikto", "gobuster", "sqlmap", "sslyze", "ffuf"],
  web: ["nikto", "gobuster", "ffuf", "curl"],
  sql: ["sqlmap"],
  dirs: ["gobuster", "ffuf", "dirb", "dirsearch"],
  ports: ["nmap"],
  fuzz: ["ffuf", "wfuzz"],
  headers: ["curl"],
  ssl: ["sslyze", "testssl.sh"]
};
function getToolsForScope(scope) {
  return SCOPE_TOOLS[scope] ?? SCOPE_TOOLS["all"];
}

// src/agents/security/prompts.ts
function buildSecurityPrompt(context, scope) {
  const tools = getToolsForScope(scope);
  const sections = [];
  sections.push(`# Identity

You are CSage - an AI-powered security assessment agent.
You are a senior penetration tester with deep expertise in application security,
network reconnaissance, and vulnerability analysis.`);
  sections.push(`# Role

Your role is to systematically identify security vulnerabilities in the target.
You operate methodically: gather information -> plan tests -> execute -> report.
You explain your reasoning clearly and never guess - if unsure, say so.`);
  sections.push(`# Safety Rules

1. NEVER attack targets you have not been explicitly authorised to test.
2. NEVER exfiltrate data from the target.
3. NEVER attempt denial-of-service attacks.
4. NEVER use destructive commands (rm, format, dd, mkfs).
5. NEVER chain shell operators (|, &&, ||, ;, >, >>, <, backticks, $()).
6. NEVER persist backdoors, web shells, or implants.
7. NEVER modify or delete files on the target system.
8. If you are unsure whether an action is safe, ASK the user first.
9. Respect the assessment scope - only use tools within scope.
10. All findings must be evidence-based - do not fabricate vulnerabilities.${context.cloudSafetyActive ? "\n11. CLOUD SAFETY MODE ACTIVE - extra caution required for cloud-hosted targets." : ""}`);
  sections.push(`# Available Tools (scope: ${scope})

You may use these security tools through shell_exec: ${tools.join(", ")}.
Do NOT use security tools outside this list for the current scope.`);
  sections.push(`# Tool Usage

You have access to tools for security testing. Use them directly:
- Use \`shell_exec\` to run security tools (nmap, nikto, gobuster, sqlmap, etc.)
- Use \`report_finding\` to formally report a discovered vulnerability
- Use \`read_file\` to inspect source code in the target project
- Use \`list_directory\` to explore the target project structure

When a tool fails, analyze the error and either:
- Try an alternative approach
- Ask the user for guidance
- Do NOT automatically install packages without user approval`);
  const contextParts = ["# Project Context"];
  if (context.targetPath) {
    contextParts.push(`Target path: ${context.targetPath}`);
  }
  if (context.targetUrl) {
    contextParts.push(`Target URL: ${context.targetUrl}`);
  }
  if (context.techStack.length > 0) {
    contextParts.push(`Detected tech stack: ${context.techStack.join(", ")}`);
  }
  if (context.fileTree.length > 0) {
    contextParts.push(`
## File Tree
\`\`\`
${context.fileTree}
\`\`\``);
  }
  if (Object.keys(context.packageFiles).length > 0) {
    contextParts.push("\n## Configuration Files");
    for (const [filePath, content] of Object.entries(context.packageFiles)) {
      contextParts.push(`
### ${filePath}
\`\`\`
${content}
\`\`\``);
    }
  }
  sections.push(contextParts.join("\n"));
  return sections.join("\n\n");
}

// src/agents/security/tools.ts
import { readdir, readFile } from "fs/promises";
import { resolve, relative as relative2 } from "path";

// src/security/sanitizer.ts
var ANSI_ESCAPE_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
var CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
var DEFAULT_MAX_LINES = 150;
var DEFAULT_MAX_CHARS = 8e3;
function sanitizeCommandOutput(raw, maxLines = DEFAULT_MAX_LINES, maxChars = DEFAULT_MAX_CHARS) {
  let cleaned = raw.replace(ANSI_ESCAPE_RE, "").replace(CONTROL_CHAR_RE, "");
  if (cleaned.length > maxChars) {
    const halfChars = Math.floor(maxChars / 2);
    cleaned = cleaned.slice(0, halfChars) + "\n[...output truncated...]\n" + cleaned.slice(-halfChars);
  }
  const lines = cleaned.split("\n");
  if (lines.length > maxLines) {
    const headCount = Math.ceil(maxLines / 2);
    const tailCount = Math.floor(maxLines / 2);
    const omitted = lines.length - headCount - tailCount;
    const head = lines.slice(0, headCount);
    const tail = lines.slice(-tailCount);
    return [...head, `[...${omitted} lines omitted]`, ...tail].join("\n");
  }
  return cleaned;
}

// src/types/findings.ts
import { z } from "zod";
var SeveritySchema = z.enum([
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFO"
]);
var FindingSchema = z.object({
  /** Short human-readable title for the finding. */
  name: z.string().min(1),
  /** How severe this finding is. */
  severity: SeveritySchema,
  /** Where the issue was found (file path, URL, host:port, etc.). */
  location: z.string().min(1),
  /** Concise description of what was discovered. */
  what: z.string().min(1),
  /** Potential business or technical impact if exploited. */
  impact: z.string().optional(),
  /** Recommended remediation steps. */
  fix: z.string().optional(),
  /** Command that could demonstrate or exploit the vulnerability. */
  exploitCmd: z.string().optional(),
  /** Confidence score from 0 to 1 (1 = highest confidence). */
  confidence: z.number().min(0).max(1).optional()
});
var CommandRiskSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
var SuggestedCommandSchema = z.object({
  /** The full shell command to execute. */
  command: z.string().min(1),
  /** Name of the tool this command invokes (e.g. "nmap", "sqlmap"). */
  tool: z.string().min(1),
  /** Explanation of why this command is useful. */
  why: z.string().min(1),
  /** Additional CLI flags or options. */
  flags: z.string().optional(),
  /** Risk level of running this command. */
  risk: CommandRiskSchema
});
var ParsedResponseSchema = z.object({
  /** Security findings extracted from the LLM response. */
  findings: z.array(FindingSchema),
  /** Follow-up commands suggested by the LLM. */
  commands: z.array(SuggestedCommandSchema),
  /** Free-form narrative summary from the LLM. */
  narrative: z.string(),
  /** Warnings generated during response parsing. */
  parseWarnings: z.array(z.string())
});

// src/agents/security/tools.ts
function getSecurityToolDefinitions(_scope) {
  return [
    {
      name: "shell_exec",
      description: "Execute a shell command for security testing",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          timeout: { type: "number" }
        },
        required: ["command"]
      }
    },
    {
      name: "read_file",
      description: "Read a file from the target project",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"]
      }
    },
    {
      name: "list_directory",
      description: "List a directory in the target project",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"]
      }
    },
    {
      name: "report_finding",
      description: "Record a discovered security finding",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] },
          location: { type: "string" },
          what: { type: "string" },
          impact: { type: "string" },
          fix: { type: "string" }
        },
        required: ["name", "severity", "location", "what"]
      }
    }
  ];
}
function buildSecurityToolHandlers(targetPath) {
  const handlers = /* @__PURE__ */ new Map();
  handlers.set("shell_exec", async (args) => {
    const command = typeof args.command === "string" ? args.command : "";
    const timeout = typeof args.timeout === "number" ? args.timeout : void 0;
    if (command.length === 0) {
      return { output: "Missing command", success: false };
    }
    const result = await executeCommand(command, {
      ...timeout !== void 0 && { timeout },
      ...targetPath && { cwd: targetPath }
    });
    const output = sanitizeCommandOutput(
      result.stdout + (result.stderr ? `
${result.stderr}` : "") + (result.error ? `
${result.error}` : "")
    );
    return { output, success: result.success };
  });
  handlers.set("read_file", async (args) => {
    if (!targetPath) {
      return { output: "No target path is set", success: false };
    }
    const requestedPath = typeof args.path === "string" ? args.path : "";
    const resolvedPath = resolveTargetPath(targetPath, requestedPath);
    if (!resolvedPath.allowed) {
      return { output: resolvedPath.reason, success: false };
    }
    const content = await readFile(resolvedPath.path, "utf-8");
    return { output: content, success: true };
  });
  handlers.set("list_directory", async (args) => {
    if (!targetPath) {
      return { output: "No target path is set", success: false };
    }
    const requestedPath = typeof args.path === "string" ? args.path : ".";
    const resolvedPath = resolveTargetPath(targetPath, requestedPath);
    if (!resolvedPath.allowed) {
      return { output: resolvedPath.reason, success: false };
    }
    const entries = await readdir(resolvedPath.path, { withFileTypes: true });
    const output = entries.map((entry) => `${entry.isDirectory() ? "d" : "-"} ${entry.name}`).join("\n");
    return { output, success: true };
  });
  handlers.set("report_finding", async (args) => {
    const parsed = FindingSchema.safeParse(args);
    if (!parsed.success) {
      return { output: parsed.error.message, success: false };
    }
    return {
      output: `Finding recorded: [${parsed.data.severity}] ${parsed.data.name} at ${parsed.data.location}`,
      success: true,
      metadata: { finding: parsed.data }
    };
  });
  return handlers;
}
function resolveTargetPath(rootPath, requestedPath) {
  const root = resolve(rootPath);
  const candidate = resolve(root, requestedPath || ".");
  const rel = relative2(root, candidate);
  if (rel.startsWith("..") || rel === "..") {
    return { allowed: false, reason: "Path escapes target root" };
  }
  return { allowed: true, path: candidate };
}

// src/agents/security/agent.ts
var SecurityAgent = class {
  /** Underlying generic agent runtime. */
  runtime;
  target;
  /**
   * Create a security agent.
   *
   * @param options - Security agent options.
   */
  constructor(options) {
    this.target = options.target;
    const context = buildContext(options.target.path, options.target.url, options.isCloud);
    const systemPrompt = buildSecurityPrompt(context, options.scope);
    const tools = getSecurityToolDefinitions(options.scope);
    const toolHandlers = buildSecurityToolHandlers(options.target.path);
    const approvalPolicy = new SecurityApprovalPolicy(classify, options.approvalPromptFn);
    this.runtime = new AgentRuntime({
      provider: options.provider,
      systemPrompt,
      tools,
      toolHandlers,
      approvalPolicy,
      logger: options.logger,
      budget: {
        ...options.maxIterations !== void 0 && { maxIterations: options.maxIterations }
      }
    });
  }
  /** Runtime event bus. */
  get events() {
    return this.runtime.events;
  }
  /** Run the agent for a user message. */
  run(message) {
    return this.runtime.run(message);
  }
  /** Cancel the active run. */
  cancel() {
    this.runtime.cancel();
  }
  /** Run static initialization checks for local targets. */
  async initialize() {
    if (!this.target.path) {
      return [];
    }
    const scanner = new StaticScanner(this.target.path);
    return scanner.scan();
  }
  /** Get tool execution history. */
  getHistory() {
    return this.runtime.getHistory();
  }
  /** Get conversation messages. */
  getConversation() {
    return this.runtime.getConversation();
  }
};

// src/cli/renderer.ts
import readline from "readline";
var StreamRenderer = class {
  buffer = "";
  lastWasNewline = true;
  /** Stream raw assistant text. */
  streamText(content) {
    process.stdout.write(content);
    this.buffer += content;
    this.lastWasNewline = content.endsWith("\n");
  }
  /** Finish the current assistant text stream. */
  finalize() {
    if (this.buffer.length > 0 && !this.lastWasNewline) {
      process.stdout.write("\n");
    }
    this.buffer = "";
    this.lastWasNewline = true;
  }
  /** Show a tool call event. */
  showToolCall(event) {
    this.ensureBlankLine();
    console.log(theme.box("\u250C\u2500 ") + theme.toolCall(`tool: ${event.name}`));
    if (event.name === "shell_exec" && typeof event.args.command === "string") {
      console.log(theme.box("\u2502 ") + theme.toolCall(`$ ${event.args.command}`));
    } else {
      console.log(theme.box("\u2502 ") + theme.dim(`args: ${JSON.stringify(event.args)}`));
    }
    console.log(theme.box("\u2514\u2500"));
  }
  /** Ask the user to approve a risky tool call. */
  async promptApproval(risk, reason) {
    this.ensureBlankLine();
    console.log(theme.approval(`Approval required [${risk}]`));
    console.log(theme.dim(reason));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await new Promise((resolve2) => {
        rl.question("Allow? [y/N] ", resolve2);
      });
      return answer.trim().toLowerCase() === "y";
    } finally {
      rl.close();
      process.stdin.resume();
    }
  }
  /** Show a tool result event. */
  showToolResult(event) {
    const lines = event.output.split("\n");
    const visible = lines.slice(0, 30);
    const remaining = lines.length - visible.length;
    console.log(theme.box("\u250C\u2500 ") + theme.toolResult(`${event.name}: ${event.status} (${event.durationMs}ms)`));
    for (const line of visible) {
      console.log(theme.box("\u2502 ") + theme.toolResult(line));
    }
    if (remaining > 0) {
      console.log(theme.box("\u2502 ") + theme.dim(`... ${remaining} more line(s)`));
    }
    console.log(theme.box("\u2514\u2500"));
  }
  /** Show an iteration separator. */
  showIteration(event) {
    if (event.index > 1) {
      this.ensureBlankLine();
      console.log(theme.dim(`--- iteration ${event.index}/${event.maxIterations} ---`));
    }
  }
  /** Show an error. */
  showError(error) {
    this.ensureBlankLine();
    console.error(theme.error(`x ${error.message}`));
  }
  /** Show Ctrl+C interruption state. */
  showInterrupted() {
    this.ensureBlankLine();
    console.log(theme.warning("Interrupted. Press Ctrl+C again to exit."));
  }
  /** Show startup banner. */
  showBanner() {
    console.log("");
    console.log(theme.heading("CSage"));
    console.log(theme.dim("AI Security Navigator"));
    console.log("");
  }
  ensureBlankLine() {
    if (!this.lastWasNewline) {
      process.stdout.write("\n");
      this.lastWasNewline = true;
    }
  }
};

// src/types/agent.ts
import { z as z2 } from "zod";
var ScopeSchema = z2.enum([
  "all",
  "web",
  "sql",
  "dirs",
  "ports",
  "fuzz",
  "headers",
  "ssl"
]);
var TargetSchema = z2.object({
  /** Local file-system path to scan (for static analysis, etc.). */
  path: z2.string().optional(),
  /** URL of the remote target (for web/network scans). */
  url: z2.string().url().optional(),
  /** Which categories of testing to perform. */
  scope: ScopeSchema
});
var SessionStateSchema = z2.enum([
  "initializing",
  "planning",
  "executing",
  "reporting",
  "ended"
]);
var StepRiskSchema = z2.enum(["LOW", "MEDIUM", "HIGH"]);
var PlanStepSchema = z2.object({
  /** Unique identifier for this step. */
  id: z2.string().min(1),
  /** Name of the tool to invoke. */
  tool: z2.string().min(1),
  /** Full shell command to execute. */
  command: z2.string().min(1),
  /** Human-readable description of what this step does. */
  description: z2.string().min(1),
  /** Risk assessment for this step. */
  risk: StepRiskSchema,
  /** IDs of steps that must complete before this one can run. */
  dependsOn: z2.array(z2.string()).optional()
});
var StepResultSchema = z2.object({
  /** ID of the plan step that was executed. */
  stepId: z2.string().min(1),
  /** Whether the step completed successfully. */
  success: z2.boolean(),
  /** Raw output from the step execution. */
  output: z2.string().optional(),
  /** Security findings produced by this step. */
  findings: z2.array(FindingSchema).optional(),
  /** Error message if the step failed. */
  error: z2.string().optional()
});
var SessionInfoSchema = z2.object({
  /** Unique session identifier. */
  sessionId: z2.string().min(1),
  /** ISO-8601 timestamp when the session was created. */
  startedAt: z2.string().datetime(),
  /** The target being assessed. */
  target: TargetSchema,
  /** LLM model being used for this session. */
  model: z2.string().min(1),
  /** Assessment scope for this session. */
  scope: ScopeSchema,
  /** Current lifecycle state. */
  state: SessionStateSchema
});

// src/cli/repl.ts
async function startREPL() {
  const renderer = new StreamRenderer();
  renderer.showBanner();
  const config = loadProviderConfig();
  if (!config) {
    console.error(theme.error("No provider configured. Run `csage model` first."));
    return;
  }
  const apiKey = loadApiKey(config.id);
  const provider = createProvider(apiKey ? { ...config, apiKey } : config);
  const health = await provider.ping();
  if (!health.ok) {
    console.error(theme.error(`Provider unavailable: ${health.error ?? "unknown error"}`));
    return;
  }
  console.log(theme.dim(`${provider.name} / ${config.model} (${health.latencyMs ?? 0}ms)`));
  console.log(theme.dim("Use /target <url|path> to begin, /help for commands."));
  console.log("");
  const rl = readline2.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: theme.prompt("> ")
  });
  let agent = null;
  let isRunning = false;
  let ctrlCCount = 0;
  let scope = "all";
  const subscribe = (nextAgent) => {
    nextAgent.events.removeAll();
    nextAgent.events.on((event) => {
      if (event.type === "text") renderer.streamText(event.content);
      if (event.type === "tool_call") renderer.showToolCall(event);
      if (event.type === "tool_result") renderer.showToolResult(event);
      if (event.type === "iteration") renderer.showIteration(event);
      if (event.type === "error") renderer.showError(event.error);
      if (event.type === "done") {
        renderer.finalize();
        isRunning = false;
        ctrlCCount = 0;
        rl.prompt();
      }
    });
  };
  rl.on("SIGINT", () => {
    if (isRunning && agent && ctrlCCount === 0) {
      ctrlCCount += 1;
      agent.cancel();
      renderer.showInterrupted();
      return;
    }
    process.exit(0);
  });
  rl.on("line", (line) => {
    void (async () => {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        rl.prompt();
        return;
      }
      if (trimmed.startsWith("/")) {
        const result = await handleSlashCommand(trimmed, {
          agent,
          setAgent(nextAgent) {
            agent = nextAgent;
            subscribe(nextAgent);
          },
          renderer,
          rl,
          provider,
          getScope: () => scope,
          setScope(nextScope) {
            scope = nextScope;
          },
          setRunning(nextRunning) {
            isRunning = nextRunning;
          }
        });
        if (!result.startedRun) {
          rl.prompt();
        }
        return;
      }
      if (!agent) {
        console.log(theme.warning("No target is set. Use /target <url|path>."));
        rl.prompt();
        return;
      }
      isRunning = true;
      ctrlCCount = 0;
      await agent.run(trimmed);
    })().catch((error) => {
      isRunning = false;
      renderer.showError(error instanceof Error ? error : new Error(String(error)));
      rl.prompt();
    });
  });
  rl.prompt();
}
async function handleSlashCommand(input, context) {
  const [command, ...rest] = input.split(/\s+/);
  const arg = rest.join(" ");
  if (command === "/help") {
    showHelp();
    return { startedRun: false };
  }
  if (command === "/target") {
    if (arg.length === 0) {
      console.log(theme.warning("Usage: /target <url|path>"));
      return { startedRun: false };
    }
    const confirmed = await promptOwnership(arg);
    if (!confirmed) {
      console.log(theme.dim("Target not set."));
      return { startedRun: false };
    }
    const target = buildTarget(arg, context.getScope());
    const nextAgent = new SecurityAgent({
      provider: context.provider,
      target,
      scope: context.getScope(),
      approvalPromptFn: (_call, risk, reason) => context.renderer.promptApproval(risk, reason)
    });
    context.setAgent(nextAgent);
    const staticFindings = await nextAgent.initialize();
    console.log(theme.success(`Target set: ${arg}`));
    if (staticFindings.length > 0) {
      console.log(theme.warning(`Static scanner found ${staticFindings.length} potential issue(s).`));
    }
    return { startedRun: false };
  }
  if (command === "/findings") {
    showFindings(context.agent);
    return { startedRun: false };
  }
  if (command === "/history") {
    showHistory(context.agent);
    return { startedRun: false };
  }
  if (command === "/clear") {
    context.agent?.runtime.reset();
    console.log(theme.dim("Conversation cleared."));
    return { startedRun: false };
  }
  if (command === "/model") {
    console.log(theme.dim("Run `csage model` outside the REPL to change provider settings."));
    return { startedRun: false };
  }
  if (command === "/tools") {
    console.log(theme.dim("Run `csage tools` outside the REPL to manage tool installation."));
    return { startedRun: false };
  }
  if (command === "/scope") {
    if (arg.length === 0) {
      console.log(theme.dim(`Current scope: ${context.getScope()}`));
      return { startedRun: false };
    }
    const parsed = ScopeSchema.safeParse(arg);
    if (!parsed.success) {
      console.log(theme.warning(`Invalid scope. Valid scopes: ${ScopeSchema.options.join(", ")}`));
      return { startedRun: false };
    }
    context.setScope(parsed.data);
    console.log(theme.success(`Scope set: ${parsed.data}`));
    return { startedRun: false };
  }
  if (command === "/report") {
    if (!context.agent) {
      console.log(theme.warning("No target is set. Use /target <url|path>."));
      return { startedRun: false };
    }
    context.setRunning(true);
    await context.agent.run("Generate a comprehensive security assessment report");
    return { startedRun: true };
  }
  if (command === "/quit" || command === "/exit") {
    console.log(theme.dim("Goodbye."));
    process.exit(0);
  }
  console.log(theme.warning(`Unknown command: ${command}`));
  return { startedRun: false };
}
function buildTarget(value, scope) {
  try {
    const url = new URL(value);
    return { url: url.toString(), scope };
  } catch {
    return { path: value, scope };
  }
}
async function promptOwnership(target) {
  console.log("");
  console.log(theme.warning(`Only proceed if you have authorization to test: ${target}`));
  const response = await prompts({
    type: "confirm",
    name: "value",
    message: "I confirm I have authorization to test this target",
    initial: false
  });
  return response.value === true;
}
function showHelp() {
  console.log("");
  console.log(`${theme.slash("/target <url|path>")}  Set the assessment target`);
  console.log(`${theme.slash("/scope <scope>")}      Show or change scope`);
  console.log(`${theme.slash("/history")}            Show tool execution history`);
  console.log(`${theme.slash("/findings")}           Show reported findings`);
  console.log(`${theme.slash("/clear")}              Clear conversation`);
  console.log(`${theme.slash("/report")}             Generate final report`);
  console.log(`${theme.slash("/model")}              Provider setup hint`);
  console.log(`${theme.slash("/tools")}              Tool setup hint`);
  console.log(`${theme.slash("/quit")}               Exit`);
  console.log("");
}
function showHistory(agent) {
  if (!agent) {
    console.log(theme.warning("No active agent."));
    return;
  }
  const history = agent.getHistory();
  if (history.length === 0) {
    console.log(theme.dim("No tool executions yet."));
    return;
  }
  for (const exec of history) {
    console.log(`${exec.status.padEnd(10)} ${exec.name} ${exec.durationMs ?? 0}ms`);
  }
}
function showFindings(agent) {
  if (!agent) {
    console.log(theme.warning("No active agent."));
    return;
  }
  const findings = agent.getHistory().map((exec) => exec.metadata?.finding).filter((finding) => isFinding(finding));
  if (findings.length === 0) {
    console.log(theme.dim("No reported findings yet."));
    return;
  }
  for (const finding of findings) {
    console.log(`[${finding.severity}] ${finding.name} - ${finding.location}`);
  }
}
function isFinding(value) {
  return !!value && typeof value === "object" && "name" in value && "severity" in value && "location" in value && "what" in value;
}
export {
  startREPL
};
//# sourceMappingURL=repl-MTOQNYWC.js.map