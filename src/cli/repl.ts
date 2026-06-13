/**
 * @module cli/repl
 * Streaming REPL entry point for the runtime-backed security agent.
 */

import readline from 'node:readline';
import prompts from 'prompts';

import { SecurityAgent } from '../agents/security/agent.js';
import { StreamRenderer } from './renderer.js';
import { theme } from './ui/theme.js';
import { loadProviderConfig } from '../storage/config.js';
import { loadApiKey } from '../storage/keychain.js';
import { createProvider } from '../providers/registry.js';
import type { LLMProvider } from '../providers/types.js';
import { ScopeSchema, type Scope, type Target } from '../types/agent.js';
import type { Finding } from '../types/findings.js';

/** Start the interactive streaming REPL. */
export async function startREPL(): Promise<void> {
  const renderer = new StreamRenderer();
  renderer.showBanner();

  const config = loadProviderConfig();
  if (!config) {
    console.error(theme.error('No provider configured. Run `csage model` first.'));
    return;
  }

  const apiKey = loadApiKey(config.id);
  const provider = createProvider(apiKey ? { ...config, apiKey } : config);
  const health = await provider.ping();
  if (!health.ok) {
    console.error(theme.error(`Provider unavailable: ${health.error ?? 'unknown error'}`));
    return;
  }

  console.log(theme.dim(`${provider.name} / ${config.model} (${health.latencyMs ?? 0}ms)`));
  console.log(theme.dim('Use /target <url|path> to begin, /help for commands.'));
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: theme.prompt('> '),
  });

  let agent: SecurityAgent | null = null;
  let isRunning = false;
  let ctrlCCount = 0;
  let scope: Scope = 'all';

  const subscribe = (nextAgent: SecurityAgent): void => {
    nextAgent.events.removeAll();
    nextAgent.events.on((event) => {
      if (event.type === 'text') renderer.streamText(event.content);
      if (event.type === 'tool_call') renderer.showToolCall(event);
      if (event.type === 'tool_result') renderer.showToolResult(event);
      if (event.type === 'iteration') renderer.showIteration(event);
      if (event.type === 'error') renderer.showError(event.error);
      if (event.type === 'done') {
        renderer.finalize();
        isRunning = false;
        ctrlCCount = 0;
        rl.prompt();
      }
    });
  };

  rl.on('SIGINT', () => {
    if (isRunning && agent && ctrlCCount === 0) {
      ctrlCCount += 1;
      agent.cancel();
      renderer.showInterrupted();
      return;
    }
    process.exit(0);
  });

  rl.on('line', (line) => {
    void (async () => {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        rl.prompt();
        return;
      }

      if (trimmed.startsWith('/')) {
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
          },
        });
        if (!result.startedRun) {
          rl.prompt();
        }
        return;
      }

      if (!agent) {
        console.log(theme.warning('No target is set. Use /target <url|path>.'));
        rl.prompt();
        return;
      }

      isRunning = true;
      ctrlCCount = 0;
      await agent.run(trimmed);
    })().catch((error: unknown) => {
      isRunning = false;
      renderer.showError(error instanceof Error ? error : new Error(String(error)));
      rl.prompt();
    });
  });

  rl.prompt();
}

interface SlashContext {
  readonly agent: SecurityAgent | null;
  readonly setAgent: (agent: SecurityAgent) => void;
  readonly renderer: StreamRenderer;
  readonly rl: readline.Interface;
  readonly provider: LLMProvider;
  readonly getScope: () => Scope;
  readonly setScope: (scope: Scope) => void;
  readonly setRunning: (running: boolean) => void;
}

interface SlashResult {
  readonly startedRun: boolean;
}

