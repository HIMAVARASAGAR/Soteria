import { roughTokenCountEstimationForMessages } from '../tokenEstimation.js'
import { groupMessagesByApiRound } from './grouping.js'
import {
  createUserMessage,
  getAssistantMessageText,
} from '../../utils/messages.js'
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from '../../types/message.js'
import type { ToolUseContext } from '../../Tool.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import { logForDebugging } from '../../utils/debug.js'

/**
 * Calculates a safe token budget for each chunk based on the target model's
 * total context window. We target ~50% of the context window to leave ample
 * room for system prompt, previous summary context, tool schemas, and output tokens.
 */
export function calculateSafeChunkBudget(
  targetModelContextWindow: number,
): number {
  const halfWindow = Math.floor(targetModelContextWindow * 0.5)
  // Floor at 4,000 tokens for very small models, ceiling at 64,000 tokens for 1M+ models
  return Math.max(4_000, Math.min(64_000, halfWindow))
}

/**
 * Determines if a conversation should be compacted using the chunked rolling fold
 * rather than a single monolithic summarization call.
 */
export function shouldUseChunkedCompact(
  preCompactTokenCount: number,
  targetModelContextWindow: number,
): boolean {
  // If the conversation exceeds 70% of the target model's context window,
  // a single summarizer call risks hitting 400 (prompt_too_long / context_overflow).
  return preCompactTokenCount > targetModelContextWindow * 0.7
}

/**
 * Safely caps an oversized single message (e.g. huge file dump or terminal stdout)
 * so that an individual message never exceeds the chunk budget on its own.
 */
function clampOversizedMessage(message: Message, maxTokens: number): Message {
  if (message.type !== 'user' && message.type !== 'assistant') {
    return message
  }

  const tokenEstimate = roughTokenCountEstimationForMessages([message])
  if (tokenEstimate <= maxTokens) {
    return message
  }

  // If content is string, truncate with marker
  if (typeof message.message.content === 'string') {
    const maxChars = maxTokens * 3.5
    const truncatedText =
      message.message.content.slice(0, maxChars) +
      '\n[...content truncated for chunked compaction...]'
    return {
      ...message,
      message: {
        ...message.message,
        content: truncatedText,
      },
    }
  }

  // If array of content blocks, keep blocks until budget or truncate large text blocks
  if (Array.isArray(message.message.content)) {
    const maxChars = maxTokens * 3.5
    const newContent = message.message.content.map(block => {
      if (
        block &&
        typeof block === 'object' &&
        'type' in block &&
        block.type === 'text' &&
        typeof (block as { text?: string }).text === 'string' &&
        (block as { text: string }).text.length > maxChars
      ) {
        return {
          ...block,
          text:
            (block as { text: string }).text.slice(0, maxChars) +
            '\n[...content truncated for chunked compaction...]',
        }
      }
      return block
    })
    return {
      ...message,
      message: {
        ...message.message,
        content: newContent,
      },
    }
  }

  return message
}

/**
 * Partitions conversation messages into API-round-aligned chunks where each chunk
 * fits within `maxChunkTokens`.
 */
export function partitionMessagesIntoChunks(
  messages: Message[],
  maxChunkTokens: number,
): Message[][] {
  const roundGroups = groupMessagesByApiRound(messages)
  if (roundGroups.length === 0) {
    return []
  }

  const chunks: Message[][] = []
  let currentChunk: Message[] = []
  let currentChunkTokens = 0

  for (const group of roundGroups) {
    // Ensure individual oversized messages in this group don't exceed maxChunkTokens
    const sanitizedGroup = group.map(msg =>
      clampOversizedMessage(msg, maxChunkTokens),
    )
    const groupTokens = roughTokenCountEstimationForMessages(sanitizedGroup)

    if (
      currentChunk.length > 0 &&
      currentChunkTokens + groupTokens > maxChunkTokens
    ) {
      chunks.push(currentChunk)
      currentChunk = [...sanitizedGroup]
      currentChunkTokens = groupTokens
    } else {
      currentChunk.push(...sanitizedGroup)
      currentChunkTokens += groupTokens
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk)
  }

  return chunks
}

