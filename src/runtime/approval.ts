/**
 * @module runtime/approval
 * Approval policy abstractions for runtime tool execution.
 */

import type { classify } from '../tools/classifier.js';

/** Decision returned by an approval policy. */
export type ApprovalDecision =
  | { readonly action: 'allow' }
  | { readonly action: 'deny'; readonly reason: string }
  | { readonly action: 'ask'; readonly risk: string; readonly reason: string };

/** Tool approval policy contract. */
export interface ApprovalPolicy {
  /**
   * Check whether a call is allowed, denied, or needs user approval.
   *
   * @param call - Tool call request.
   */
  check(call: { readonly name: string; readonly arguments: Record<string, unknown> }): ApprovalDecision;

  /**
   * Ask the user to approve a call synchronously from the runtime perspective.
   *
   * @param call - Tool call request.
   * @param risk - Risk label.
   * @param reason - Classification reason.
   */
  requestApproval(
    call: { readonly name: string; readonly arguments: Record<string, unknown> },
    risk: string,
    reason: string,
  ): Promise<boolean>;
}

/** Approval policy backed by the shell command classifier. */
export class SecurityApprovalPolicy implements ApprovalPolicy {
  /**
   * Create a security approval policy.
   *
   * @param classifier - Command classifier function.
   * @param promptFn - User approval prompt function.
   */
  constructor(
    private readonly classifier: typeof classify,
    private readonly promptFn: (
      call: { readonly name: string; readonly arguments: Record<string, unknown> },
      risk: string,
      reason: string,
    ) => Promise<boolean>,
  ) {}

  check(call: { readonly name: string; readonly arguments: Record<string, unknown> }): ApprovalDecision {
    if (call.name !== 'shell_exec') {
      return { action: 'allow' };
    }

    const command = typeof call.arguments.command === 'string'
      ? call.arguments.command
      : '';
    const result = this.classifier(command);
    if (result.safe) {
      return { action: 'allow' };
    }
    if (result.risk === 'HIGH') {
      return { action: 'ask', risk: 'HIGH', reason: result.reason };
    }
    return { action: 'ask', risk: result.risk, reason: result.reason };
  }

  requestApproval(
    call: { readonly name: string; readonly arguments: Record<string, unknown> },
    risk: string,
    reason: string,
  ): Promise<boolean> {
    return this.promptFn(call, risk, reason);
  }
}

/** Approval policy that allows every call. */
export class AutoApprovePolicy implements ApprovalPolicy {
  check(): ApprovalDecision {
    return { action: 'allow' };
  }

  requestApproval(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

/** Approval policy that denies every call. */
export class DenyAllPolicy implements ApprovalPolicy {
  check(): ApprovalDecision {
    return { action: 'deny', reason: 'dry-run mode' };
  }

  requestApproval(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