async function handleSlashCommand(input: string, context: SlashContext): Promise<SlashResult> {
  const [command, ...rest] = input.split(/\s+/);
  const arg = rest.join(' ');

  if (command === '/help') {
    showHelp();
    return { startedRun: false };
  }

  if (command === '/target') {
    if (arg.length === 0) {
      console.log(theme.warning('Usage: /target <url|path>'));
      return { startedRun: false };
    }
    const confirmed = await promptOwnership(arg);
    if (!confirmed) {
      console.log(theme.dim('Target not set.'));
      return { startedRun: false };
    }
    const target = buildTarget(arg, context.getScope());
    const nextAgent = new SecurityAgent({
      provider: context.provider,
      target,
      scope: context.getScope(),
      approvalPromptFn: (_call, risk, reason) => context.renderer.promptApproval(risk, reason),
    });
    context.setAgent(nextAgent);
    const staticFindings = await nextAgent.initialize();
    console.log(theme.success(`Target set: ${arg}`));
    if (staticFindings.length > 0) {
      console.log(theme.warning(`Static scanner found ${staticFindings.length} potential issue(s).`));
    }
    return { startedRun: false };
  }

  if (command === '/findings') {
    showFindings(context.agent);
    return { startedRun: false };
  }

  if (command === '/history') {
    showHistory(context.agent);
    return { startedRun: false };
  }

  if (command === '/clear') {
    context.agent?.runtime.reset();
    console.log(theme.dim('Conversation cleared.'));
    return { startedRun: false };
  }

  if (command === '/model') {
    console.log(theme.dim('Run `csage model` outside the REPL to change provider settings.'));
    return { startedRun: false };
  }

  if (command === '/tools') {
    console.log(theme.dim('Run `csage tools` outside the REPL to manage tool installation.'));
    return { startedRun: false };
  }

  if (command === '/scope') {
    if (arg.length === 0) {
      console.log(theme.dim(`Current scope: ${context.getScope()}`));
      return { startedRun: false };
    }
    const parsed = ScopeSchema.safeParse(arg);
    if (!parsed.success) {
      console.log(theme.warning(`Invalid scope. Valid scopes: ${ScopeSchema.options.join(', ')}`));
      return { startedRun: false };
    }
    context.setScope(parsed.data);
    console.log(theme.success(`Scope set: ${parsed.data}`));
    return { startedRun: false };
  }

  if (command === '/report') {
    if (!context.agent) {
      console.log(theme.warning('No target is set. Use /target <url|path>.'));
      return { startedRun: false };
    }
    context.setRunning(true);
    await context.agent.run('Generate a comprehensive security assessment report');
    return { startedRun: true };
  }

  if (command === '/quit' || command === '/exit') {
    console.log(theme.dim('Goodbye.'));
    process.exit(0);
  }

  console.log(theme.warning(`Unknown command: ${command}`));
  return { startedRun: false };
}

function buildTarget(value: string, scope: Scope): Target {
  try {
    const url = new URL(value);
    return { url: url.toString(), scope };
  } catch {
    return { path: value, scope };
  }
}

async function promptOwnership(target: string): Promise<boolean> {
  console.log('');
  console.log(theme.warning(`Only proceed if you have authorization to test: ${target}`));
  const response = await prompts({
    type: 'confirm',
    name: 'value',
    message: 'I confirm I have authorization to test this target',
    initial: false,
  });
  return response.value === true;
}

function showHelp(): void {
  console.log('');
  console.log(`${theme.slash('/target <url|path>')}  Set the assessment target`);
  console.log(`${theme.slash('/scope <scope>')}      Show or change scope`);
  console.log(`${theme.slash('/history')}            Show tool execution history`);
  console.log(`${theme.slash('/findings')}           Show reported findings`);
  console.log(`${theme.slash('/clear')}              Clear conversation`);
  console.log(`${theme.slash('/report')}             Generate final report`);
  console.log(`${theme.slash('/model')}              Provider setup hint`);
  console.log(`${theme.slash('/tools')}              Tool setup hint`);
  console.log(`${theme.slash('/quit')}               Exit`);
  console.log('');
}

function showHistory(agent: SecurityAgent | null): void {
  if (!agent) {
    console.log(theme.warning('No active agent.'));
    return;
  }
  const history = agent.getHistory();
  if (history.length === 0) {
    console.log(theme.dim('No tool executions yet.'));
    return;
  }
  for (const exec of history) {
    console.log(`${exec.status.padEnd(10)} ${exec.name} ${exec.durationMs ?? 0}ms`);
  }
}

function showFindings(agent: SecurityAgent | null): void {
  if (!agent) {
    console.log(theme.warning('No active agent.'));
    return;
  }
  const findings = agent.getHistory()
    .map((exec) => exec.metadata?.finding)
    .filter((finding): finding is Finding => isFinding(finding));
  if (findings.length === 0) {
    console.log(theme.dim('No reported findings yet.'));
    return;
  }
  for (const finding of findings) {
    console.log(`[${finding.severity}] ${finding.name} - ${finding.location}`);
  }
}

function isFinding(value: unknown): value is Finding {
  return (
    !!value &&
    typeof value === 'object' &&
    'name' in value &&
    'severity' in value &&
    'location' in value &&
    'what' in value
  );
}