export function getInitialChunkPrompt(
  totalChunks: number,
  customInstructions?: string,
): string {
  return [
    `You are summarizing Part 1 of ${totalChunks} of a multi-stage conversation compaction.`,
    'Summarize the key objectives, architecture, technical decisions, and actions taken in this initial portion of the conversation.',
    'Focus on preserving high-fidelity context for future turns (file paths modified, design patterns chosen, current state).',
    customInstructions ? `Additional user instructions:\n${customInstructions}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function getFoldChunkPrompt(
  currentPart: number,
  totalChunks: number,
  customInstructions?: string,
): string {
  return [
    `You are updating a cumulative conversation summary across multiple parts (currently at Part ${currentPart} of ${totalChunks}).`,
    'Incorporate the new developments from the conversation segment above into a refreshed, coherent, and comprehensive summary.',
    'Merge earlier goals with subsequent code changes, debugging steps, and current outcomes without losing context.',
    customInstructions ? `Additional user instructions:\n${customInstructions}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export type StreamCompactSummaryFn = (params: {
  messages: Message[]
  summaryRequest: UserMessage
  appState: any
  context: ToolUseContext
  preCompactTokenCount: number
  cacheSafeParams: CacheSafeParams
}) => Promise<AssistantMessage>

/**
 * Executes a rolling-fold multi-stage compaction over chunks of conversation history.
 */
export async function runChunkedRollingCompact({
  messages,
  context,
  appState,
  cacheSafeParams,
  customInstructions,
  preCompactTokenCount,
  targetContextWindow,
  streamSummaryFn,
}: {
  messages: Message[]
  context: ToolUseContext
  appState: any
  cacheSafeParams: CacheSafeParams
  customInstructions?: string
  preCompactTokenCount: number
  targetContextWindow: number
  streamSummaryFn: StreamCompactSummaryFn
}): Promise<AssistantMessage> {
  const safeChunkBudget = calculateSafeChunkBudget(targetContextWindow)
  const chunks = partitionMessagesIntoChunks(messages, safeChunkBudget)

  logForDebugging(
    `[chunkedCompact] Running rolling compaction for ${preCompactTokenCount} tokens over ${chunks.length} chunks (budget: ${safeChunkBudget} per chunk, targetWindow: ${targetContextWindow})`,
  )

  if (chunks.length === 0) {
    throw new Error('No messages available for chunked compaction')
  }

  // If only 1 chunk was produced, run normal single-turn summary
  if (chunks.length === 1) {
    const summaryRequest = createUserMessage({
      content: getInitialChunkPrompt(1, customInstructions),
    })
    return streamSummaryFn({
      messages: chunks[0]!,
      summaryRequest,
      appState,
      context,
      preCompactTokenCount,
      cacheSafeParams,
    })
  }

  let runningSummary = ''
  let lastResponse: AssistantMessage | undefined

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!
    const partNum = i + 1
    const isFirst = i === 0

    logForDebugging(
      `[chunkedCompact] Processing chunk ${partNum}/${chunks.length} (${chunk.length} messages)`,
    )

    let chunkMessages: Message[]
    let summaryRequest: UserMessage

    if (isFirst) {
      chunkMessages = chunk
      summaryRequest = createUserMessage({
        content: getInitialChunkPrompt(chunks.length, customInstructions),
      })
    } else {
      const priorSummaryMessage = createUserMessage({
        content: `[Summary of earlier conversation (Parts 1 to ${i} of ${chunks.length})]:\n${runningSummary}\n\n[End of earlier summary]`,
      })
      chunkMessages = [priorSummaryMessage, ...chunk]
      summaryRequest = createUserMessage({
        content: getFoldChunkPrompt(partNum, chunks.length, customInstructions),
      })
    }

    const chunkParams: CacheSafeParams = {
      ...cacheSafeParams,
      forkContextMessages: chunkMessages,
    }

    const response = await streamSummaryFn({
      messages: chunkMessages,
      summaryRequest,
      appState,
      context,
      preCompactTokenCount: roughTokenCountEstimationForMessages(chunkMessages),
      cacheSafeParams: chunkParams,
    })

    const text = getAssistantMessageText(response)
    if (text) {
      runningSummary = text
    }
    lastResponse = response
  }

  if (!lastResponse) {
    throw new Error('Chunked compaction produced no response')
  }

  return lastResponse
}
