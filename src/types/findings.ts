import { z } from 'zod';

// ─── Severity ────────────────────────────────────────────────────────────────

/** Severity levels for security findings, ordered from most to least critical. */
export const SeveritySchema = z.enum([
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
  'INFO',
]);

/** Severity level for a security finding. */
export type Severity = z.infer<typeof SeveritySchema>;

// ─── Finding ─────────────────────────────────────────────────────────────────

/**
 * Zod schema for a single security finding produced by an agent or tool.
 *
 * Required: `name`, `severity`, `location`, `what`.
 * Optional: `impact`, `fix`, `exploitCmd`, `confidence`.
 */
export const FindingSchema = z.object({
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
  confidence: z.number().min(0).max(1).optional(),
});

/** A single security finding. */
export type Finding = z.infer<typeof FindingSchema>;

// ─── Command Risk ────────────────────────────────────────────────────────────

/** Risk level for a suggested command. */
export const CommandRiskSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

/** Risk level for a suggested command. */
export type CommandRisk = z.infer<typeof CommandRiskSchema>;

// ─── Suggested Command ──────────────────────────────────────────────────────

/**
 * Zod schema for a command the agent suggests the user run next.
 *
 * Includes the raw command, which tool it targets, a justification,
 * optional flags, and a risk assessment.
 */
export const SuggestedCommandSchema = z.object({
  /** The full shell command to execute. */
  command: z.string().min(1),
  /** Name of the tool this command invokes (e.g. "nmap", "sqlmap"). */
  tool: z.string().min(1),
  /** Explanation of why this command is useful. */
  why: z.string().min(1),
  /** Additional CLI flags or options. */
  flags: z.string().optional(),
  /** Risk level of running this command. */
  risk: CommandRiskSchema,
});

/** A command suggested by the agent for the next step. */
export type SuggestedCommand = z.infer<typeof SuggestedCommandSchema>;

// ─── Parsed Response ─────────────────────────────────────────────────────────

/**
 * Zod schema for the fully parsed LLM response, containing extracted
 * findings, suggested follow-up commands, a narrative summary, and
 * any warnings that arose during parsing.
 */
export const ParsedResponseSchema = z.object({
  /** Security findings extracted from the LLM response. */
  findings: z.array(FindingSchema),
  /** Follow-up commands suggested by the LLM. */
  commands: z.array(SuggestedCommandSchema),
  /** Free-form narrative summary from the LLM. */
  narrative: z.string(),
  /** Warnings generated during response parsing. */
  parseWarnings: z.array(z.string()),
});

/** Result of parsing an LLM response into structured data. */
export type ParsedResponse = z.infer<typeof ParsedResponseSchema>;
