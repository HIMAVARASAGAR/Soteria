import { z } from 'zod';
import { FindingSchema } from './findings.js';

// ─── Scope ───────────────────────────────────────────────────────────────────

/** Assessment scopes that determine which tool categories to engage. */
export const ScopeSchema = z.enum([
  'all',
  'web',
  'sql',
  'dirs',
  'ports',
  'fuzz',
  'headers',
  'ssl',
]);

/** Assessment scope. */
export type Scope = z.infer<typeof ScopeSchema>;

// ─── Target ──────────────────────────────────────────────────────────────────

/**
 * Zod schema for a security assessment target.
 *
 * At least one of `path` or `url` should be specified.
 * `scope` controls which categories of tools to run.
 */
export const TargetSchema = z.object({
  /** Local file-system path to scan (for static analysis, etc.). */
  path: z.string().optional(),
  /** URL of the remote target (for web/network scans). */
  url: z.string().url().optional(),
  /** Which categories of testing to perform. */
  scope: ScopeSchema,
});

/** Target of a security assessment. */
export type Target = z.infer<typeof TargetSchema>;

// ─── Session State ───────────────────────────────────────────────────────────

/** Lifecycle states of an agent session. */
export const SessionStateSchema = z.enum([
  'initializing',
  'planning',
  'executing',
  'reporting',
  'ended',
]);

/** Current state of an agent session. */
export type SessionState = z.infer<typeof SessionStateSchema>;

// ─── Plan Step ───────────────────────────────────────────────────────────────

/** Risk level for an individual plan step. */
export const StepRiskSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

/** Risk level for a plan step. */
export type StepRisk = z.infer<typeof StepRiskSchema>;

/**
 * Zod schema for a single step in an agent's execution plan.
 *
 * Steps form a DAG via `dependsOn`, allowing the agent to
 * express ordering constraints between tool invocations.
 */
export const PlanStepSchema = z.object({
  /** Unique identifier for this step. */
  id: z.string().min(1),
  /** Name of the tool to invoke. */
  tool: z.string().min(1),
  /** Full shell command to execute. */
  command: z.string().min(1),
  /** Human-readable description of what this step does. */
  description: z.string().min(1),
  /** Risk assessment for this step. */
  risk: StepRiskSchema,
  /** IDs of steps that must complete before this one can run. */
  dependsOn: z.array(z.string()).optional(),
});

/** A single step in the agent's execution plan. */
export type PlanStep = z.infer<typeof PlanStepSchema>;

// ─── Step Result ─────────────────────────────────────────────────────────────

/**
 * Zod schema for the result of executing a single plan step.
 */
export const StepResultSchema = z.object({
  /** ID of the plan step that was executed. */
  stepId: z.string().min(1),
  /** Whether the step completed successfully. */
  success: z.boolean(),
  /** Raw output from the step execution. */
  output: z.string().optional(),
  /** Security findings produced by this step. */
  findings: z.array(FindingSchema).optional(),
  /** Error message if the step failed. */
  error: z.string().optional(),
});

/** Result of executing a plan step. */
export type StepResult = z.infer<typeof StepResultSchema>;

// ─── Session Info ────────────────────────────────────────────────────────────

/**
 * Zod schema for session metadata, providing a summary of the current
 * or completed agent session.
 */
export const SessionInfoSchema = z.object({
  /** Unique session identifier. */
  sessionId: z.string().min(1),
  /** ISO-8601 timestamp when the session was created. */
  startedAt: z.string().datetime(),
  /** The target being assessed. */
  target: TargetSchema,
  /** LLM model being used for this session. */
  model: z.string().min(1),
  /** Assessment scope for this session. */
  scope: ScopeSchema,
  /** Current lifecycle state. */
  state: SessionStateSchema,
});

/** Summary information about an agent session. */
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
