import { APIError } from '@anthropic-ai/sdk'
import { expect, test } from 'bun:test'

import { getAssistantMessageFromError } from './errors.js'

function getFirstText(message: ReturnType<typeof getAssistantMessageFromError>): string {
  const first = message.message.content[0]
  if (!first || typeof first !== 'object' || !('text' in first)) {
    return ''
  }
  return typeof first.text === 'string' ? first.text : ''
}

test('maps endpoint_not_found category markers to actionable setup guidance', () => {
  const error = APIError.generate(
    404,
    undefined,
    'OpenAI API error 404: Not Found [openai_category=endpoint_not_found] Hint: Confirm OPENAI_BASE_URL includes /v1.',
    new Headers(),
  )

  const message = getAssistantMessageFromError(error, 'qwen2.5-coder:7b')
  const text = getFirstText(message)

  expect(message.isApiErrorMessage).toBe(true)
  expect(text).toContain('Provider endpoint was not found')
  expect(text).toContain('OPENAI_BASE_URL')
  expect(text).toContain('/v1')
})

test('vision_not_supported shows image-specific guidance for remote host', () => {
  const error = APIError.generate(
    404,
    undefined,
    'OpenAI API error 404: Not Found [openai_category=vision_not_supported,host=opengateway.gitlawb.com] Hint: The provider returned 404 for a request containing images.',
    new Headers(),
  )

  const message = getAssistantMessageFromError(error, 'mimo-v2.5-pro')
  const text = getFirstText(message)

  expect(message.isApiErrorMessage).toBe(true)
  expect(text).toContain('images')
  expect(text).toContain('mimo-v2.5-pro')
  expect(text).toContain('opengateway.gitlawb.com')
  expect(text).not.toContain('OPENAI_BASE_URL')
})

test('endpoint_not_found from a remote host shows the actual host, not Ollama (issue #926)', () => {
  const error = APIError.generate(
    404,
    undefined,
    'OpenAI API error 404: Not Found [openai_category=endpoint_not_found,host=integrate.api.nvidia.com] Hint: Endpoint at integrate.api.nvidia.com returned 404.',
    new Headers(),
  )

  const message = getAssistantMessageFromError(error, 'moonshotai/kimi-k2.5-thinking')
  const text = getFirstText(message)

  expect(text).toContain('integrate.api.nvidia.com')
  expect(text).toContain('moonshotai/kimi-k2.5-thinking')
  expect(text).not.toContain('Ollama')
  expect(text).not.toContain('11434')
})

test('endpoint_not_found without a host falls back to the Ollama-aware message', () => {
  const error = APIError.generate(
    404,
    undefined,
    'OpenAI API error 404: Not Found [openai_category=endpoint_not_found] Hint: Confirm OPENAI_BASE_URL includes /v1.',
    new Headers(),
  )

  const message = getAssistantMessageFromError(error, 'qwen2.5-coder:7b')
  const text = getFirstText(message)

  expect(text).toContain('Provider endpoint was not found')
  expect(text).toContain('Ollama')
})

test('maps tool_call_incompatible category markers to model/tool guidance', () => {
  const error = APIError.generate(
    400,
    undefined,
    'OpenAI API error 400: tool_calls are not supported [openai_category=tool_call_incompatible]',
    new Headers(),
  )

  const message = getAssistantMessageFromError(error, 'qwen2.5-coder:7b')
  const text = getFirstText(message)

  expect(text).toContain('rejected tool-calling payloads')
  expect(text).toContain('/model')
})

test('maps context_overflow category markers to Prompt is too long for reactive compaction', () => {
  const error = APIError.generate(
    400,
    undefined,
    'OpenAI API error 400: maximum context length exceeded [openai_category=context_overflow]',
    new Headers(),
  )

  const message = getAssistantMessageFromError(error, 'qwen/qwen3.8-27b')
  const text = getFirstText(message)

  expect(text).toBe('Prompt is too long')
})

test('maps HTTP 413 without media attachments to Prompt is too long', () => {
  const error = APIError.generate(
    413,
    undefined,
    'Request too large',
    new Headers(),
  )

  const message = getAssistantMessageFromError(error, 'qwen/qwen3.8-27b', {
    messages: [
      {
        type: 'user',
        message: { role: 'user', content: 'hi' },
        uuid: '1' as any,
        session_id: 's1',
        timestamp: new Date().toISOString(),
      },
    ],
  })
  const text = getFirstText(message)

  expect(text).toBe('Prompt is too long')
})

test('maps HTTP 413 with media attachments to Request too large file error', () => {
  const error = APIError.generate(
    413,
    undefined,
    'Request too large',
    new Headers(),
  )

  const message = getAssistantMessageFromError(error, 'claude-3-5-sonnet-20241022', {
    messages: [
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'check this file' },
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'abc' } },
          ],
        },
        uuid: '1' as any,
        session_id: 's1',
        timestamp: new Date().toISOString(),
      },
    ],
  })
  const text = getFirstText(message)

  expect(text).toContain('Request too large')
  expect(text).toContain('smaller file')
})

