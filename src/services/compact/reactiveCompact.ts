import type { QuerySource } from '../../constants/querySource.js'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
} from '../../types/message.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import type { CompactionResult } from './compact.js'
import { isPromptTooLongMessage } from '../api/errors.js'
import { logForDebugging } from '../../utils/debug.js'

export function isReactiveCompactEnabled(): boolean {
  return true
}

/** Whether /compact should route through the reactive path. Always false to use standard /compact flow. */
export function isReactiveOnlyMode(): boolean {
  return false
}

/**
 * Whether a prompt-too-long API error should be withheld pending a reactive
 * compact retry.
 */
export function isWithheldPromptTooLong(
  message: Message | StreamEvent | undefined,
): message is AssistantMessage {
  if (!message || (message as { type?: string }).type !== 'assistant') {
    return false
  }
  return isPromptTooLongMessage(message as AssistantMessage)
}

/**
 * Whether a media-size API error should be withheld pending a strip-retry.
 */
export function isWithheldMediaSizeError(
  _message: Message | StreamEvent | undefined,
): _message is AssistantMessage {
  return false
}

export type ReactiveCompactOutcome =
  | { ok: true; result: CompactionResult }
  | {
      ok: false
      reason:
        | 'too_few_groups'
        | 'aborted'
        | 'exhausted'
        | 'error'
        | 'media_unstrippable'
    }

/**
 * Run reactive compaction in response to a prompt-too-long error (or
 * reactive-only /compact).
 */
export async function reactiveCompactOnPromptTooLong(
  messages: Message[],
  cacheSafeParams: CacheSafeParams,
  options: {
    customInstructions?: string
    trigger: 'manual' | 'auto'
  },
): Promise<ReactiveCompactOutcome> {
  try {
    const { compactConversation } = await import('./compact.js')
    const result = await compactConversation(
      messages,
      cacheSafeParams.toolUseContext,
      cacheSafeParams,
      true,
      options.customInstructions,
      options.trigger === 'auto',
    )
    return { ok: true, result }
  } catch (err) {
    logForDebugging(`[reactiveCompact] reactiveCompactOnPromptTooLong failed: ${err}`, { level: 'warn' })
    return { ok: false, reason: 'error' }
  }
}

/**
 * One-shot reactive compact attempt from the query loop's 413/media-error
 * recovery path. Runs compaction on the message history so the query loop
 * can automatically retry the turn within the model's token limits.
 */
export async function tryReactiveCompact(params: {
  hasAttempted: boolean
  querySource: QuerySource
  aborted: boolean
  messages: Message[]
  cacheSafeParams: CacheSafeParams
}): Promise<CompactionResult | null> {
  if (params.hasAttempted || params.aborted) {
    return null
  }
  if (
    params.querySource === 'compact' ||
    params.querySource === 'session_memory'
  ) {
    return null
  }
  try {
    const { compactConversation } = await import('./compact.js')
    logForDebugging(
      `[reactiveCompact] attempting reactive compaction for ${params.messages.length} messages...`,
      { level: 'info' },
    )
    const result = await compactConversation(
      params.messages,
      params.cacheSafeParams.toolUseContext,
      params.cacheSafeParams,
      true, // suppressFollowUpQuestions
      undefined, // customInstructions
      true, // isAutoCompact
    )
    logForDebugging(
      `[reactiveCompact] reactive compaction succeeded. Post-compact token count: ${result.postCompactTokenCount}`,
      { level: 'info' },
    )
    return result
  } catch (err) {
    logForDebugging(`[reactiveCompact] reactive compaction failed: ${err}`, {
      level: 'warn',
    })
    return null
  }
}
