/**
 * Provider detection for the welcome header.
 * Returns a clean model name + provider label for display in the welcome box.
 * This is a React component hook — must be called inside a component.
 */

import * as React from 'react';
import { useMainLoopModel } from '../hooks/useMainLoopModel.js';
import { useAppState } from '../state/AppState.js';
import { getRuntimeMainLoopModel, renderModelName } from './model/model.js';
import { detectProvider } from '../components/StartupScreen.js';
import { loadProfileFile } from './providerProfile.js';
import { hasAnthropicApiKeyAuth, getAuthTokenSource } from './auth.js';
import { isEnvTruthy } from './envUtils.js';
import { isLocalProviderUrl } from '../services/api/providerConfig.js';
import { detectProviderFromEnv } from './providerAutoDetect.js';

export const KNOWN_PROVIDER_API_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_API_KEYS',
  'CODEX_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'MISTRAL_API_KEY',
  'GROQ_API_KEY',
  'DEEPSEEK_API_KEY',
  'XAI_API_KEY',
  'NVIDIA_API_KEY',
  'MINIMAX_API_KEY',
  'OPENROUTER_API_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'BNKR_API_KEY',
  'ATLAS_CLOUD_API_KEY',
  'FIREWORKS_API_KEY',
  'NEARAI_API_KEY',
  'MIMO_API_KEY',
  'VENICE_API_KEY',
  'OPENCODE_API_KEY',
] as const;

export type IsModelConfiguredOptions = {
  env?: NodeJS.ProcessEnv;
  checkDisk?: boolean;
};

/**
 * Checks whether an AI model/provider is actively configured with valid credentials,
 * a persisted profile, a local server endpoint, or cloud provider environment.
 */
export function isModelConfigured(
  optionsOrEnv: NodeJS.ProcessEnv | IsModelConfiguredOptions = process.env,
): boolean {
  const isOptions =
    optionsOrEnv &&
    typeof optionsOrEnv === 'object' &&
    ('env' in optionsOrEnv || 'checkDisk' in optionsOrEnv);

  const env: NodeJS.ProcessEnv = isOptions
    ? (optionsOrEnv as IsModelConfiguredOptions).env ?? process.env
    : (optionsOrEnv as NodeJS.ProcessEnv);

  const checkDisk = isOptions
    ? ((optionsOrEnv as IsModelConfiguredOptions).checkDisk ?? (env === process.env))
    : (env === process.env);

  // 1. Saved provider profile on disk (e.g. .soteria-profile.json)
  if (checkDisk) {
    try {
      const profile = loadProfileFile();
      if (profile) return true;
    } catch {
      // Ignore profile read errors
    }
  }

  // 2. Anthropic authentication (API key, OAuth token, keychain, or helper)
  try {
    if (env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.trim().length > 0) {
      return true;
    }
    if (env.ANTHROPIC_AUTH_TOKEN && env.ANTHROPIC_AUTH_TOKEN.trim().length > 0) {
      return true;
    }
    if (env.CLAUDE_CODE_OAUTH_TOKEN && env.CLAUDE_CODE_OAUTH_TOKEN.trim().length > 0) {
      return true;
    }
    if (checkDisk) {
      if (hasAnthropicApiKeyAuth()) return true;
      if (getAuthTokenSource().hasToken) return true;
    }
  } catch {
    // Ignore auth resolution errors
  }

  // 3. Known third-party provider API keys in environment
  for (const key of KNOWN_PROVIDER_API_KEYS) {
    const val = env[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return true;
    }
  }

  // 4. Cloud vendor environments (Bedrock / Vertex / Foundry)
  if (
    isEnvTruthy(env.CLAUDE_CODE_USE_BEDROCK) ||
    isEnvTruthy(env.CLAUDE_CODE_USE_VERTEX) ||
    isEnvTruthy(env.CLAUDE_CODE_USE_FOUNDRY)
  ) {
    return true;
  }

  // 5. Local provider endpoints that do not require API keys
  const baseUrls = [
    env.OPENAI_BASE_URL,
    env.OPENAI_API_BASE,
    env.ANTHROPIC_BASE_URL,
    env.GEMINI_BASE_URL,
    env.MISTRAL_BASE_URL,
  ];
  for (const url of baseUrls) {
    if (url && isLocalProviderUrl(url)) {
      return true;
    }
  }

  // 6. Zero-config provider autodetection from env/disk
  try {
    const detected = detectProviderFromEnv({
      env,
      hasCodexAuth: checkDisk ? undefined : () => false,
    });
    if (detected) {
      return true;
    }
  } catch {
    // Ignore
  }

  // 7. Check if detected provider itself is local (e.g. Ollama endpoint)
  if (checkDisk) {
    try {
      const detected = detectProvider();
      if (detected.isLocal) return true;
    } catch {
      // Ignore
    }
  }

  return false;
}

export type WelcomeProviderInfo = {
  model: string;
  provider: string;
  isConfigured: boolean;
};

export function useWelcomeProviderInfo(): WelcomeProviderInfo {
  const mainLoopModel = useMainLoopModel();
  const permissionMode = useAppState(s => s.toolPermissionContext.mode);
  const configured = isModelConfigured();

  return React.useMemo(() => {
    const runtimeModel = getRuntimeMainLoopModel({
      permissionMode,
      mainLoopModel,
      exceeds200kTokens: false,
    });

    const modelName = renderModelName(runtimeModel);
    const detected = detectProvider();

    return {
      model: configured ? modelName : 'No model selected',
      provider: configured ? detected.name : 'Select using /model',
      isConfigured: configured,
    };
  }, [mainLoopModel, permissionMode, configured]);
}

