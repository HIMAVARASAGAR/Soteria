import { describe, expect, test } from 'bun:test'
import {
  calculateSafeChunkBudget,
  getFoldChunkPrompt,
  getInitialChunkPrompt,
  partitionMessagesIntoChunks,
  runChunkedRollingCompact,
  shouldUseChunkedCompact,
} from './chunkedCompact.js'
import {
  createAssistantMessage,
  createUserMessage,
} from '../../utils/messages.js'
import type { Message } from '../../types/message.js'

describe('chunkedCompact', () => {
  describe('calculateSafeChunkBudget', () => {
    test('calculates 50% budget capped at 64k and floored at 4k', () => {
      expect(calculateSafeChunkBudget(128_000)).toBe(64_000)
      expect(calculateSafeChunkBudget(200_000)).toBe(64_000) // capped
      expect(calculateSafeChunkBudget(1_000_000)).toBe(64_000) // capped
      expect(calculateSafeChunkBudget(32_768)).toBe(16_384)
      expect(calculateSafeChunkBudget(8_192)).toBe(4_096)
      expect(calculateSafeChunkBudget(4_000)).toBe(4_000) // floored
    })
  })

  describe('shouldUseChunkedCompact', () => {
    test('triggers when conversation exceeds 70% of target context window', () => {
      // 500k tokens against 128k target (user downscale scenario)
      expect(shouldUseChunkedCompact(500_000, 128_000)).toBe(true)

      // 100k tokens against 128k target (100k > 89.6k)
      expect(shouldUseChunkedCompact(100_000, 128_000)).toBe(true)

      // 40k tokens against 128k target (40k <= 89.6k)
      expect(shouldUseChunkedCompact(40_000, 128_000)).toBe(false)

      // 25k tokens against 32k Groq model (25k > 22.4k)
      expect(shouldUseChunkedCompact(25_000, 32_768)).toBe(true)
    })
  })

  describe('partitionMessagesIntoChunks', () => {
    test('partitions round-groups across chunk boundaries', () => {
      // Create a sequence of 6 distinct turns (3 user, 3 assistant)
      const messages: Message[] = [
        createUserMessage({ content: 'Prompt 1: '.repeat(200) }),
        createAssistantMessage({ content: 'Response 1: '.repeat(200) }),
        createUserMessage({ content: 'Prompt 2: '.repeat(200) }),
        createAssistantMessage({ content: 'Response 2: '.repeat(200) }),
        createUserMessage({ content: 'Prompt 3: '.repeat(200) }),
        createAssistantMessage({ content: 'Response 3: '.repeat(200) }),
      ]

      // Set budget small enough that each round exceeds the budget
      const chunks = partitionMessagesIntoChunks(messages, 500)
      expect(chunks.length).toBeGreaterThan(1)

      // Verify total messages across chunks equals original message count
      const totalMessages = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
      expect(totalMessages).toBe(messages.length)
    })

    test('returns single chunk if all messages fit in budget', () => {
      const messages: Message[] = [
        createUserMessage({ content: 'Short message 1' }),
        createAssistantMessage({ content: 'Short response 1' }),
      ]

      const chunks = partitionMessagesIntoChunks(messages, 50_000)
      expect(chunks.length).toBe(1)
      expect(chunks[0]!.length).toBe(2)
    })
  })

  describe('runChunkedRollingCompact', () => {
    test('executes rolling fold across multiple chunks', async () => {
      // 3 rounds of conversation with enough tokens to exceed the 4,000 token chunk budget
      const messages: Message[] = [
        createUserMessage({ content: 'Part A work: built auth component. '.repeat(400) }),
        createAssistantMessage({ content: 'Implemented auth and unit tests. '.repeat(400) }),
        createUserMessage({ content: 'Part B work: added database migrations. '.repeat(400) }),
        createAssistantMessage({ content: 'Applied migrations and updated models. '.repeat(400) }),
        createUserMessage({ content: 'Part C work: added REST API endpoints. '.repeat(400) }),
        createAssistantMessage({ content: 'Created endpoints and verified responses. '.repeat(400) }),
      ]

      const callsReceived: Array<{
        partNum: number
        messagesCount: number
        summaryRequestContent: string
      }> = []

      let callIndex = 0
      const mockStreamSummary = async (params: {
        messages: Message[]
        summaryRequest: any
        preCompactTokenCount: number
      }) => {
        callIndex++
        const reqText = params.summaryRequest.message.content as string
        callsReceived.push({
          partNum: callIndex,
          messagesCount: params.messages.length,
          summaryRequestContent: reqText,
        })

        return createAssistantMessage({
          content: `Cumulative summary up to step ${callIndex}: Completed parts up to ${callIndex}.`,
        })
      }

      // Force chunk budget small enough to create multiple chunks
      const result = await runChunkedRollingCompact({
        messages,
        context: {
          options: { mainLoopModel: 'test-model' },
          abortController: new AbortController(),
        } as any,
        appState: {},
        cacheSafeParams: { forkContextMessages: [] } as any,
        customInstructions: 'Keep track of all files.',
        preCompactTokenCount: 15_000,
        targetContextWindow: 1_000,
        streamSummaryFn: mockStreamSummary,
      })

      expect(callsReceived.length).toBeGreaterThan(1)
      // Check that chunk 1 had initial prompt
      expect(callsReceived[0]!.summaryRequestContent).toContain('Part 1 of')
      // Check that subsequent chunks had fold prompt
      expect(callsReceived[1]!.summaryRequestContent).toContain('Part 2 of')

      // Check final assistant message text
      const finalText = (result.message.content as any)[0].text
      expect(finalText).toContain(`Cumulative summary up to step ${callsReceived.length}`)
    })
  })
})
