/**
 * @module cli/commands/logs
 * The `csage logs` command — view and verify HMAC tamper-evident session logs.
 *
 * Subcommands:
 * - `logs list` (default) — list recent sessions
 * - `logs show <sessionId>` — display session log details
 * - `logs verify [sessionId]` — verify integrity of a session log (or all if omitted)
 */

import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  banner,
  printSection,
  printInfo,
  printError,
  printOk,
  printWarning,
} from '../ui/print.js';
import { theme } from '../ui/theme.js';
import {
  listSessions,
  verifyLog,
} from '../../storage/chain-logger.js';
import { getConfigDir } from '../../storage/config.js';

// ─── Subcommands ─────────────────────────────────────────────────────────────

/**
 * List summaries of recent sessions.
 */
function runListSessions(): void {
  banner();
  printSection('Recent Security Assessment Sessions');

  const sessions = listSessions();
  if (sessions.length === 0) {
    printInfo('No logged sessions found.');
    return;
  }

  for (const s of sessions) {
    const startedDate = new Date(s.started).toLocaleString();
    const durationText = s.lastType === 'session_end' ? 'completed' : 'active/interrupted';
    console.log(`  Session ID: ${theme.bold(s.sessionId)}`);
    console.log(`    Started : ${startedDate}`);
    console.log(`    Entries : ${s.entries} logs (${durationText})`);
    console.log('');
  }
}

/**
 * Display all entries in a session log file.
 *
 * @param sessionId - Session identifier.
 */
function runShowSession(sessionId: string): void {
  banner();
  printSection(`Session Log: ${sessionId}`);

  const logsDir = join(getConfigDir(), 'logs');
  const filePath = join(logsDir, `${sessionId}.jsonl`);

  if (!existsSync(filePath)) {
    printError(`Log file for session "${sessionId}" not found.`);
    return;
  }

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    printInfo('Log file is empty.');
    return;
  }

  for (let i = 0; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i]!) as Record<string, unknown>;
      const time = new Date(entry['timestamp'] as string).toLocaleTimeString();
      const type = entry['type'] as string;

      console.log(theme.dim(`[${time}] [${type.toUpperCase()}]`));

      if (type === 'session_start') {
        console.log(`  Target Path : ${entry['target_path'] || 'N/A'}`);
        console.log(`  Target URL  : ${entry['target_url'] || 'N/A'}`);
        console.log(`  Model       : ${entry['model']}`);
        console.log(`  Scope       : ${entry['scope']}`);
      } else if (type === 'command') {
        const cmd = entry['command'] as string;
        const risk = entry['risk_level'] as string;
        const ran = entry['ran'] as boolean;
        const success = entry['success'] as boolean;
        const status = ran
          ? (success ? theme.success('SUCCESS') : theme.error('FAILED'))
          : theme.dim('SKIPPED');
        console.log(`  Command : ${theme.bold(cmd)}`);
        console.log(`  Risk    : ${risk}`);
        console.log(`  Status  : ${status}`);
      } else if (type === 'finding') {
        const name = entry['name'] as string;
        const severity = entry['severity'] as string;
        const loc = entry['location'] as string;
        const sevColor = theme.severity[severity] ?? theme.dim;
        console.log(`  Finding  : ${theme.bold(name)}`);
        console.log(`  Severity : ${sevColor(severity)}`);
        console.log(`  Location : ${loc}`);
      } else if (type === 'session_end') {
        console.log(`  Findings Discovered : ${entry['findings_count']}`);
        console.log(`  Duration (seconds)  : ${entry['duration_seconds']}`);
      } else {
        // Fallback for custom entry types
        console.log(`  Data: ${JSON.stringify(entry, null, 2)}`);
      }
      console.log('');
    } catch {
      printWarning(`Entry ${i + 1}: Failed to parse JSON line.`);
    }
  }
}

/**
 * Verify HMAC chain integrity for one or all session logs.
 *
 * @param sessionId - Optional session identifier.
 */
function runVerifySession(sessionId?: string): void {
  banner();

  if (sessionId) {
    printSection(`Verifying Session Log: ${sessionId}`);
    const result = verifyLog(sessionId);
    if (result.ok) {
      printOk(result.message);
    } else {
      printError(result.message);
      printWarning('Log integrity check FAILED. The log file has been modified or tampered with!');
      process.exit(1);
    }
  } else {
    printSection('Verifying All Session Logs');
    const sessions = listSessions();
    if (sessions.length === 0) {
      printInfo('No logged sessions to verify.');
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
      printOk('All session logs verified successfully.');
    } else {
      printError('Some session logs failed integrity checks!');
      process.exit(1);
    }
  }
}

// ─── Command Definition ──────────────────────────────────────────────────────

/**
 * Create the `csage logs` command with subcommands.
 *
 * @returns A configured Commander command.
 */
export function createLogsCommand(): Command {
  const cmd = new Command('logs')
    .description('View and verify session logs')
    .action(() => {
      runListSessions();
    });

  cmd
    .command('list')
    .description('List summaries of recent sessions')
    .action(() => {
      runListSessions();
    });

  cmd
    .command('show <sessionId>')
    .description('Display detailed entries for a session')
    .action((sessionId: string) => {
      runShowSession(sessionId);
    });

  cmd
    .command('verify [sessionId]')
    .description('Verify HMAC chain integrity of session log(s)')
    .action((sessionId?: string) => {
      runVerifySession(sessionId);
    });

  return cmd;
}
