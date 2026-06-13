#!/usr/bin/env node
import {
  createProvider,
  executeCommand,
  getConfigDir,
  isToolInstalled,
  listApiKeys,
  listCloudProviders,
  listLocalProviders,
  loadApiKey,
  loadProviderConfig,
  removeApiKey,
  resetConfig,
  saveApiKey,
  saveProviderConfig,
  theme
} from "./chunk-M7XSJMYQ.js";

// src/cli/index.ts
import { Command as Command6 } from "commander";

// src/cli/commands/model.ts
import { Command } from "commander";
import ora from "ora";
import prompts from "prompts";

// src/cli/ui/print.ts
var VERSION = "2.0.0";
var SEPARATOR = theme.dim("-".repeat(60));
function banner() {
  console.log("");
  console.log(theme.heading("  CSage"));
  console.log(theme.dim(`  v${VERSION} - Ethical security testing assistant`));
  console.log(SEPARATOR);
  console.log("");
}
function printSection(title) {
  console.log("");
  console.log(theme.heading(`> ${title}`));
  console.log(SEPARATOR);
}
function printInfo(msg) {
  console.log(theme.info("  i ") + msg);
}
function printError(msg) {
  console.error(theme.error("  x ") + theme.error(msg));
}
function printWarning(msg) {
  console.log(theme.warning("  ! ") + theme.warning(msg));
}
function printOk(msg) {
  console.log(theme.success("  ok ") + msg);
}

