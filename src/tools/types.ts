/**
 * @module tools/types
 *
 * Defines the `ToolAdapter` interface that every security-tool adapter must
 * implement, along with the `Platform` union used to select install commands.
 *
 * Re-exports the canonical domain types from `../types/tool.js` so that
 * consumers of the tool subsystem only need a single import path.
 */

export type {
  ToolCategory,
  PlatformCommands,
  InstallResult,
  ToolOutput,
  CommandRiskLevel,
  RunResult,
} from '../types/tool.js';

export {
  ToolCategorySchema,
  PlatformCommandsSchema,
  InstallResultSchema,
  ToolOutputSchema,
  CommandRiskLevelSchema,
  RunResultSchema,
} from '../types/tool.js';

import type {
  ToolCategory,
  PlatformCommands,
  InstallResult,
  ToolOutput,
} from '../types/tool.js';

// ─── Platform ────────────────────────────────────────────────────────────────

/** Operating-system platform identifier. */
export type Platform = 'linux' | 'mac' | 'windows';

// ─── Tool Adapter ────────────────────────────────────────────────────────────

/**
 * Contract that every security-tool adapter must implement.
 *
 * An adapter wraps a single external CLI tool (e.g. nmap, gobuster) and
 * provides a uniform API for checking availability, installing, building
 * commands, and parsing raw output.
 */
export interface ToolAdapter {
  /** Unique machine-readable identifier (e.g. `"nmap"`). */
  readonly id: string;
  /** Human-readable display name (e.g. `"Nmap"`). */
  readonly name: string;
  /** Category this tool belongs to (recon, fuzzer, etc.). */
  readonly category: ToolCategory;
  /** Install commands keyed by platform. */
  readonly installCommands: PlatformCommands;
  /** URL pointing to the tool's official documentation. */
  readonly documentationUrl: string;

  /** Check whether the tool binary is available on `$PATH`. */
  isInstalled(): Promise<boolean>;

  /** Attempt to install the tool for the given platform. */
  install(platform: Platform): Promise<InstallResult>;

  /** Parse the raw stdout/stderr of a tool run into structured output. */
  parseOutput(raw: string): ToolOutput;

  /**
   * Build a CLI command string for scanning `target`.
   *
   * @param target  - The host, URL, or path to scan.
   * @param options - Optional adapter-specific flags / overrides.
   * @returns The fully-formed command string ready for execution.
   */
  buildCommand(target: string, options?: Record<string, unknown>): string;
}

// ─── Tool Registry Entry ─────────────────────────────────────────────────────

/**
 * Lightweight registry entry for a tool that may not have a full adapter yet.
 *
 * Used by the tool registry to track install commands and documentation URLs
 * for all known tools, even those without a rich adapter implementation.
 */
export interface ToolRegistryEntry {
  /** Install commands keyed by platform. */
  readonly installCommands: PlatformCommands;
  /** URL pointing to the tool's official documentation. */
  readonly documentationUrl: string;
  /** Category this tool belongs to. */
  readonly category: ToolCategory;
}
