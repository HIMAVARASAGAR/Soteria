import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import type { ProviderProfile } from './config.js'

const originalFetch = globalThis.fetch
let activeProfile: ProviderProfile | null = null

beforeEach(() => {
  activeProfile = null
  mock.module('./providerProfiles.js', () => ({
    getActiveProviderProfile: () => activeProfile,
  }))
})

afterEach(() => {
  mock.restore()
  globalThis.fetch = originalFetch
})

async function importFresh(suffix: string) {
  return import(`./providerModelValidation.ts?${suffix}`) as Promise<
    typeof import('./providerModelValidation.js')
  >
}

function mockActiveProfile(model: string) {
  activeProfile = {
    id: 'provider_custom',
    name: 'Custom',
    provider: 'custom',
    baseUrl: 'https://custom.example.test/v1',
    model,
  }
}

test('validateActiveProviderProfileModel reports missing model when provider list excludes saved model', async () => {
  mockActiveProfile('missing-model')
  globalThis.fetch = mock(async () =>
    new Response(JSON.stringify({ data: [{ id: 'available-model' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch

  const { validateActiveProviderProfileModel } = await importFresh('missing')

  expect(await validateActiveProviderProfileModel()).toEqual({
    state: 'missing',
    providerName: 'Custom',
    model: 'missing-model',
  })
})

test('validateActiveProviderProfileModel accepts saved model returned by provider list', async () => {
  mockActiveProfile('available-model')
  globalThis.fetch = mock(async () =>
    new Response(JSON.stringify({ data: [{ id: 'available-model' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch

  const { validateActiveProviderProfileModel } = await importFresh('ok')

  expect(await validateActiveProviderProfileModel()).toEqual({ state: 'ok' })
})

test('validateActiveProviderProfileModel skips when model list cannot be loaded', async () => {
  mockActiveProfile('custom-model')
  globalThis.fetch = mock(async () =>
    new Response('nope', { status: 500 }),
  ) as unknown as typeof fetch

  const { validateActiveProviderProfileModel } = await importFresh('skipped')

  expect(await validateActiveProviderProfileModel()).toEqual({
    state: 'skipped',
    reason: 'model-list-unavailable',
  })
})