// src/cli/commands/model.ts
async function withSpinner(text, fn) {
  const spinner = ora({ text, color: "magenta" }).start();
  try {
    const result = await fn();
    spinner.succeed(theme.success(text));
    return result;
  } catch (error) {
    spinner.fail(theme.error(text));
    throw error;
  }
}
async function promptText(message, initial) {
  const response = await prompts({ type: "text", name: "value", message, initial });
  return typeof response.value === "string" ? response.value : "";
}
async function promptPassword(message) {
  const response = await prompts({ type: "password", name: "value", message });
  return typeof response.value === "string" ? response.value : "";
}
async function promptSelect(message, choices) {
  const response = await prompts({ type: "select", name: "value", message, choices });
  return response.value;
}
async function setupWizard() {
  banner();
  printSection("Model Setup Wizard");
  const providerType = await promptSelect("Provider type:", [
    { title: "\u2601\uFE0F  Cloud (OpenAI, Anthropic, Gemini, etc.)", value: "cloud" },
    { title: "\u{1F3E0} Local (Ollama)", value: "local" }
  ]);
  if (providerType === "cloud") {
    await setupCloudProvider();
  } else {
    await setupLocalProvider();
  }
}
async function setupCloudProvider() {
  const cloudProviders = listCloudProviders();
  if (cloudProviders.length === 0) {
    printError("No cloud providers registered.");
    return;
  }
  const provider = await promptSelect("Select cloud provider:", [
    ...cloudProviders.map((p) => ({
      title: `${p.name} (${p.defaultModel})`,
      value: p
    }))
  ]);
  printInfo(`Selected: ${provider.name}`);
  const model = await promptSelect("Select model:", [
    ...provider.suggestedModels.map((m) => ({
      title: m,
      value: m
    })),
    { title: "\u270F\uFE0F  Enter custom model name", value: "__custom__" }
  ]);
  const finalModel = model === "__custom__" ? await promptText("Model name:") : model;
  if (provider.keyUrl) {
    printInfo(`Get your API key at: ${theme.info(provider.keyUrl)}`);
  }
  const apiKey = await promptPassword(`${provider.name} API key:`);
  if (!apiKey) {
    printError("API key is required for cloud providers.");
    return;
  }
  const baseUrlInput = await promptText(
    "Base URL (leave empty for default):",
    provider.baseUrl ?? ""
  );
  const baseUrl = baseUrlInput.trim() || provider.baseUrl;
  const config = {
    id: provider.id,
    name: provider.name,
    type: "cloud",
    model: finalModel,
    protocol: provider.protocol,
    ...baseUrl ? { baseUrl } : {}
  };
  printInfo("Testing connection\u2026");
  const testConfig = { ...config, apiKey };
  const llm = createProvider(testConfig);
  const health = await withSpinner("Pinging provider\u2026", () => llm.ping());
  if (!health.ok) {
    printError(`Connection failed: ${health.error ?? "unknown error"}`);
    printWarning("Config was NOT saved. Please check your API key and try again.");
    return;
  }
  printOk(`Connected to ${provider.name} in ${health.latencyMs ?? 0}ms`);
  saveProviderConfig(config);
  saveApiKey(provider.id, apiKey);
  printOk("Provider configuration saved.");
  printInfo(`Provider: ${config.name}`);
  printInfo(`Model:    ${config.model}`);
}
async function setupLocalProvider() {
  const localProviders = listLocalProviders();
  if (localProviders.length === 0) {
    printError("No local providers registered.");
    return;
  }
  const provider = localProviders.length === 1 ? localProviders[0] : await promptSelect("Select local provider:", [
    ...localProviders.map((p) => ({
      title: p.name,
      value: p
    }))
  ]);
  const defaultUrl = provider.baseUrl ?? "http://localhost:11434";
  const baseUrl = await promptText("Ollama server URL:", defaultUrl);
  const config = {
    id: provider.id,
    name: provider.name,
    type: "local",
    model: provider.defaultModel,
    protocol: provider.protocol,
    baseUrl: baseUrl || defaultUrl
  };
  const llm = createProvider(config);
  const health = await withSpinner("Checking Ollama connection\u2026", () => llm.ping());
  if (!health.ok) {
    printError(`Cannot reach Ollama at ${baseUrl || defaultUrl}`);
    printWarning("Make sure Ollama is running: `ollama serve`");
    return;
  }
  printOk(`Connected to Ollama in ${health.latencyMs ?? 0}ms`);
  const model = await promptSelect("Select model:", [
    ...provider.suggestedModels.map((m) => ({
      title: m,
      value: m
    })),
    { title: "\u270F\uFE0F  Enter custom model name", value: "__custom__" }
  ]);
  const finalModel = model === "__custom__" ? await promptText("Model name:") : model;
  config.model = finalModel;
  saveProviderConfig({ ...config, model: finalModel });
  printOk("Local provider configuration saved.");
  printInfo(`Provider: ${config.name}`);
  printInfo(`Model:    ${finalModel}`);
  printInfo(`Endpoint: ${config.baseUrl}`);
}
function showConfig() {
  const config = loadProviderConfig();
  if (!config) {
    printWarning("No provider configured. Run `csage model` to set one up.");
    return;
  }
  printSection("Current Provider Configuration");
  printInfo(`ID:       ${config.id}`);
  printInfo(`Name:     ${config.name}`);
  printInfo(`Type:     ${config.type}`);
  printInfo(`Model:    ${config.model}`);
  printInfo(`Protocol: ${config.protocol}`);
  if (config.baseUrl) {
    printInfo(`Base URL: ${config.baseUrl}`);
  }
  const hasKey = loadApiKey(config.id);
  printInfo(`API Key:  ${hasKey ? theme.success("configured") : theme.warning("not set")}`);
}
function resetProviderConfig() {
  resetConfig();
  printOk("Provider configuration has been reset.");
}
async function testConnection() {
  const config = loadProviderConfig();
  if (!config) {
    printError("No provider configured. Run `csage model` to set one up.");
    process.exit(1);
  }
  const apiKey = loadApiKey(config.id);
  const resolvedConfig = apiKey ? { ...config, apiKey } : config;
  const llm = createProvider(resolvedConfig);
  const health = await withSpinner(`Testing ${config.name}\u2026`, () => llm.ping());
  if (health.ok) {
    printOk(`${config.name} is reachable (${health.latencyMs ?? 0}ms)`);
  } else {
    printError(`${config.name} unreachable: ${health.error ?? "unknown error"}`);
    process.exit(1);
  }
}
function createModelCommand() {
  const cmd = new Command("model").description("Configure the LLM provider").action(async () => {
    await setupWizard();
  });
  cmd.command("set").description("Interactive provider setup wizard").action(async () => {
    await setupWizard();
  });
  cmd.command("show").description("Display current provider configuration").action(() => {
    showConfig();
  });
  cmd.command("reset").description("Clear provider configuration").action(() => {
    resetProviderConfig();
  });
  cmd.command("test").description("Test current provider connection").action(async () => {
    await testConnection();
  });
  return cmd;
}

// src/cli/commands/tools.ts
import { Command as Command2 } from "commander";
import ora2 from "ora";

