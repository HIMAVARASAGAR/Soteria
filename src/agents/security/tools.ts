/**
 * @module agents/security/tools
 * Security-agent tool definitions and runtime handlers.
 */

import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

import type { ToolDefinition } from '../../types/provider.js';
import type { ToolHandler } from '../../runtime/tool-router.js';
import { executeCommand } from '../../tools/executor.js';
import { sanitizeCommandOutput } from '../../security/sanitizer.js';
import { FindingSchema } from '../../types/findings.js';

/** Build provider-visible security tool definitions for a scope. */
export function getSecurityToolDefinitions(_scope: string): ToolDefinition[] {
  return [
    {
      name: 'shell_exec',
      description: 'Execute a shell command for security testing',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          timeout: { type: 'number' },
        },
        required: ['command'],
      },
    },
    {
      name: 'read_file',
      description: 'Read a file from the target project',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
    },
    {
      name: 'list_directory',
      description: 'List a directory in the target project',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
    },
    {
      name: 'report_finding',
      description: 'Record a discovered security finding',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] },
          location: { type: 'string' },
          what: { type: 'string' },
          impact: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['name', 'severity', 'location', 'what'],
      },
    },
  ];
}

/** Build security tool handlers bound to an optional target path. */
export function buildSecurityToolHandlers(targetPath?: string): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  handlers.set('shell_exec', async (args) => {
    const command = typeof args.command === 'string' ? args.command : '';
    const timeout = typeof args.timeout === 'number' ? args.timeout : undefined;
    if (command.length === 0) {
      return { output: 'Missing command', success: false };
    }
    const result = await executeCommand(command, {
      ...(timeout !== undefined && { timeout }),
      ...(targetPath && { cwd: targetPath }),
    });
    const output = sanitizeCommandOutput(
      result.stdout + (result.stderr ? `\n${result.stderr}` : '') + (result.error ? `\n${result.error}` : ''),
    );
    return { output, success: result.success };
  });

  handlers.set('read_file', async (args) => {
    if (!targetPath) {
      return { output: 'No target path is set', success: false };
    }
    const requestedPath = typeof args.path === 'string' ? args.path : '';
    const resolvedPath = resolveTargetPath(targetPath, requestedPath);
    if (!resolvedPath.allowed) {
      return { output: resolvedPath.reason, success: false };
    }
    const content = await readFile(resolvedPath.path, 'utf-8');
    return { output: content, success: true };
  });

  handlers.set('list_directory', async (args) => {
    if (!targetPath) {
      return { output: 'No target path is set', success: false };
    }
    const requestedPath = typeof args.path === 'string' ? args.path : '.';
    const resolvedPath = resolveTargetPath(targetPath, requestedPath);
    if (!resolvedPath.allowed) {
      return { output: resolvedPath.reason, success: false };
    }
    const entries = await readdir(resolvedPath.path, { withFileTypes: true });
    const output = entries
      .map((entry) => `${entry.isDirectory() ? 'd' : '-'} ${entry.name}`)
      .join('\n');
    return { output, success: true };
  });

  handlers.set('report_finding', async (args) => {
    const parsed = FindingSchema.safeParse(args);
    if (!parsed.success) {
      return { output: parsed.error.message, success: false };
    }
    return {
      output: `Finding recorded: [${parsed.data.severity}] ${parsed.data.name} at ${parsed.data.location}`,
      success: true,
      metadata: { finding: parsed.data },
    };
  });

  return handlers;
}

type ResolvedTargetPath =
  | { readonly allowed: true; readonly path: string }
  | { readonly allowed: false; readonly reason: string };

function resolveTargetPath(rootPath: string, requestedPath: string): ResolvedTargetPath {
  const root = resolve(rootPath);
  const candidate = resolve(root, requestedPath || '.');
  const rel = relative(root, candidate);
  if (rel.startsWith('..') || rel === '..') {
    return { allowed: false, reason: 'Path escapes target root' };
  }
  return { allowed: true, path: candidate };
}
