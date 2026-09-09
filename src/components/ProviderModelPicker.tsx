/**
 * ProviderModelPicker.tsx
 *
 * Unified provider + model selection wizard invoked by /model.
 * Flow: pick provider → configure once → pick/type model → test → save & activate.
 */
import * as React from 'react'
import type { LocalJSXCommandOnDone } from '../types/command.js'
import { Box, Text } from '../ink.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import type { ProviderProfile } from '../utils/config.js'
import {
  Select,
  type OptionWithDescription,
} from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'
import { FuzzyPicker } from './design-system/FuzzyPicker.js'
import { LoadingState } from './design-system/LoadingState.js'
import TextInput from './TextInput.js'
import {
  buildGeminiProfileEnv,
  buildMistralProfileEnv,
  buildOpenAIProfileEnv,
  buildOllamaProfileEnv,
  buildNvidiaNimProfileEnv,
  buildGroqProfileEnv,
  buildDeepSeekProfileEnv,
  buildOpenRouterProfileEnv,
  sanitizeApiKey,
  type ProfileEnv,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_MISTRAL_BASE_URL,
  DEFAULT_MISTRAL_MODEL,
} from '../utils/providerProfile.js'
import {
  getOllamaChatBaseUrl,
  type OllamaGenerationReadiness,
} from '../utils/providerDiscovery.js'
import { probeRouteReadiness } from '../integrations/discoveryService.js'
import { useSetAppState } from '../state/AppState.js'
import {
  addProviderProfile,
  getActiveProviderProfile,
  getProviderProfiles,
  setActiveProviderProfile,
  type ProviderProfileInput,
  updateProviderProfile,
} from '../utils/providerProfiles.js'
import { getPrimaryModel } from '../utils/providerModels.js'
import { clearStartupProviderOverrides } from '../utils/providerStartupOverrides.js'

// ─── Types ────────────────────────────────────────────────────────────────────

/** All providers shown in the picker. OpenAI-compatible providers still use OpenAI-shaped env at runtime. */
type ProviderKey =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'mistral'
  | 'groq'
  | 'deepseek'
  | 'openrouter'
  | 'xai'
  | 'nvidia-nim'
  | 'ollama'
  | 'custom'

type Step =
  | { name: 'choose' }
  | { name: 'provider-action'; provider: ProviderKey; profile: ProviderProfile }
  | {
      name: 'base-url'
      provider: ProviderKey
      apiKey?: string
      defaultModel: string
      initialBaseUrl?: string
      savedProfile?: ProviderProfile
    }
  | {
      name: 'api-key'
      provider: ProviderKey
      defaultModel: string
      baseUrl?: string
      savedProfile?: ProviderProfile
      allowEmpty?: boolean
    }
  | {
      name: 'model'
      provider: ProviderKey
      apiKey: string
      baseUrl?: string
      defaultModel: string
      authMode?: 'api-key' | 'adc'
      savedProfile?: ProviderProfile
    }
  | { name: 'ollama-detect' }
  | { name: 'ollama-model'; models: string[]; baseUrl: string }
  | { name: 'gemini-auth' }
  | { name: 'gemini-key' }
  | { name: 'gemini-model'; apiKey?: string; authMode: 'api-key' | 'adc' }
  | { name: 'testing'; message: string }
  | { name: 'done'; message: string }
  | { name: 'error'; message: string; backStep: Step }

type ProviderMeta = {
  label: string
  description: string
  keyEnvVars?: string[]
  defaultModel: string
  baseUrl?: string
  requiresKey: boolean
  profile: string
}

// ─── Provider catalogue ───────────────────────────────────────────────────────