// src/utils/shell.ts
import { platform } from "os";
import { readFileSync, existsSync } from "fs";
function detectOs() {
  const p = platform();
  switch (p) {
    case "darwin":
      return "mac";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}
function detectWsl() {
  const procVersionPath = "/proc/version";
  if (!existsSync(procVersionPath)) {
    return false;
  }
  try {
    const content = readFileSync(procVersionPath, "utf-8");
    return /microsoft/i.test(content);
  } catch {
    return false;
  }
}
function detectShell(os) {
  const shellEnv = process.env["SHELL"] ?? "";
  if (shellEnv.endsWith("/zsh") || shellEnv.endsWith("/zsh5")) {
    return "zsh";
  }
  if (shellEnv.endsWith("/bash")) {
    return "bash";
  }
  if (os === "windows") {
    if (process.env["PSModulePath"]) {
      return "powershell";
    }
    const comSpec = (process.env["ComSpec"] ?? "").toLowerCase();
    if (comSpec.endsWith("cmd.exe")) {
      return "cmd";
    }
    return "powershell";
  }
  if (shellEnv.length > 0) {
    const basename = shellEnv.split("/").pop() ?? "";
    if (basename === "zsh") return "zsh";
    if (basename === "bash") return "bash";
  }
  return "unknown";
}
var _cached;
function getShellInfo() {
  if (_cached) {
    return _cached;
  }
  const os = detectOs();
  const isWsl = os === "linux" ? detectWsl() : false;
  const shell = detectShell(os);
  const info = Object.freeze({ os, isWsl, shell });
  _cached = info;
  return info;
}

// src/tools/registry.ts
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
function entry(category, linux, mac, win, documentationUrl) {
  return {
    category,
    installCommands: { linux, mac, win },
    documentationUrl
  };
}
var DEFAULT_TOOLS = /* @__PURE__ */ new Map([
  ["nmap", entry(
    "recon",
    "sudo apt-get install -y nmap",
    "brew install nmap",
    "winget install Insecure.Nmap",
    "https://nmap.org/docs.html"
  )],
  ["nikto", entry(
    "scanner",
    "sudo apt-get install -y nikto",
    "brew install nikto",
    "choco install nikto",
    "https://github.com/sullo/nikto/wiki"
  )],
  ["sqlmap", entry(
    "exploit",
    "sudo apt-get install -y sqlmap",
    "brew install sqlmap",
    "pip3 install sqlmap",
    "https://sqlmap.org/"
  )],
  ["gobuster", entry(
    "fuzzer",
    "sudo apt-get install -y gobuster",
    "brew install gobuster",
    "go install github.com/OJ/gobuster/v3@latest",
    "https://github.com/OJ/gobuster#readme"
  )],
  ["ffuf", entry(
    "fuzzer",
    "sudo apt-get install -y ffuf",
    "brew install ffuf",
    "go install github.com/ffuf/ffuf/v2@latest",
    "https://github.com/ffuf/ffuf#readme"
  )],
  ["wfuzz", entry(
    "fuzzer",
    "pip3 install wfuzz",
    "pip3 install wfuzz",
    "pip3 install wfuzz",
    "https://wfuzz.readthedocs.io/"
  )],
  ["hydra", entry(
    "brute-force",
    "sudo apt-get install -y hydra",
    "brew install hydra",
    "choco install thc-hydra",
    "https://github.com/vanhauser-thc/thc-hydra#readme"
  )],
  ["dirb", entry(
    "fuzzer",
    "sudo apt-get install -y dirb",
    "brew install dirb",
    "choco install dirb",
    "https://dirb.sourceforge.net/"
  )],
  ["dirsearch", entry(
    "fuzzer",
    "pip3 install dirsearch",
    "pip3 install dirsearch",
    "pip3 install dirsearch",
    "https://github.com/maurosoria/dirsearch#readme"
  )],
  ["sslyze", entry(
    "ssl",
    "pip3 install sslyze",
    "pip3 install sslyze",
    "pip3 install sslyze",
    "https://github.com/nabla-c0d3/sslyze#readme"
  )],
  ["testssl.sh", entry(
    "ssl",
    "sudo apt-get install -y testssl.sh",
    "brew install testssl",
    "choco install testssl",
    "https://testssl.sh/"
  )],
  ["semgrep", entry(
    "static",
    "pip3 install semgrep",
    "pip3 install semgrep",
    "pip3 install semgrep",
    "https://semgrep.dev/docs/"
  )],
  ["curl", entry(
    "recon",
    "sudo apt-get install -y curl",
    "brew install curl",
    "winget install cURL.cURL",
    "https://curl.se/docs/"
  )]
]);
function userToolsPath() {
  return join(homedir(), ".csage", "tools.json");
}
async function loadUserTools() {
  const map = /* @__PURE__ */ new Map();
  try {
    const raw = await readFile(userToolsPath(), "utf-8");
    const parsed = JSON.parse(raw);
    for (const [name, value] of Object.entries(parsed)) {
      map.set(name, {
        category: value.category,
        installCommands: value.installCommands,
        documentationUrl: value.documentationUrl
      });
    }
  } catch {
  }
  return map;
}
async function saveUserTools(tools) {
  const obj = {};
  for (const [name, value] of tools) {
    obj[name] = {
      category: value.category,
      installCommands: value.installCommands,
      documentationUrl: value.documentationUrl
    };
  }
  const dir = join(homedir(), ".csage");
  await mkdir(dir, { recursive: true });
  await writeFile(userToolsPath(), JSON.stringify(obj, null, 2), "utf-8");
}
var userToolCache;
async function ensureCache() {
  if (userToolCache === void 0) {
    userToolCache = await loadUserTools();
  }
  return userToolCache;
}
async function getToolEntry(name) {
  const cache = await ensureCache();
  return cache.get(name) ?? DEFAULT_TOOLS.get(name);
}
async function addTool(name, toolEntry) {
  const cache = await ensureCache();
  cache.set(name, toolEntry);
  await saveUserTools(cache);
}
async function removeTool(name) {
  const cache = await ensureCache();
  if (cache.has(name)) {
    cache.delete(name);
    await saveUserTools(cache);
  }
}
async function listTools() {
  const cache = await ensureCache();
  const merged = new Map(DEFAULT_TOOLS);
  for (const [name, value] of cache) {
    merged.set(name, value);
  }
  return Array.from(merged.entries()).map(([name, value]) => ({ name, entry: value }));
}
async function getInstaller(name, platform3) {
  const tool = await getToolEntry(name);
  if (tool === void 0) return void 0;
  const key = platform3 === "windows" ? "win" : platform3;
  return tool.installCommands[key];
}

// src/cli/commands/tools.ts
async function withSpinner2(text, fn) {
  const spinner = ora2({ text, color: "magenta" }).start();
  try {
    const result = await fn();
    spinner.succeed(theme.success(text));
    return result;
  } catch (error) {
    spinner.fail(theme.error(text));
    throw error;
  }
}
async function runListTools() {
  banner();
  printSection("Security Tool Registry");
  const tools = await listTools();
  if (tools.length === 0) {
    printInfo("No tools registered.");
    return;
  }
  for (const { name, entry: entry2 } of tools) {
    const installed = await isToolInstalled(name);
    const statusSymbol = installed ? theme.success("\u2713 installed") : theme.warning("\u2717 missing");
    console.log(`  ${theme.bold(name.padEnd(15))} [${entry2.category.padEnd(12)}]  ${statusSymbol}`);
    if (entry2.documentationUrl) {
      console.log(`    ${theme.dim("Docs:")} ${theme.dim(entry2.documentationUrl)}`);
    }
    const shellInfo = getShellInfo();
    const installer = entry2.installCommands[shellInfo.os === "windows" ? "win" : shellInfo.os];
    if (installer) {
      console.log(`    ${theme.dim("Install:")} ${theme.dim(installer)}`);
    }
    console.log("");
  }
}
async function runInstallTools(names) {
  banner();
  printSection("Installing Security Tools");
  const shellInfo = getShellInfo();
  const platform3 = shellInfo.os;
  for (const name of names) {
    const tool = await getToolEntry(name);
    if (!tool) {
      printError(`Unknown tool: "${name}". You can register it first using \`csage tools add\`.`);
      continue;
    }
    const alreadyInstalled = await isToolInstalled(name);
    if (alreadyInstalled) {
      printOk(`Tool "${name}" is already installed.`);
      continue;
    }
    const installer = await getInstaller(name, platform3);
    if (!installer) {
      printWarning(`No install command defined for "${name}" on ${platform3}.`);
      if (tool.documentationUrl) {
        printInfo(`Refer to documentation for manual setup: ${tool.documentationUrl}`);
      }
      continue;
    }
    printInfo(`Installing "${name}" via: ${theme.bold(installer)}`);
    try {
      const result = await withSpinner2(`Installing ${name}\u2026`, async () => {
        return executeCommand(installer);
      });
      if (result.success) {
        printOk(`Successfully installed "${name}"!`);
      } else {
        printError(`Failed to install "${name}": ${result.error ?? "unknown error"}`);
        if (result.stderr) {
          console.error(theme.dim(result.stderr));
        }
      }
    } catch (error) {
      printError(`Error running installation: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
async function runAddTool(name, installCommand, options) {
  const category = options.category;
  const docUrl = options.doc ?? "";
  const entry2 = {
    category,
    installCommands: {
      linux: installCommand,
      mac: installCommand,
      win: installCommand
    },
    documentationUrl: docUrl
  };
  await addTool(name, entry2);
  printOk(`Successfully added tool "${name}" to registry.`);
}
async function runRemoveTool(name) {
  const tool = await getToolEntry(name);
  if (!tool) {
    printError(`Tool "${name}" does not exist.`);
    return;
  }
  await removeTool(name);
  printOk(`Successfully removed tool "${name}" from registry.`);
}
function createToolsCommand() {
  const cmd = new Command2("tools").description("Manage external security tools").action(async () => {
    await runListTools();
  });
  cmd.command("list").description("List registered tools and their status").action(async () => {
    await runListTools();
  });
  cmd.command("install <tool...>").description("Attempt to install specified tools").action(async (names) => {
    await runInstallTools(names);
  });
  cmd.command("add <name> <command>").description("Add a custom tool to the registry").option("-c, --category <category>", "Tool category (recon, scanner, fuzzer, exploit, brute-force, ssl, static)", "recon").option("-d, --doc <url>", "Documentation URL").action(async (name, command, options) => {
    await runAddTool(name, command, options);
  });
  cmd.command("remove <name>").description("Remove a custom tool from the registry").action(async (name) => {
    await runRemoveTool(name);
  });
  return cmd;
}

// src/cli/commands/config.ts
import { Command as Command3 } from "commander";
import prompts2 from "prompts";
async function promptPassword2(message) {
  const response = await prompts2({ type: "password", name: "value", message });
  return typeof response.value === "string" ? response.value : "";
}
function showConfig2() {
  banner();
  printSection("Provider Configuration");
  const config = loadProviderConfig();
  if (!config) {
    printWarning("No provider configured. Run `csage model` to configure one.");
    return;
  }
  printInfo(`Active Provider: ${theme.bold(config.name)} (${config.id})`);
  printInfo(`Model:           ${config.model}`);
  printInfo(`Protocol:        ${config.protocol}`);
  if (config.baseUrl) {
    printInfo(`Base URL:        ${config.baseUrl}`);
  }
  const keys = listApiKeys();
  const hasKey = keys.some((k) => k.provider === config.id);
  printInfo(`API Key:         ${hasKey ? theme.success("configured") : theme.warning("not set")}`);
}
function showApiKeys() {
  banner();
  printSection("Stored API Keys");
  const keys = listApiKeys();
  if (keys.length === 0) {
    printInfo("No API keys currently stored.");
    return;
  }
  for (const { provider, maskedKey } of keys) {
    console.log(`  ${theme.bold(provider.padEnd(15))} : ${maskedKey}`);
  }
  console.log("");
}
async function setApiKey(provider, key) {
  const providerLower = provider.toLowerCase();
  let finalKey = key;
  if (!finalKey) {
    finalKey = await promptPassword2(`Enter API key for "${providerLower}":`);
  }
  if (!finalKey || !finalKey.trim()) {
    printError("API key cannot be empty.");
    return;
  }
  saveApiKey(providerLower, finalKey.trim());
  printOk(`API key for "${providerLower}" saved.`);
}
function removeProviderApiKey(provider) {
  const providerLower = provider.toLowerCase();
  const existing = loadApiKey(providerLower);
  if (!existing) {
    printWarning(`No API key found for "${providerLower}".`);
    return;
  }
  removeApiKey(providerLower);
  printOk(`API key for "${providerLower}" removed.`);
}
function createConfigCommand() {
  const cmd = new Command3("config").description("Manage CSage configuration and keys").action(() => {
    showConfig2();
  });
  cmd.command("show").description("Display current provider configuration").action(() => {
    showConfig2();
  });
  cmd.command("keys").description("List stored API keys (masked)").action(() => {
    showApiKeys();
  });
  cmd.command("keys-set <provider> [key]").description("Set API key for a provider (prompts if key omitted)").action(async (provider, key) => {
    await setApiKey(provider, key);
  });
  cmd.command("keys-remove <provider>").description("Remove API key for a provider").action((provider) => {
    removeProviderApiKey(provider);
  });
  return cmd;
}

// src/cli/commands/logs.ts
import { Command as Command4 } from "commander";
import { readFileSync as readFileSync3, existsSync as existsSync3 } from "fs";
import { join as join3 } from "path";

// src/storage/chain-logger.ts
import {
  existsSync as existsSync2,
  mkdirSync,
  readFileSync as readFileSync2,
  appendFileSync,
  readdirSync
} from "fs";
import { join as join2 } from "path";

// src/utils/crypto.ts
import { createHmac, createHash, randomBytes } from "crypto";
import { hostname, platform as platform2 } from "os";
function computeHmac(key, prevHash, data) {
  return createHmac("sha256", key).update(prevHash).update(data).digest("hex");
}
function generateKey() {
  return randomBytes(32);
}

// src/utils/text.ts
var SECRET_KEYWORDS = [
  "key",
  "token",
  "secret",
  "password",
  "passwd",
  "api_key",
  "apikey",
  "api-key",
  "auth",
  "bearer",
  "credential",
  "private",
  "access_token",
  "refresh_token",
  "client_secret",
  "session",
  "jwt",
  "authorization"
];
var SECRET_PATTERN = new RegExp(
  `((?:${SECRET_KEYWORDS.join("|")})[\\w-]*)\\s*[=:]\\s*(['"]?)([^\\s'"]+)\\2`,
  "gi"
);
var SENSITIVE_FLAGS = [
  "-H",
  "--header",
  "--password",
  "--passwd",
  "--token",
  "--api-key",
  "--apikey",
  "--secret",
  "--auth",
  "--authorization",
  "--credential",
  "--private-key",
  "--client-secret",
  "--access-token",
  "--refresh-token"
];
var SENSITIVE_FLAG_RE = new RegExp(
  `(${SENSITIVE_FLAGS.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:[=\\s]+)(['"]?)([^\\s'"]+)\\2`,
  "gi"
);

// src/storage/chain-logger.ts
var GENESIS_SENTINEL = "CODESAGE_GENESIS";
var LOG_KEY_ENV_NAME = "CSAGE_LOG";
var LOGS_DIR_NAME = "logs";
function getOrCreateLogKey() {
  const existing = loadApiKey(LOG_KEY_ENV_NAME);
  if (existing) {
    try {
      return Buffer.from(existing, "hex");
    } catch {
    }
  }
  const key = generateKey();
  saveApiKey(LOG_KEY_ENV_NAME, key.toString("hex"));
  return key;
}
function logsDir() {
  const dir = join2(getConfigDir(), LOGS_DIR_NAME);
  if (!existsSync2(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
function logFilePath(sessionId) {
  return join2(logsDir(), `${sessionId}.jsonl`);
}
function genesisHash(key) {
  return computeHmac(key, "", GENESIS_SENTINEL);
}
function computeEntryHmac(key, prevHash, entryWithoutHash) {
  const payload = prevHash + JSON.stringify(entryWithoutHash, Object.keys(entryWithoutHash).sort());
  return computeHmac(key, "", payload);
}
function verifyLog(sessionId) {
  const filePath = logFilePath(sessionId);
  if (!existsSync2(filePath)) {
    return { ok: false, message: `Log file not found: ${filePath}` };
  }
  const key = getOrCreateLogKey();
  const content = readFileSync2(filePath, "utf-8");
  const lines = content.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { ok: true, message: "Log is empty." };
  }
  const genesis = genesisHash(key);
  let prevHash = genesis;
  for (let i = 0; i < lines.length; i++) {
    let entry2;
    try {
      entry2 = JSON.parse(lines[i]);
    } catch {
      return {
        ok: false,
        message: `Entry ${i + 1}: JSON parse error \u2014 log may be corrupted.`
      };
    }
    const storedHash = entry2["hash"];
    const storedPrev = entry2["prev_hash"];
    if (typeof storedHash !== "string" || typeof storedPrev !== "string") {
      return {
        ok: false,
        message: `Entry ${i + 1}: missing hash or prev_hash field.`
      };
    }
    const expectedPrev = i === 0 ? genesis : prevHash;
    if (storedPrev !== expectedPrev) {
      const entryType = typeof entry2["type"] === "string" ? entry2["type"] : "?";
      const entryTs = typeof entry2["timestamp"] === "string" ? entry2["timestamp"] : "?";
      return {
        ok: false,
        message: `Entry ${i + 1} (${entryType} at ${entryTs}): prev_hash mismatch \u2014 chain broken here.`
      };
    }
    const checkData = {};
    for (const [k, v] of Object.entries(entry2)) {
      if (k !== "hash") {
        checkData[k] = v;
      }
    }
    const expectedHash = computeEntryHmac(key, storedPrev, checkData);
    if (storedHash !== expectedHash) {
      const entryType = typeof entry2["type"] === "string" ? entry2["type"] : "?";
      const entryTs = typeof entry2["timestamp"] === "string" ? entry2["timestamp"] : "?";
      return {
        ok: false,
        message: `Entry ${i + 1} (${entryType} at ${entryTs}): HMAC mismatch \u2014 this entry was tampered with.`
      };
    }
    prevHash = storedHash;
  }
  return {
    ok: true,
    message: `\u2713 All ${lines.length} entries verified \u2014 log integrity intact.`
  };
}
function listSessions() {
  const dir = join2(getConfigDir(), LOGS_DIR_NAME);
  if (!existsSync2(dir)) {
    return [];
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort().reverse();
  const sessions = [];
  for (const file of files) {
    const filePath = join2(dir, file);
    const content = readFileSync2(filePath, "utf-8");
    const lines = content.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    try {
      const first = JSON.parse(lines[0]);
      const last = JSON.parse(lines[lines.length - 1]);
      sessions.push({
        sessionId: file.replace(".jsonl", ""),
        started: typeof first["timestamp"] === "string" ? first["timestamp"] : "?",
        ended: typeof last["timestamp"] === "string" ? last["timestamp"] : "?",
        entries: lines.length,
        lastType: typeof last["type"] === "string" ? last["type"] : "?"
      });
    } catch {
    }
  }
  return sessions;
}

// src/cli/commands/logs.ts
function runListSessions() {
  banner();
  printSection("Recent Security Assessment Sessions");
  const sessions = listSessions();
  if (sessions.length === 0) {
    printInfo("No logged sessions found.");
    return;
  }
  for (const s of sessions) {
    const startedDate = new Date(s.started).toLocaleString();
    const durationText = s.lastType === "session_end" ? "completed" : "active/interrupted";
    console.log(`  Session ID: ${theme.bold(s.sessionId)}`);
    console.log(`    Started : ${startedDate}`);
    console.log(`    Entries : ${s.entries} logs (${durationText})`);
    console.log("");
  }
}
function runShowSession(sessionId) {
  banner();
  printSection(`Session Log: ${sessionId}`);
  const logsDir2 = join3(getConfigDir(), "logs");
  const filePath = join3(logsDir2, `${sessionId}.jsonl`);
  if (!existsSync3(filePath)) {
    printError(`Log file for session "${sessionId}" not found.`);
    return;
  }
  const content = readFileSync3(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    printInfo("Log file is empty.");
    return;
  }
  for (let i = 0; i < lines.length; i++) {
    try {
      const entry2 = JSON.parse(lines[i]);
      const time = new Date(entry2["timestamp"]).toLocaleTimeString();
      const type = entry2["type"];
      console.log(theme.dim(`[${time}] [${type.toUpperCase()}]`));
      if (type === "session_start") {
        console.log(`  Target Path : ${entry2["target_path"] || "N/A"}`);
        console.log(`  Target URL  : ${entry2["target_url"] || "N/A"}`);
        console.log(`  Model       : ${entry2["model"]}`);
        console.log(`  Scope       : ${entry2["scope"]}`);
      } else if (type === "command") {
        const cmd = entry2["command"];
        const risk = entry2["risk_level"];
        const ran = entry2["ran"];
        const success = entry2["success"];
        const status = ran ? success ? theme.success("SUCCESS") : theme.error("FAILED") : theme.dim("SKIPPED");
        console.log(`  Command : ${theme.bold(cmd)}`);
        console.log(`  Risk    : ${risk}`);
        console.log(`  Status  : ${status}`);
      } else if (type === "finding") {
        const name = entry2["name"];
        const severity = entry2["severity"];
        const loc = entry2["location"];
        const sevColor = theme.severity[severity] ?? theme.dim;
        console.log(`  Finding  : ${theme.bold(name)}`);
        console.log(`  Severity : ${sevColor(severity)}`);
        console.log(`  Location : ${loc}`);
      } else if (type === "session_end") {
        console.log(`  Findings Discovered : ${entry2["findings_count"]}`);
        console.log(`  Duration (seconds)  : ${entry2["duration_seconds"]}`);
      } else {
        console.log(`  Data: ${JSON.stringify(entry2, null, 2)}`);
      }
      console.log("");
    } catch {
      printWarning(`Entry ${i + 1}: Failed to parse JSON line.`);
    }
  }
}
function runVerifySession(sessionId) {
  banner();
  if (sessionId) {
    printSection(`Verifying Session Log: ${sessionId}`);
    const result = verifyLog(sessionId);
    if (result.ok) {
      printOk(result.message);
    } else {
      printError(result.message);
      printWarning("Log integrity check FAILED. The log file has been modified or tampered with!");
      process.exit(1);
    }
  } else {
    printSection("Verifying All Session Logs");
    const sessions = listSessions();
    if (sessions.length === 0) {
      printInfo("No logged sessions to verify.");
      return;
    }
    let allOk = true;
    for (const s of sessions) {
      const result = verifyLog(s.sessionId);
      if (result.ok) {
        printOk(`${s.sessionId}: Integrity intact.`);
      } else {
        printError(`${s.sessionId}: Verification FAILED!`);
        console.error(`    Reason: ${result.message}`);
        allOk = false;
      }
    }
    if (allOk) {
      printOk("All session logs verified successfully.");
    } else {
      printError("Some session logs failed integrity checks!");
      process.exit(1);
    }
  }
}
function createLogsCommand() {
  const cmd = new Command4("logs").description("View and verify session logs").action(() => {
    runListSessions();
  });
  cmd.command("list").description("List summaries of recent sessions").action(() => {
    runListSessions();
  });
  cmd.command("show <sessionId>").description("Display detailed entries for a session").action((sessionId) => {
    runShowSession(sessionId);
  });
  cmd.command("verify [sessionId]").description("Verify HMAC chain integrity of session log(s)").action((sessionId) => {
    runVerifySession(sessionId);
  });
  return cmd;
}

// src/cli/commands/reset.ts
import { Command as Command5 } from "commander";
import { rmSync, existsSync as existsSync4 } from "fs";
import prompts3 from "prompts";
async function promptText2(message, initial) {
  const response = await prompts3({ type: "text", name: "value", message, initial });
  return typeof response.value === "string" ? response.value : "";
}
async function runFactoryReset() {
  banner();
  printSection("Factory Reset CSage");
  const configDir = getConfigDir();
  printWarning(`This will delete the entire configuration directory: ${configDir}`);
  printWarning("All saved configurations, API keys, custom tools, and logs will be permanently deleted.");
  console.log("");
  const confirmText = await promptText2(
    'To confirm, type "RESET" (in all caps):'
  );
  if (confirmText !== "RESET") {
    printInfo("Reset cancelled. No files were deleted.");
    return;
  }
  if (existsSync4(configDir)) {
    try {
      rmSync(configDir, { recursive: true, force: true });
      printOk("Factory reset complete. CSage is now in its default state.");
    } catch (error) {
      printError(`Failed to delete configuration directory: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  } else {
    printInfo("Configuration directory does not exist. Nothing to clear.");
  }
}
function createResetCommand() {
  const cmd = new Command5("reset").description("Factory reset CSage (deletes all config, keys, logs, and custom tools)").action(async () => {
    await runFactoryReset();
  });
  return cmd;
}

// src/cli/index.ts
function createProgram() {
  const program2 = new Command6("csage").description("CSage - The AI Security Navigator").version("2.0.0").option("--verbose", "Enable verbose logging").option("--debug", "Enable debug mode").action(async () => {
    try {
      const repl = await import("./repl-MTOQNYWC.js");
      await repl.startREPL();
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
  program2.addCommand(createModelCommand());
  program2.addCommand(createToolsCommand());
  program2.addCommand(createConfigCommand());
  program2.addCommand(createLogsCommand());
  program2.addCommand(createResetCommand());
  return program2;
}

// src/index.ts
var program = createProgram();
program.parse(process.argv);
//# sourceMappingURL=index.js.map