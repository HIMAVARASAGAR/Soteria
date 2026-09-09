import { describe, expect, it } from 'bun:test'
import {
  isReactiveCompactEnabled,
  isReactiveOnlyMode,
  isWithheldPromptTooLong,
  isWithheldMediaSizeError,
  tryReactiveCompact,
} from './reactiveCompact.js'
import { PROMPT_TOO_LONG_ERROR_MESSAGE } from '../api/errors.js'
import { createAssistantAPIErrorMessage } from '../../utils/messages.js'

describe('reactiveCompact', () => {
  it('has reactive compaction enabled', () => {
    expect(isReactiveCompactEnabled()).toBe(true)
    expect(isReactiveOnlyMode()).toBe(false)
  })

  it('correctly withholds prompt-too-long assistant error messages', () => {
    const ptlMessage = createAssistantAPIErrorMessage({
      content: PROMPT_TOO_LONG_ERROR_MESSAGE,
    })

    expect(isWithheldPromptTooLong(ptlMessage)).toBe(true)

    const otherMessage = createAssistantAPIErrorMessage({
      content: 'Some other error',
    })

    expect(isWithheldPromptTooLong(otherMessage)).toBe(false)
    expect(isWithheldMediaSizeError(ptlMessage)).toBe(false)
  })

  it('skips compaction if already attempted or aborted', async () => {
    const resAlreadyAttempted = await tryReactiveCompact({
      hasAttempted: true,
      querySource: 'repl',
      aborted: false,
      messages: [],
      cacheSafeParams: {} as any,
    })
    expect(resAlreadyAttempted).toBeNull()

    const resAborted = await tryReactiveCompact({
      hasAttempted: false,
      querySource: 'repl',
      aborted: true,
      messages: [],
      cacheSafeParams: {} as any,
    })
    expect(resAborted).toBeNull()

    const resCompactSource = await tryReactiveCompact({
      hasAttempted: false,
      querySource: 'compact',
      aborted: false,
      messages: [],
      cacheSafeParams: {} as any,
    })
    expect(resCompactSource).toBeNull()
  })
})
