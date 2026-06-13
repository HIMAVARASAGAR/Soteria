/**
 * @module agents/security/prompts
 * Security-agent system prompt construction.
 */

import type { ProjectContext } from '../../core/context.js';
import { SCOPE_TOOLS, getToolsForScope } from '../../core/planner.js';

export { SCOPE_TOOLS, getToolsForScope };

/** Build the runtime security-agent system prompt. */
export function buildSecurityPrompt(context: ProjectContext, scope: string): string {
  const tools = getToolsForScope(scope);
  const sections: string[] = [];

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
10. All findings must be evidence-based - do not fabricate vulnerabilities.${
    context.cloudSafetyActive
      ? '\n11. CLOUD SAFETY MODE ACTIVE - extra caution required for cloud-hosted targets.'
      : ''
  }`);

  sections.push(`# Available Tools (scope: ${scope})

You may use these security tools through shell_exec: ${tools.join(', ')}.
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
