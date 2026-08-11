import {
  discoverModelsForRoute,
} from '../integrations/discoveryService.js'
import {
  resolveProfileRoute,
  resolveRouteIdFromBaseUrl,
} from '../integrations/index.js'
import { getActiveProviderProfile } from './providerProfiles.js'
import { getPrimaryModel } from './providerModels.js'

export type ProviderModelValidationResult =
  | { state: 'ok' }
  | { state: 'skipped'; reason: string }
  | {
      state: 'missing'
      providerName: string
      model: string
    }

function normalizeModel(value: string): string {
  return value.trim().toLowerCase()
}

function modelInList(model: string, models: string[]): boolean {
  const normalized = normalizeModel(model)
  return models.some(candidate => normalizeModel(candidate) === normalized)
}

async function fetchOpenAICompatibleModelIds(
  baseUrl: string,
  apiKey?: string,
): Promise<string[] | null> {
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: apiKey?.trim() ? { Authorization: `Bearer ${apiKey}` } : {},
    })
    if (!resp.ok) {
      return null
    }
    type ModelListResponse = { data?: Array<{ id?: string }> }
    const json = await resp.json() as ModelListResponse
    return (json.data ?? []).map(model => model.id?.trim() ?? '').filter(Boolean)
  } catch {
    return null
  }
}

async function fetchAnthropicModelIds(
  baseUrl: string,
  apiKey?: string,
): Promise<string[] | null> {
  if (!apiKey?.trim()) {
    return null
  }
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/models`, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    })
    if (!resp.ok) {
      return null
    }
    type AnthropicModelList = { data?: Array<{ id?: string }> }
    const json = await resp.json() as AnthropicModelList
    return (json.data ?? []).map(model => model.id?.trim() ?? '').filter(Boolean)
  } catch {
    return null
  }
}

async function fetchGeminiModelIds(apiKey?: string): Promise<string[] | null> {
  if (!apiKey?.trim()) {
    return null
  }
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    )
    if (!resp.ok) {
      return null
    }
    type GeminiModelList = {
      models?: Array<{
        name?: string
        supportedGenerationMethods?: string[]
      }>
    }
    const json = await resp.json() as GeminiModelList
    return (json.models ?? [])
      .filter(model =>
        !model.supportedGenerationMethods ||
        model.supportedGenerationMethods.includes('generateContent'),
      )
      .map(model => model.name?.replace(/^models\//, '').trim() ?? '')
      .filter(Boolean)
  } catch {
    return null
  }
}

export async function validateActiveProviderProfileModel(): Promise<ProviderModelValidationResult> {
  const profile = getActiveProviderProfile()
  if (!profile) {
    return { state: 'skipped', reason: 'no-active-profile' }
  }

  const model = getPrimaryModel(profile.model)
  if (!model) {
    return { state: 'skipped', reason: 'no-model' }
  }

  const routeId =
    resolveRouteIdFromBaseUrl(profile.baseUrl) ??
    resolveProfileRoute(profile.provider).routeId

  let models: string[] | null = null

  if (routeId === 'anthropic') {
    models = await fetchAnthropicModelIds(profile.baseUrl, profile.apiKey)
  } else if (routeId === 'gemini') {
    models = await fetchGeminiModelIds(profile.apiKey)
  } else if (routeId && routeId !== 'custom' && routeId !== 'unknown-fallback') {
    const result = await discoverModelsForRoute(routeId, {
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      headers: profile.customHeaders,
      forceRefresh: true,
    })
    if (result && result.source !== 'error') {
      models = result.models.map(entry => entry.apiName)
    }
  }

  models ??= await fetchOpenAICompatibleModelIds(profile.baseUrl, profile.apiKey)

  if (!models || models.length === 0) {
    return { state: 'skipped', reason: 'model-list-unavailable' }
  }

  if (modelInList(model, models)) {
    return { state: 'ok' }
  }

  return {
    state: 'missing',
    providerName: profile.name,
    model,
  }
}
