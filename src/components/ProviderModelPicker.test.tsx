import { afterEach, describe, expect, test } from 'bun:test'
import { discoverProviderModelIds } from './ProviderModelPicker.js'

describe('discoverProviderModelIds', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('OpenAI: fetches live models using Bearer token, filters non-chat models, ranks reasoning first', async () => {
    let capturedUrl = ''
    let capturedHeaders: Record<string, string> = {}

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedHeaders = (init?.headers as Record<string, string>) ?? {}
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'text-embedding-3-small' },
            { id: 'gpt-4o-mini' },
            { id: 'whisper-1' },
            { id: 'o3-mini' },
            { id: 'dall-e-3' },
            { id: 'gpt-4o' },
            { id: 'text-moderation-latest' },
            { id: 'babbage-002' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const models = await discoverProviderModelIds('openai', 'sk-test-key')

    expect(capturedUrl).toBe('https://api.openai.com/v1/models')
    expect(capturedHeaders['Authorization']).toBe('Bearer sk-test-key')

    // Non-chat models should be filtered out
    expect(models).not.toContain('text-embedding-3-small')
    expect(models).not.toContain('whisper-1')
    expect(models).not.toContain('dall-e-3')
    expect(models).not.toContain('text-moderation-latest')
    expect(models).not.toContain('babbage-002')

    // Chat models should remain and reasoning/flagship ranked first
    expect(models).toContain('o3-mini')
    expect(models).toContain('gpt-4o')
    expect(models).toContain('gpt-4o-mini')
    expect(models[0]).toBe('o3-mini')
  })

  test('Anthropic: fetches live models with x-api-key and anthropic-version', async () => {
    let capturedUrl = ''
    let capturedHeaders: Record<string, string> = {}

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedHeaders = (init?.headers as Record<string, string>) ?? {}
      return new Response(
        JSON.stringify({
          data: [
            { id: 'claude-3-haiku-20240307' },
            { id: 'claude-3-7-sonnet-20250219' },
            { id: 'claude-3-5-sonnet-20241022' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const models = await discoverProviderModelIds('anthropic', 'sk-ant-key')

    expect(capturedUrl).toBe('https://api.anthropic.com/v1/models')
    expect(capturedHeaders['x-api-key']).toBe('sk-ant-key')
    expect(capturedHeaders['anthropic-version']).toBe('2023-06-01')

    // Ranks 3-7 and 3-5 before older haiku
    expect(models[0]).toBe('claude-3-7-sonnet-20250219')
    expect(models[1]).toBe('claude-3-5-sonnet-20241022')
    expect(models).toContain('claude-3-haiku-20240307')
  })

  test('Gemini: queries v1beta/models with key param and filters generateContent', async () => {
    let capturedUrl = ''

    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url)
      return new Response(
        JSON.stringify({
          models: [
            {
              name: 'models/gemini-2.0-flash',
              supportedGenerationMethods: ['generateContent', 'countTokens'],
            },
            {
              name: 'models/text-embedding-004',
              supportedGenerationMethods: ['embedContent'],
            },
            {
              name: 'models/gemini-2.5-pro',
              supportedGenerationMethods: ['generateContent'],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const models = await discoverProviderModelIds('gemini', 'test-gemini-key')

    expect(capturedUrl).toContain('key=test-gemini-key')
    expect(models).toContain('gemini-2.5-pro')
    expect(models).toContain('gemini-2.0-flash')
    expect(models).not.toContain('text-embedding-004')
    // Strips models/ prefix
    expect(models.some(m => m.startsWith('models/'))).toBe(false)
  })

  test('Groq: filters inactive and whisper/guard models', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          data: [
            { id: 'llama-3.3-70b-versatile', active: true },
            { id: 'whisper-large-v3', active: true },
            { id: 'llama-guard-3-8b', active: true },
            { id: 'deprecated-model', active: false },
            { id: 'mixtral-8x7b-32768', active: true },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const models = await discoverProviderModelIds('groq', 'gsk_test')

    expect(models).toContain('llama-3.3-70b-versatile')
    expect(models).toContain('mixtral-8x7b-32768')
    expect(models).not.toContain('whisper-large-v3')
    expect(models).not.toContain('llama-guard-3-8b')
    expect(models).not.toContain('deprecated-model')
  })

  test('DeepSeek & xAI: fetches models using Bearer token', async () => {
    let capturedDeepSeekUrl = ''
    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedDeepSeekUrl = String(url)
      return new Response(
        JSON.stringify({
          data: [
            { id: 'deepseek-chat' },
            { id: 'deepseek-reasoner' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const dsModels = await discoverProviderModelIds('deepseek', 'sk-ds')
    expect(capturedDeepSeekUrl).toBe('https://api.deepseek.com/v1/models')
    expect(dsModels).toEqual(['deepseek-chat', 'deepseek-reasoner'])

    let capturedXaiUrl = ''
    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedXaiUrl = String(url)
      return new Response(
        JSON.stringify({
          data: [
            { id: 'grok-2-1212' },
            { id: 'grok-beta' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const xaiModels = await discoverProviderModelIds('xai', 'xai-test')
    expect(capturedXaiUrl).toBe('https://api.x.ai/v1/models')
    expect(xaiModels).toEqual(['grok-2-1212', 'grok-beta'])
  })

  test('gracefully returns empty array on network failure without throwing', async () => {
    globalThis.fetch = (async () => {
      throw new Error('Network error: ENOTFOUND')
    }) as unknown as typeof fetch

    const models = await discoverProviderModelIds('openai', 'sk-key')
    expect(models).toEqual([])
  })
})