const PROVIDERS: Record<ProviderKey, ProviderMeta> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    description: 'Claude Sonnet/Opus via api.anthropic.com',
    keyEnvVars: ['ANTHROPIC_API_KEY'],
    defaultModel: 'claude-sonnet-4-5',
    baseUrl: 'https://api.anthropic.com',
    requiresKey: true,
    profile: 'anthropic',
  },
  openai: {
    label: 'OpenAI (GPT)',
    description: 'GPT-4o, o3 and more via api.openai.com',
    keyEnvVars: ['OPENAI_API_KEY'],
    defaultModel: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
    requiresKey: true,
    profile: 'openai',
  },
  gemini: {
    label: 'Google Gemini',
    description: 'Gemini Flash/Pro via Google AI Studio',
    keyEnvVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    defaultModel: DEFAULT_GEMINI_MODEL,
    baseUrl: DEFAULT_GEMINI_BASE_URL,
    requiresKey: true,
    profile: 'gemini',
  },
  mistral: {
    label: 'Mistral AI',
    description: 'Mistral and Codestral models',
    keyEnvVars: ['MISTRAL_API_KEY'],
    defaultModel: DEFAULT_MISTRAL_MODEL,
    baseUrl: DEFAULT_MISTRAL_BASE_URL,
    requiresKey: true,
    profile: 'mistral',
  },
  groq: {
    label: 'Groq',
    description: 'Ultra-fast inference — Llama 3.3, Mixtral, Gemma',
    keyEnvVars: ['GROQ_API_KEY', 'OPENAI_API_KEY'],
    defaultModel: 'llama-3.3-70b-versatile',
    baseUrl: 'https://api.groq.com/openai/v1',
    requiresKey: true,
    profile: 'groq',
  },
  deepseek: {
    label: 'DeepSeek',
    description: 'DeepSeek Chat and Coder models',
    keyEnvVars: ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY'],
    defaultModel: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    requiresKey: true,
    profile: 'deepseek',
  },
  openrouter: {
    label: 'OpenRouter',
    description: 'Access 200+ models through one endpoint',
    keyEnvVars: ['OPENROUTER_API_KEY', 'OPENAI_API_KEY'],
    defaultModel: 'anthropic/claude-sonnet-4-5',
    baseUrl: 'https://openrouter.ai/api/v1',
    requiresKey: true,
    profile: 'openrouter',
  },
  xai: {
    label: 'xAI (Grok)',
    description: 'Grok models via api.x.ai',
    keyEnvVars: ['XAI_API_KEY'],
    defaultModel: 'grok-4',
    baseUrl: 'https://api.x.ai/v1',
    requiresKey: true,
    profile: 'xai',
  },
  'nvidia-nim': {
    label: 'NVIDIA NIM',
    description: 'NVIDIA-hosted models via integrate.api.nvidia.com',
    keyEnvVars: ['NVIDIA_API_KEY'],
    defaultModel: 'nvidia/llama-3.1-nemotron-70b-instruct',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    requiresKey: true,
    profile: 'nvidia-nim',
  },
  ollama: {
    label: 'Ollama (local)',
    description: 'Local models via Ollama — no API key needed',
    defaultModel: '',
    requiresKey: false,
    profile: 'ollama',
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    description: 'Any OpenAI-compatible endpoint',
    keyEnvVars: ['OPENAI_API_KEY'],
    defaultModel: 'gpt-4o',
    baseUrl: 'http://localhost:11434/v1',
    requiresKey: false,
    profile: 'custom',
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getProviderStatus(key: ProviderKey): 'active' | 'saved' | 'none' {
  const meta = PROVIDERS[key]
  const profiles = getProviderProfiles()
  const saved = findSavedProfileForProvider(key, profiles)
  const activeProfile = getActiveProviderProfile()
  const active =
    Boolean(saved && activeProfile?.id === saved.id) ||
    (key === 'anthropic' && !process.env.CLAUDE_CODE_USE_OPENAI && !process.env.CLAUDE_CODE_USE_GEMINI && !process.env.CLAUDE_CODE_USE_MISTRAL) ||
    (key === 'openai' && process.env.CLAUDE_CODE_USE_OPENAI === '1' &&
      (!process.env.OPENAI_BASE_URL ||
        (meta.baseUrl && process.env.OPENAI_BASE_URL?.includes(new URL(meta.baseUrl).hostname)))) ||
    (key === 'gemini' && process.env.CLAUDE_CODE_USE_GEMINI === '1') ||
    (key === 'mistral' && process.env.CLAUDE_CODE_USE_MISTRAL === '1') ||
    (key === 'groq' && process.env.OPENAI_BASE_URL?.includes('groq.com')) ||
    (key === 'deepseek' && process.env.OPENAI_BASE_URL?.includes('deepseek.com')) ||
    (key === 'openrouter' && process.env.OPENAI_BASE_URL?.includes('openrouter.ai')) ||
    (key === 'xai' && process.env.OPENAI_BASE_URL?.includes('x.ai')) ||
    (key === 'nvidia-nim' && process.env.NVIDIA_NIM === '1') ||
    (key === 'ollama' && process.env.OPENAI_BASE_URL?.includes('11434'))

  if (active) return 'active'
  if (saved) return 'saved'
  return 'none'
}

function statusBadge(status: 'active' | 'saved' | 'none'): string {
  switch (status) {
    case 'active': return '✓ active'
    case 'saved': return '● saved'
    case 'none': return '○'
  }
}

function normalizeBaseUrl(value: string | undefined): string {
  return value?.trim().replace(/\/+$/, '').toLowerCase() ?? ''
}

function getProviderApiKeyFromEnv(meta: ProviderMeta): string | undefined {
  for (const envVar of meta.keyEnvVars ?? []) {
    const value = process.env[envVar]?.trim()
    if (value) {
      return value
    }
  }
  return undefined
}

function findSavedProfileForProvider(
  provider: ProviderKey,
  profiles = getProviderProfiles(),
) {
  const meta = PROVIDERS[provider]
  const wantedBaseUrl = normalizeBaseUrl(meta.baseUrl)
  return profiles.find(profile => {
    const profileBaseUrl = normalizeBaseUrl(profile.baseUrl)
    const providerMatches = profile.provider === meta.profile
    const legacyOpenAICompatibleMatch =
      wantedBaseUrl &&
      profileBaseUrl === wantedBaseUrl &&
      (profile.provider === 'openai' || profile.provider === 'custom')

    if (!providerMatches && !legacyOpenAICompatibleMatch) {
      return false
    }
    return !wantedBaseUrl || profileBaseUrl === wantedBaseUrl
  })
}

function profileInputForProvider(
  provider: ProviderKey,
  apiKey: string,
  model: string,
  baseUrl?: string,
  authMode?: 'api-key' | 'adc',
): ProviderProfileInput {
  const meta = PROVIDERS[provider]
  return {
    provider: meta.profile,
    name: meta.label,
    baseUrl: baseUrl ?? meta.baseUrl ?? '',
    model,
    apiKey: authMode === 'adc' ? undefined : sanitizeApiKey(apiKey) || undefined,
    apiFormat: 'chat_completions',
  }
}

async function buildEnvForProvider(
  provider: ProviderKey,
  apiKey: string,
  model: string,
  baseUrl?: string,
  authMode: 'api-key' | 'adc' = 'api-key',
): Promise<ProfileEnv | null> {
  switch (provider) {
    case 'anthropic':
      return {
        ANTHROPIC_API_KEY: apiKey,
        ANTHROPIC_MODEL: model,
        ...(baseUrl ? { ANTHROPIC_BASE_URL: baseUrl } : {}),
      }
    case 'openai':
      return buildOpenAIProfileEnv({
        goal: 'balanced',
        apiKey,
        model,
        baseUrl: baseUrl ?? null,
      })
    case 'gemini':
      return buildGeminiProfileEnv({ apiKey, model, authMode })
    case 'mistral':
      return buildMistralProfileEnv({ apiKey, model, baseUrl })
    case 'groq':
      return buildGroqProfileEnv({ apiKey, model })
    case 'deepseek':
      return buildDeepSeekProfileEnv({ apiKey, model })
    case 'openrouter':
      return buildOpenRouterProfileEnv({ apiKey, model })
    case 'xai': {
      const key = sanitizeApiKey(apiKey)
      if (!key) return null
      return {
        OPENAI_BASE_URL: 'https://api.x.ai/v1',
        OPENAI_MODEL: model || 'grok-4',
        OPENAI_API_KEY: key,
        XAI_API_KEY: key,
      }
    }
    case 'nvidia-nim':
      return buildNvidiaNimProfileEnv({ apiKey, model, baseUrl })
    case 'ollama':
      return buildOllamaProfileEnv(model, { getOllamaChatBaseUrl, baseUrl })
    case 'custom':
      if (!apiKey.trim()) {
        return {
          OPENAI_BASE_URL: baseUrl ?? PROVIDERS.custom.baseUrl ?? '',
          OPENAI_MODEL: model || PROVIDERS.custom.defaultModel,
        }
      }
      return buildOpenAIProfileEnv({
        goal: 'balanced',
        apiKey,
        model,
        baseUrl: baseUrl ?? null,
      })
    default:
      return null
  }
}

async function testConnection(
  provider: ProviderKey,
  env: ProfileEnv,
): Promise<string | null> {
  // For Anthropic: use native SDK. For all others: use fetch to /v1/models or a ping.
  try {
    const baseUrl =
      env.ANTHROPIC_BASE_URL ?? env.OPENAI_BASE_URL ?? env.GEMINI_BASE_URL ??
      env.MISTRAL_BASE_URL
    const apiKey =
      env.ANTHROPIC_API_KEY ?? env.OPENAI_API_KEY ?? env.GEMINI_API_KEY ??
      env.MISTRAL_API_KEY ?? env.XAI_API_KEY ?? env.NVIDIA_API_KEY

    if (provider === 'anthropic') {
      // Ping Anthropic with a minimal request
      const url = `${env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'}/v1/models`
      const resp = await fetch(url, {
        headers: {
          'x-api-key': apiKey ?? '',
          'anthropic-version': '2023-06-01',
        },
      })
      if (!resp.ok && resp.status !== 200) {
        const body = await resp.text().catch(() => '')
        return `API returned ${resp.status}: ${body.slice(0, 120)}`
      }
      return null
    }

    if (provider === 'gemini') {
      // Gemini supports /v1beta/models endpoint
      const key = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
      const resp = await fetch(url)
      if (!resp.ok) {
        return `Gemini API returned ${resp.status}`
      }
      return null
    }

    if (provider === 'ollama') {
      const url = `${env.OPENAI_BASE_URL?.replace('/v1', '') ?? 'http://localhost:11434'}/api/tags`
      const resp = await fetch(url)
      if (!resp.ok) {
        return `Could not reach Ollama (${resp.status}). Is it running?`
      }
      return null
    }

    // Default: probe /v1/models for OpenAI-compat providers
    if (!baseUrl) {
      return 'Missing base URL or API key'
    }
    if (!apiKey && provider !== 'custom') {
      return 'Missing base URL or API key'
    }
    const url = `${baseUrl.replace(/\/$/, '')}/models`
    const resp = await fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    })
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        return `Authentication failed (${resp.status})`
      }
      return `Provider returned ${resp.status}`
    }
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TextEntryStep({
  title,
  subtitle,
  description,
  placeholder,
  mask,
  initialValue = '',
  allowEmpty = false,
  onSubmit,
  onCancel,
}: {
  title: string
  subtitle?: string
  description: string
  placeholder?: string
  mask?: string
  initialValue?: string
  allowEmpty?: boolean
  onSubmit: (value: string) => void
  onCancel: () => void
}): React.ReactNode {
  const { columns } = useTerminalSize()
  const [value, setValue] = React.useState(initialValue)
  const [cursor, setCursor] = React.useState(initialValue.length)
  const [error, setError] = React.useState<string | null>(null)

  const handleSubmit = React.useCallback(
    (v: string) => {
      const trimmed = v.trim()
      if (!trimmed && !allowEmpty) {
        setError('A value is required.')
        return
      }
      setError(null)
      onSubmit(trimmed)
    },
    [allowEmpty, onSubmit],
  )

  return (
    <Dialog title={title} subtitle={subtitle} onCancel={onCancel}>
      <Box flexDirection="column" gap={1}>
        <Text>{description}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder={placeholder}
          mask={mask}
          columns={Math.max(40, columns - 8)}
          cursorOffset={cursor}
          onChangeCursorOffset={setCursor}
          focus
          showCursor
        />
        {error ? <Text color="error">{error}</Text> : null}
      </Box>
    </Dialog>
  )
}

