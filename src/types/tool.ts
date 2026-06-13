import { z } from 'zod';
import { FindingSchema } from './findings.js';

// ─── Tool Category ───────────────────────────────────────────────────────────

/** Categories of security tools that CSage can orchestrate. */
export const ToolCategorySchema = z.enum([
  'recon',
  'scanner',
  'fuzzer',
  'exploit',
  'brute-force',
  'ssl',
  'static',
]);

/** Category of a security tool. */
export type ToolCategory = z.infer<typeof ToolCategorySchema>;

// ─── Platform Commands ───────────────────────────────────────────────────────

/**
 * Zod schema for platform-specific shell commands.
 *
 * Each key maps to the command string for that platform.
 * All fields are optional to support tools that only run on certain OSes.
 */
export const PlatformCommandsSchema = z.object({
  /** Command for Linux. */
  linux: z.string().optional(),
  /** Command for macOS. */
  mac: z.string().optional(),
  /** Command for Windows. */
  win: z.string().optional(),
});

/** Platform-keyed shell commands. */
export type PlatformCommands = z.infer<typeof PlatformCommandsSchema>;

// ─── Install Result ──────────────────────────────────────────────────────────

/**
 * Zod schema for the result of a tool installation attempt.
 */
export const InstallResultSchema = z.object({
  /** Whether the installation succeeded. */
  success: z.boolean(),
  /** Human-readable status or error message. */
  message: z.string(),
});

/** Result of attempting to install a security tool. */
export type InstallResult = z.infer<typeof InstallResultSchema>;

// ─── Tool Output ─────────────────────────────────────────────────────────────

/**
 * Zod schema for the output produced by running a security tool.
 *
 * - `raw`      — the unprocessed stdout/stderr output
 * - `parsed`   — optionally, a structured representation of the raw output
 * - `findings` — optionally, security findings extracted from the output
 */
export const ToolOutputSchema = z.object({
  /** Raw stdout/stderr text from the tool. */
  raw: z.string(),
  /** Structured parse of the raw output (tool-specific). */
  parsed: z.record(z.unknown()).optional(),
  /** Security findings extracted from the tool output. */
  findings: z.array(FindingSchema).optional(),
});

/** Output from a security tool execution. */
export type ToolOutput = z.infer<typeof ToolOutputSchema>;

// ─── Command Risk ────────────────────────────────────────────────────────────

/** Risk classification for a command the agent wants to execute. */
export const CommandRiskLevelSchema = z.enum(['safe', 'risky', 'blocked']);

/** Risk classification for a command. */
export type CommandRiskLevel = z.infer<typeof CommandRiskLevelSchema>;

// ─── Run Result ──────────────────────────────────────────────────────────────

/**
 * Zod schema for the result of requesting a command execution.
 *
 * Captures whether the command was allowed, whether it ran, and the
 * resulting stdout / stderr / error information.
 */
export const RunResultSchema = z.object({
  /** The command that was requested. */
  command: z.string(),
  /** Whether the command was permitted by the safety policy. */
  allowed: z.boolean(),
  /** Whether the command actually executed (false if blocked before run). */
  ran: z.boolean(),
  /** Whether the command exited successfully (exit code 0). */
  success: z.boolean(),
  /** Standard output captured from the command. */
  stdout: z.string(),
  /** Standard error captured from the command. */
  stderr: z.string(),
  /** Error message if the command failed or was blocked. */
  error: z.string().optional(),
  /** Human-readable reason for blocking (when `allowed` is false). */
  reason: z.string().optional(),
});

/** Result of a command execution attempt. */
export type RunResult = z.infer<typeof RunResultSchema>;
