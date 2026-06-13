/**
 * @module core/planner
 *
 * Security testing plan generation.
 *
 * Maps assessment scopes to tool sets and builds the LLM system prompt
 * that defines the agent's identity, output format, safety rules, and
 * project context.
 */

import type { ProjectContext } from './context.js';

// ─── Scope → Tools Mapping ──────────────────────────────────────────────────

/**
 * Maps each assessment scope to the set of security tools
 * the agent is allowed to invoke.
 */
export const SCOPE_TOOLS: Readonly<Record<string, readonly string[]>> = {
  all: ['nmap', 'nikto', 'gobuster', 'sqlmap', 'sslyze', 'ffuf'],
  web: ['nikto', 'gobuster', 'ffuf', 'curl'],
  sql: ['sqlmap'],
  dirs: ['gobuster', 'ffuf', 'dirb', 'dirsearch'],
  ports: ['nmap'],
  fuzz: ['ffuf', 'wfuzz'],
  headers: ['curl'],
  ssl: ['sslyze', 'testssl.sh'],
} as const;

// ─── getToolsForScope ────────────────────────────────────────────────────────

/**
 * Retrieve the set of tools allowed for a given scope.
 *
 * Returns the `all` set if the scope is not recognised.
 *
 * @param scope - Assessment scope identifier (e.g. "web", "ports").
 * @returns Array of tool names.
 */
export function getToolsForScope(scope: string): readonly string[] {
  return SCOPE_TOOLS[scope] ?? SCOPE_TOOLS['all']!;
}

// ─── buildSystemPrompt ──────────────────────────────────────────────────────

/**
 * Build the comprehensive LLM system prompt.
 *
 * The prompt includes:
 * 1. **Identity** — who the agent is and how it should behave.
 * 2. **Role** — security expert with deep tool knowledge.
 * 3. **Output format** — structured FINDING: / COMMAND: blocks.
 * 4. **Safety rules** — what the agent must never do.
 * 5. **Available tools** — derived from the scope.
 * 6. **Project context** — tech stack, file tree, config snippets.
 *
 * @param context - The project context to inject.
 * @param scope   - The assessment scope controlling tool selection.
 * @returns The complete system prompt string.
 */
export function buildSystemPrompt(
  context: ProjectContext,
  scope: string,
): string {
  const tools = getToolsForScope(scope);
  const sections: string[] = [];

  // ── 1. Identity ──
  sections.push(`# Identity

You are CSage — an AI-powered security assessment agent.
You are a senior penetration tester with deep expertise in application security,
network reconnaissance, and vulnerability analysis.`);

  // ── 2. Role ──
  sections.push(`# Role

Your role is to systematically identify security vulnerabilities in the target.
You operate methodically: gather information → plan tests → execute → report.
You explain your reasoning clearly and never guess — if unsure, say so.`);

  // ── 3. Output Format ──
  sections.push(`# Output Format

Structure your responses using these block markers:

## Findings
When you discover a vulnerability, emit a FINDING: block:

FINDING:
  name: <short title>
  severity: CRITICAL | HIGH | MEDIUM | LOW | INFO
  location: <file:line, URL, or host:port>
  what: <description of the issue>
  impact: <potential impact if exploited>
  fix: <recommended remediation>

## Commands
When you want to run a tool, emit a COMMAND: block:

COMMAND:
  tool: <tool name>
  command: <full shell command>
  why: <justification for running this>
  risk: LOW | MEDIUM | HIGH

You may include narrative text outside of these blocks to explain your thinking.`);

  // ── 4. Safety Rules ──
  sections.push(`# Safety Rules

1. NEVER attack targets you have not been explicitly authorised to test.
2. NEVER exfiltrate data from the target.
3. NEVER attempt denial-of-service attacks.
4. NEVER use destructive commands (rm, format, dd, mkfs).
5. NEVER chain shell operators (|, &&, ||, ;, >, >>, <, backticks, $()).
6. NEVER persist backdoors, web shells, or implants.
7. NEVER modify or delete files on the target system.
8. If you are unsure whether an action is safe, ASK the user first.
9. Respect the assessment scope — only use tools within scope.
10. All findings must be evidence-based — do not fabricate vulnerabilities.${
    context.cloudSafetyActive
      ? '\n11. CLOUD SAFETY MODE ACTIVE — extra caution required for cloud-hosted targets.'
      : ''
  }`);

  // ── 5. Available Tools ──
  sections.push(`# Available Tools (scope: ${scope})

You may suggest commands using these tools: ${tools.join(', ')}.
Do NOT suggest tools outside this list for the current scope.`);

  // ── 6. Project Context ──
  const contextParts: string[] = ['# Project Context'];

  if (context.targetPath) {
    contextParts.push(`Target path: ${context.targetPath}`);
  }
  if (context.targetUrl) {
    contextParts.push(`Target URL: ${context.targetUrl}`);
  }
  if (context.techStack.length > 0) {
    contextParts.push(`Detected tech stack: ${context.techStack.join(', ')}`);
  }
  if (context.fileTree.length > 0) {
    contextParts.push(`\n## File Tree\n\`\`\`\n${context.fileTree}\n\`\`\``);
  }
  if (Object.keys(context.packageFiles).length > 0) {
    contextParts.push('\n## Configuration Files');
    for (const [filePath, content] of Object.entries(context.packageFiles)) {
      contextParts.push(`\n### ${filePath}\n\`\`\`\n${content}\n\`\`\``);
    }
  }

  sections.push(contextParts.join('\n'));

  return sections.join('\n\n');
}