function ModelPickStep({
  provider,
  defaultModel,
  suggestedModels,
  onSubmit,
  onBack,
}: {
  provider: ProviderKey
  defaultModel: string
  suggestedModels: string[]
  onSubmit: (model: string) => void
  onBack: () => void
}): React.ReactNode {
  const { columns } = useTerminalSize()
  const [typing, setTyping] = React.useState(false)
  const [typedModel, setTypedModel] = React.useState('')
  const [cursor, setCursor] = React.useState(0)
  const [query, setQuery] = React.useState('')

  type ModelPickItem =
    | { kind: 'custom'; query: string }
    | { kind: 'model'; model: string }

  const normalizedQuery = query.trim().toLowerCase()
  const filteredModels = suggestedModels.filter(model =>
    !normalizedQuery || model.toLowerCase().includes(normalizedQuery),
  )
  const items: ModelPickItem[] = [
    { kind: 'custom', query },
    ...filteredModels.map(model => ({ kind: 'model' as const, model })),
  ]

  if (typing) {
    return (
      <Dialog title="Enter model ID" subtitle={PROVIDERS[provider].label} onCancel={() => setTyping(false)}>
        <Box flexDirection="column" gap={1}>
          <Text dimColor>Type the exact model ID for {PROVIDERS[provider].label}</Text>
          <TextInput
            value={typedModel}
            onChange={setTypedModel}
            onSubmit={v => { if (v.trim()) onSubmit(v.trim()) }}
            placeholder={defaultModel}
            columns={Math.max(40, columns - 8)}
            cursorOffset={cursor}
            onChangeCursorOffset={setCursor}
            focus
            showCursor
          />
        </Box>
      </Dialog>
    )
  }

  return (
    <FuzzyPicker
      title={`Choose a model · ${PROVIDERS[provider].label}`}
      placeholder="Search models..."
      initialQuery=""
      items={items}
      getKey={item => item.kind === 'custom' ? `custom:${item.query}` : item.model}
      visibleCount={Math.min(items.length, 10)}
      direction="down"
      onQueryChange={setQuery}
      onSelect={item => {
        if (item.kind === 'custom') {
          const next = item.query.trim()
          setTypedModel(next)
          setCursor(next.length)
          setTyping(true)
          return
        }
        onSubmit(item.model)
      }}
      onCancel={onBack}
      emptyMessage="No matching models"
      selectAction="select model"
      matchLabel={`${filteredModels.length} model${filteredModels.length === 1 ? '' : 's'}`}
      renderItem={(item, isFocused) => {
        if (item.kind === 'custom') {
          const label = item.query.trim()
            ? `Type custom model ID: ${item.query.trim()}`
            : 'Type custom model ID...'
          return <Text color={isFocused ? 'suggestion' : undefined}>{label}</Text>
        }
        return (
          <Text color={isFocused ? 'suggestion' : undefined}>
            {item.model}
            {item.model === defaultModel ? <Text dimColor> default</Text> : null}
          </Text>
        )
      }}
    />
  )
}

function ProviderActionStep({
  provider,
  profile,
  onUseSaved,
  onEditCredentials,
  onBack,
}: {
  provider: ProviderKey
  profile: ProviderProfile
  onUseSaved: () => void
  onEditCredentials: () => void
  onBack: () => void
}): React.ReactNode {
  const meta = PROVIDERS[provider]
  const options: OptionWithDescription<'use' | 'edit'>[] = [
    {
      value: 'use',
      label: 'Use saved credentials',
      description: `Fetch models from ${profile.baseUrl}`,
    },
    {
      value: 'edit',
      label: 'Edit credentials',
      description: 'Update API key or endpoint for this provider',
    },
  ]

  return (
    <Dialog title={meta.label} subtitle="Provider already configured" onCancel={onBack}>
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Saved provider: {profile.name}</Text>
        <Text dimColor>Endpoint: {profile.baseUrl}</Text>
        <Select
          options={options}
          inlineDescriptions
          visibleOptionCount={options.length}
          onChange={value => {
            if (value === 'use') {
              onUseSaved()
            } else {
              onEditCredentials()
            }
          }}
          onCancel={onBack}
        />
      </Box>
    </Dialog>
  )
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

export type ProviderModelPickerProps = {
  onDone: LocalJSXCommandOnDone
}

export function ProviderModelPicker({ onDone }: ProviderModelPickerProps): React.ReactNode {
  const [step, setStep] = React.useState<Step>({ name: 'choose' })
  const [discoveredModels, setDiscoveredModels] = React.useState<Record<string, string[]>>({})
  const setAppState = useSetAppState()

  // Auto-close on done — MUST be above all early returns to keep hook order stable.
  const doneStep = step.name === 'done' ? step : null
  React.useEffect(() => {
    if (!doneStep) return
    const t = setTimeout(() => onDone(doneStep.message, { display: 'system' }), 100)
    return () => clearTimeout(t)
  }, [doneStep])

  // ── Step: choose provider ──────────────────────────────────────────────────
  if (step.name === 'choose') {
    const options: OptionWithDescription<ProviderKey | 'cancel'>[] = (
      Object.entries(PROVIDERS) as [ProviderKey, ProviderMeta][]
    ).map(([key, meta]) => {
      const status = getProviderStatus(key)
      return {
        value: key,
        label: `${meta.label}  ${statusBadge(status)}`,
        description: meta.description,
      }
    })

    return (
      <Dialog
        title="Select a provider"
        subtitle="Choose the AI provider to use for this session"
        onCancel={() => onDone('Provider selection cancelled.', { display: 'system' })}
      >
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text dimColor>✓ active  ● saved config  ○ not configured</Text>
          </Box>
          <Select
            options={options}
            inlineDescriptions
            visibleOptionCount={Math.min(options.length, 10)}
            onChange={(key: ProviderKey | 'cancel') => {
              if (key === 'cancel') {
                onDone('Provider selection cancelled.', { display: 'system' })
                return
              }
              const meta = PROVIDERS[key]
              if (key === 'ollama') {
                setStep({ name: 'ollama-detect' })
                return
              }

              const saved = findSavedProfileForProvider(key)
              if (saved) {
                setStep({ name: 'provider-action', provider: key, profile: saved })
                return
              }

              if (key === 'custom') {
                setStep({
                  name: 'base-url',
                  provider: key,
                  defaultModel: meta.defaultModel,
                  initialBaseUrl: meta.baseUrl,
                })
              } else if (key === 'gemini') {
                const saved = findSavedProfileForProvider(key)
                const existingKey = saved?.apiKey ?? getProviderApiKeyFromEnv(meta)
                if (existingKey) {
                  setStep({
                    name: 'gemini-model',
                    apiKey: existingKey,
                    authMode: 'api-key',
                  })
                } else {
                  setStep({ name: 'gemini-auth' })
                }
              } else {
                const saved = findSavedProfileForProvider(key)
                const existingKey = saved?.apiKey ?? getProviderApiKeyFromEnv(meta)
                if (existingKey || !meta.requiresKey) {
                  // Jump straight to model selection
                  setStep({
                    name: 'model',
                    provider: key,
                    apiKey: existingKey ?? '',
                    baseUrl: saved?.baseUrl ?? meta.baseUrl,
                    defaultModel: saved?.model ?? meta.defaultModel,
                  })
                } else {
                  setStep({
                    name: 'api-key',
                    provider: key,
                    defaultModel: meta.defaultModel,
                    baseUrl: meta.baseUrl,
                  })
                }
              }
            }}
            onCancel={() => onDone('Provider selection cancelled.', { display: 'system' })}
          />
        </Box>
      </Dialog>
    )
  }

  // ── Step: saved-provider action ────────────────────────────────────────────
  if (step.name === 'provider-action') {
    return (
      <ProviderActionStep
        provider={step.provider}
        profile={step.profile}
        onUseSaved={() => {
          setStep({
            name: 'testing',
            message: `Validating saved ${PROVIDERS[step.provider].label} credentials…`,
          })
          void validateKeyAndAdvance(
            step.provider,
            step.profile.apiKey ?? '',
            step.profile.baseUrl,
            step.profile.model ?? PROVIDERS[step.provider].defaultModel,
            step.profile,
          )
        }}
        onEditCredentials={() => {
          if (step.provider === 'custom') {
            setStep({
              name: 'base-url',
              provider: step.provider,
              apiKey: step.profile.apiKey ?? '',
              defaultModel: step.profile.model ?? PROVIDERS[step.provider].defaultModel,
              initialBaseUrl: step.profile.baseUrl,
              savedProfile: step.profile,
            })
            return
          }

          setStep({
            name: 'api-key',
            provider: step.provider,
            defaultModel: step.profile.model ?? PROVIDERS[step.provider].defaultModel,
            baseUrl: step.profile.baseUrl,
            savedProfile: step.profile,
            allowEmpty: !PROVIDERS[step.provider].requiresKey,
          })
        }}
        onBack={() => setStep({ name: 'choose' })}
      />
    )
  }

  // ── Step: base URL entry ───────────────────────────────────────────────────
  if (step.name === 'base-url') {
    const meta = PROVIDERS[step.provider]
    return (
      <TextEntryStep
        title={`${meta.label} — Base URL`}
        subtitle={step.provider}
        description="Enter the OpenAI-compatible base URL for this provider."
        placeholder={meta.baseUrl ?? 'https://provider.example.com/v1'}
        initialValue={step.initialBaseUrl ?? meta.baseUrl ?? ''}
        onSubmit={baseUrl => {
          setStep({
            name: 'api-key',
            provider: step.provider,
            defaultModel: step.defaultModel,
            baseUrl,
            savedProfile: step.savedProfile,
            allowEmpty: !meta.requiresKey,
          })
        }}
        onCancel={() =>
          step.savedProfile
            ? setStep({ name: 'provider-action', provider: step.provider, profile: step.savedProfile })
            : setStep({ name: 'choose' })
        }
      />
    )
  }

  // ── Step: API key entry ────────────────────────────────────────────────────
  if (step.name === 'api-key') {
    const meta = PROVIDERS[step.provider]
    return (
      <TextEntryStep
        title={`${meta.label} — API key`}
        subtitle={step.provider}
        description={`Enter your ${meta.label} API key. It will be saved with this provider profile.`}
        placeholder={`${meta.keyEnvVars?.[0] ?? 'API_KEY'}=sk-…`}
        mask="*"
        initialValue={step.savedProfile?.apiKey ?? ''}
        allowEmpty={step.allowEmpty}
        onSubmit={key => {
          // Validate the key before showing models.
          setStep({ name: 'testing', message: `Validating ${meta.label} API key…` })
          void validateKeyAndAdvance(
            step.provider,
            key,
            step.baseUrl,
            step.defaultModel,
            step.savedProfile,
          )
        }}
        onCancel={() =>
          step.savedProfile
            ? setStep({ name: 'provider-action', provider: step.provider, profile: step.savedProfile })
            : setStep({ name: 'choose' })
        }
      />
    )
  }

  // ── Inner key-validation helper (runs in api-key step closure) ─────────────
  async function validateKeyAndAdvance(
    provider: ProviderKey,
    apiKey: string,
    baseUrl: string | undefined,
    defaultModel: string,
    savedProfile?: ProviderProfile,
  ): Promise<void> {
    const meta = PROVIDERS[provider]
    try {
      const env = await buildEnvForProvider(provider, apiKey, meta.defaultModel, baseUrl)
      if (!env) {
        setStep({
          name: 'error',
          message: `Could not build profile for ${meta.label}. Check your API key.`,
          backStep: { name: 'api-key', provider, defaultModel, baseUrl, savedProfile },
        })
        return
      }
      const testError = await testConnection(provider, env)
      if (testError) {
        setStep({
          name: 'error',
          message: `API key rejected: ${testError}`,
          backStep: { name: 'api-key', provider, defaultModel, baseUrl, savedProfile },
        })
        return
      }
      setStep({
        name: 'model',
        provider,
        apiKey,
        baseUrl,
        defaultModel,
        savedProfile,
      })
    } catch (err) {
      setStep({
        name: 'error',
        message: err instanceof Error ? err.message : String(err),
        backStep: { name: 'api-key', provider, defaultModel, baseUrl, savedProfile },
      })
    }
  }

  // ── Step: Ollama detection ─────────────────────────────────────────────────
  if (step.name === 'ollama-detect') {
    return (
      <OllamaDetectStep
        onReady={(models, baseUrl) => {
          setDiscoveredModels(prev => ({ ...prev, ollama: models }))
          setStep({ name: 'ollama-model', models, baseUrl })
        }}
        onFail={msg => setStep({ name: 'error', message: msg, backStep: { name: 'choose' } })}
        onBack={() => setStep({ name: 'choose' })}
      />
    )
  }

  // ── Step: Ollama model pick ────────────────────────────────────────────────
  if (step.name === 'ollama-model') {
    return (
      <ModelPickStep
        provider="ollama"
        defaultModel={step.models[0] ?? 'llama3.1:8b'}
        suggestedModels={step.models}
        onSubmit={model => {
          void handleSaveAndActivate('ollama', '', model, step.baseUrl)
        }}
        onBack={() => setStep({ name: 'choose' })}
      />
    )
  }

  // ── Step: Gemini auth method ───────────────────────────────────────────────
  if (step.name === 'gemini-auth') {
    const options: OptionWithDescription<'api-key' | 'adc'>[] = [
      { value: 'api-key', label: 'API key', description: 'Enter a Gemini API key from aistudio.google.com' },
      { value: 'adc', label: 'Application Default Credentials', description: 'Use gcloud auth / GOOGLE_APPLICATION_CREDENTIALS' },
    ]
    return (
      <Dialog title="Google Gemini — auth method" onCancel={() => setStep({ name: 'choose' })}>
        <Select
          options={options}
          inlineDescriptions
          visibleOptionCount={options.length}
          onChange={v => {
            if (v === 'adc') {
              setStep({ name: 'gemini-model', authMode: 'adc' })
            } else {
              setStep({ name: 'gemini-key' })
            }
          }}
          onCancel={() => setStep({ name: 'choose' })}
        />
      </Dialog>
    )
  }

  // ── Step: Gemini key entry ─────────────────────────────────────────────────
  if (step.name === 'gemini-key') {
    return (
      <TextEntryStep
        title="Google Gemini — API key"
        description="Enter your Gemini API key from aistudio.google.com/apikey. It will be saved with this provider profile."
        placeholder="AIza…"
        mask="*"
        onSubmit={key => setStep({ name: 'gemini-model', apiKey: key, authMode: 'api-key' })}
        onCancel={() => setStep({ name: 'gemini-auth' })}
      />
    )
  }

  // ── Step: Gemini model pick ────────────────────────────────────────────────
  if (step.name === 'gemini-model') {
    const cacheKey = `gemini:${DEFAULT_GEMINI_BASE_URL}:${step.authMode}`
    const cached = discoveredModels[cacheKey]
    return (
      <DiscoverModelsAndPick
        provider="gemini"
        apiKey={step.apiKey ?? ''}
        baseUrl={DEFAULT_GEMINI_BASE_URL}
        defaultModel={DEFAULT_GEMINI_MODEL}
        cachedModels={cached}
        onModelsDiscovered={models => {
          setDiscoveredModels(prev => ({ ...prev, [cacheKey]: models }))
        }}
        onSubmit={model => {
          void handleSaveAndActivate('gemini', step.apiKey ?? '', model, undefined, step.authMode)
        }}
        onBack={() => setStep({ name: 'gemini-auth' })}
      />
    )
  }

  // ── Step: Standard model pick ──────────────────────────────────────────────
  if (step.name === 'model') {
    const cacheKey = `${step.provider}:${step.baseUrl ?? ''}`
    const cached = discoveredModels[cacheKey]
    return (
      <DiscoverModelsAndPick
        provider={step.provider}
        apiKey={step.apiKey}
        baseUrl={step.baseUrl}
        defaultModel={step.defaultModel}
        cachedModels={cached}
        onModelsDiscovered={models => {
          setDiscoveredModels(prev => ({ ...prev, [cacheKey]: models }))
        }}
        onSubmit={model => {
          void handleSaveAndActivate(
            step.provider,
            step.apiKey,
            model,
            step.baseUrl,
            step.authMode,
            step.savedProfile,
          )
        }}
        onBack={() => setStep({ name: 'choose' })}
      />
    )
  }

  // ── Step: Testing connection ───────────────────────────────────────────────
  if (step.name === 'testing') {
    return <LoadingState message={step.message} />
  }

  // ── Step: Done ────────────────────────────────────────────────────────────
  if (doneStep) {
    return <LoadingState message={doneStep.message} />
  }

  // ── Step: Error ───────────────────────────────────────────────────────────
  if (step.name === 'error') {
    const back = step.backStep
    return (
      <Dialog title="Error" color="error" onCancel={() => setStep(back)}>
        <Box flexDirection="column" gap={1}>
          <Text color="error">{step.message}</Text>
          <Text dimColor>Press Escape to go back, or Ctrl+C to cancel.</Text>
        </Box>
      </Dialog>
    )
  }

  return null

  // ── Inner save helper ──────────────────────────────────────────────────────
  async function handleSaveAndActivate(
    provider: ProviderKey,
    apiKey: string,
    model: string,
    baseUrl?: string,
    authMode: 'api-key' | 'adc' = 'api-key',
    savedProfile?: ProviderProfile,
  ): Promise<void> {
    const meta = PROVIDERS[provider]
    setStep({ name: 'testing', message: `Testing connection to ${meta.label}…` })
    try {
      const env = await buildEnvForProvider(provider, apiKey, model, baseUrl, authMode)
      if (!env) {
        setStep({
          name: 'error',
          message: `Could not build profile for ${meta.label}. Check your API key.`,
          backStep: { name: 'choose' },
        })
        return
      }

      const testError = await testConnection(provider, env)
      if (testError) {
        setStep({
          name: 'error',
          message: `Connection failed: ${testError}`,
          backStep: { name: 'choose' },
        })
        return
      }

      const payload = profileInputForProvider(provider, apiKey, model, baseUrl, authMode)
      const existing = savedProfile ?? findSavedProfileForProvider(provider)
      const saved = existing
        ? updateProviderProfile(existing.id, payload)
        : addProviderProfile(payload, { makeActive: true })

      if (!saved) {
        setStep({
          name: 'error',
          message: `Could not save profile for ${meta.label}.`,
          backStep: { name: 'choose' },
        })
        return
      }

      const active = setActiveProviderProfile(saved.id)
      if (!active) {
        setStep({
          name: 'error',
          message: `Saved ${meta.label}, but could not activate it.`,
          backStep: { name: 'choose' },
        })
        return
      }

      setAppState(prev => ({
        ...prev,
        mainLoopModel: getPrimaryModel(saved.model),
        mainLoopModelForSession: null,
      }))
      clearStartupProviderOverrides()

      const lines = [
        `✓ Connected to ${meta.label}`,
        `Model: ${model}`,
        ...(baseUrl ? [`Endpoint: ${baseUrl}`] : []),
        `Profile saved: ${saved.name}`,
        'Active immediately for this session.',
      ]
      setStep({ name: 'done', message: lines.join('\n') })
    } catch (err) {
      setStep({
        name: 'error',
        message: err instanceof Error ? err.message : String(err),
        backStep: { name: 'choose' },
      })
    }
  }
}

// ─── Ollama detection sub-component ───────────────────────────────────────────

function OllamaDetectStep({
  onReady,
  onFail,
  onBack,
}: {
  onReady: (models: string[], baseUrl: string) => void
  onFail: (message: string) => void
  onBack: () => void
}): React.ReactNode {
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const readiness = await probeRouteReadiness('ollama') as OllamaGenerationReadiness | null
        if (!readiness || readiness.state === 'unreachable') {
          if (!cancelled) {
            onFail('Could not reach Ollama at http://localhost:11434. Make sure Ollama is running.')
          }
          return
        }
        if (readiness.state === 'no_models') {
          if (!cancelled) {
            onFail('Ollama is running but no models found. Pull a model first, e.g.: ollama pull llama3.1:8b')
          }
          return
        }
        if (readiness.state === 'generation_failed') {
          if (!cancelled) {
            onFail(`Ollama probe failed for ${readiness.probeModel ?? 'model'}. Try: ollama run ${readiness.probeModel ?? 'llama3.1:8b'}`)
          }
          return
        }
        if (readiness.state === 'ready') {
          if (!cancelled) {
            const modelNames = readiness.models?.map((m: { name: string }) => m.name) ?? []
            const baseUrl = getOllamaChatBaseUrl()
            onReady(modelNames, baseUrl)
          }
        }
      } catch (err) {
        if (!cancelled) {
          onFail(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  return <LoadingState message="Detecting Ollama models…" />
}

// ─── Model discovery + pick sub-component ─────────────────────────────────────

function DiscoverModelsAndPick({
  provider,
  apiKey,
  baseUrl,
  defaultModel,
  cachedModels,
  onModelsDiscovered,
  onSubmit,
  onBack,
}: {
  provider: ProviderKey
  apiKey: string
  baseUrl?: string
  defaultModel: string
  cachedModels?: string[]
  onModelsDiscovered: (models: string[]) => void
  onSubmit: (model: string) => void
  onBack: () => void
}): React.ReactNode {
  const [models, setModels] = React.useState<string[]>(cachedModels ?? [])
  const [loading, setLoading] = React.useState(!cachedModels)

  React.useEffect(() => {
    if (cachedModels) return
    let cancelled = false
    void (async () => {
      try {
        const ids = await discoverProviderModelIds(provider, apiKey, baseUrl)
        if (!cancelled && ids.length > 0) {
          setModels(ids)
          onModelsDiscovered(ids)
        }
      } catch {
        // Silently fall back to defaults
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [provider, apiKey, baseUrl])

  // Suggested model list is populated strictly from the live models discovered via the API key.
  // If the provider returned no models (e.g. offline, rate-limited, or endpoint lacks /models),
  // fall back to defaultModel so the user can proceed or type a custom model ID.
  const suggestedList = [
    ...new Set(
      models.length > 0
        ? models
        : (defaultModel ? [defaultModel] : [])
    ),
  ].filter(Boolean)

  if (loading) {
    return <LoadingState message={`Fetching models from ${PROVIDERS[provider].label}…`} />
  }

  return (
    <ModelPickStep
      provider={provider}
      defaultModel={defaultModel}
      suggestedModels={suggestedList}
      onSubmit={onSubmit}
      onBack={onBack}
    />
  )
}

export async function discoverProviderModelIds(
  provider: ProviderKey,
  apiKey: string,
  baseUrl?: string,
): Promise<string[]> {
  const meta = PROVIDERS[provider]
  const endpoint = (baseUrl ?? meta.baseUrl ?? '').replace(/\/+$/, '')

  // 1. Google Gemini
  if (provider === 'gemini') {
    if (!apiKey.trim()) {
      return []
    }
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey.trim()}`,
      )
      if (!resp.ok) {
        return []
      }
      type GeminiModelList = {
        models?: Array<{
          name?: string
          supportedGenerationMethods?: string[]
        }>
      }
      const json = (await resp.json()) as GeminiModelList
      const list = (json.models ?? [])
        .filter(
          model =>
            !model.supportedGenerationMethods ||
            model.supportedGenerationMethods.includes('generateContent'),
        )
        .map(model => model.name?.replace(/^models\//, '').trim() ?? '')
        .filter(Boolean)

      return list.sort((a, b) => {
        const getScore = (s: string) => {
          if (s.includes('2.5')) return 3
          if (s.includes('2.0')) return 2
          if (s.includes('1.5')) return 1
          return 0
        }
        return getScore(b) - getScore(a) || a.localeCompare(b)
      })
    } catch {
      return []
    }
  }

  // 2. Anthropic
  if (provider === 'anthropic') {
    if (!endpoint || !apiKey.trim()) {
      return []
    }
    try {
      const resp = await fetch(`${endpoint}/v1/models`, {
        headers: {
          'x-api-key': apiKey.trim(),
          'anthropic-version': '2023-06-01',
        },
      })
      if (!resp.ok) {
        return []
      }
      type AnthropicModelList = { data?: Array<{ id?: string }> }
      const json = (await resp.json()) as AnthropicModelList
      const list = (json.data ?? [])
        .map(model => model.id?.trim() ?? '')
        .filter(Boolean)

      return list.sort((a, b) => {
        const getScore = (s: string) => {
          if (s.includes('3-7') || s.includes('3.7')) return 4
          if (s.includes('3-5') || s.includes('3.5')) return 3
          if (s.includes('opus')) return 2
          if (s.includes('haiku')) return 1
          return 0
        }
        return getScore(b) - getScore(a) || a.localeCompare(b)
      })
    } catch {
      return []
    }
  }

  // 3. Ollama (local)
  if (provider === 'ollama') {
    try {
      const host = endpoint || 'http://localhost:11434'
      const resp = await fetch(`${host}/api/tags`)
      if (!resp.ok) {
        return []
      }
      type OllamaTagList = { models?: Array<{ name?: string }> }
      const json = (await resp.json()) as OllamaTagList
      return (json.models ?? []).map(m => m.name?.trim() ?? '').filter(Boolean)
    } catch {
      return []
    }
  }

  // 4. OpenAI & OpenAI-compatible providers
  // (openai, groq, deepseek, openrouter, xai, mistral, nvidia-nim, custom)
  if (!endpoint) {
    return []
  }

  const headers: Record<string, string> = {}
  if (apiKey.trim()) {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`
  }

  let resp: Response | null = null
  try {
    resp = await fetch(`${endpoint}/models`, { headers })
    // If returned 404 and endpoint doesn't end in /v1, try appending /v1/models
    if (resp.status === 404 && !endpoint.endsWith('/v1')) {
      resp = await fetch(`${endpoint}/v1/models`, { headers })
    }
  } catch {
    return []
  }

  if (!resp || !resp.ok) {
    return []
  }

  type ModelItem = {
    id?: string
    name?: string
    active?: boolean
    capabilities?: { completion_chat?: boolean }
  }
  type ModelListResp = { data?: ModelItem[] } | ModelItem[]

  let rawList: ModelItem[] = []
  try {
    const json = (await resp.json()) as ModelListResp
    if (Array.isArray(json)) {
      rawList = json
    } else if (Array.isArray(json?.data)) {
      rawList = json.data
    }
  } catch {
    return []
  }

  let filtered = rawList

  if (provider === 'openai') {
    // Exclude non-chat and auxiliary models (embeddings, audio, dalle, moderations, completion-only engines)
    const nonChatRegex =
      /^(text-embedding|embedding|tts|whisper|dall-e|babbage|davinci|text-moderation|canary|omni-moderation)/i
    filtered = filtered.filter(m => {
      const id = m.id ?? m.name ?? ''
      return id && !nonChatRegex.test(id)
    })
  } else if (provider === 'groq') {
    // Filter inactive models and audio/guard models
    const nonChatRegex = /(whisper|distil-whisper|guard|safeguard|playai)/i
    filtered = filtered.filter(m => {
      const id = m.id ?? m.name ?? ''
      return id && m.active !== false && !nonChatRegex.test(id)
    })
  } else if (provider === 'mistral') {
    filtered = filtered.filter(m => {
      const id = m.id ?? m.name ?? ''
      if (!id || id.includes('embed')) return false
      if (m.capabilities && m.capabilities.completion_chat === false) return false
      return true
    })
  }

  const ids = filtered
    .map(m => (m.id ?? m.name ?? '').trim())
    .filter(Boolean)

  const uniqueIds = [...new Set(ids)]

  if (provider === 'openai') {
    uniqueIds.sort((a, b) => {
      const getScore = (id: string) => {
        if (/^o3/i.test(id)) return 10
        if (/^o1/i.test(id)) return 9
        if (/^gpt-4\.5/i.test(id)) return 8
        if (/^gpt-4o/i.test(id)) return 7
        if (/^chatgpt/i.test(id)) return 6
        if (/^gpt-4/i.test(id)) return 5
        return 0
      }
      return getScore(b) - getScore(a) || a.localeCompare(b)
    })
  }

  return uniqueIds
}
