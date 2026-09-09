import { describe, expect, it } from 'bun:test';
import { isModelConfigured, KNOWN_PROVIDER_API_KEYS } from './providerWelcome.js';

describe('isModelConfigured', () => {
  it('returns false for an empty environment with no keys, profile, or local endpoints', () => {
    const emptyEnv: NodeJS.ProcessEnv = {};
    expect(isModelConfigured({ env: emptyEnv, checkDisk: false })).toBe(false);
  });

  it('returns false when provider keys contain only empty strings or whitespace', () => {
    const blankEnv: NodeJS.ProcessEnv = {
      ANTHROPIC_API_KEY: '   ',
      OPENAI_API_KEY: '',
      GEMINI_API_KEY: '  \t  ',
    };
    expect(isModelConfigured({ env: blankEnv, checkDisk: false })).toBe(false);
  });

  it('returns true when ANTHROPIC_API_KEY is present', () => {
    const env: NodeJS.ProcessEnv = {
      ANTHROPIC_API_KEY: 'sk-ant-api03-test-token',
    };
    expect(isModelConfigured({ env, checkDisk: false })).toBe(true);
  });

  it('returns true for known 3rd-party provider API keys', () => {
    for (const key of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'MISTRAL_API_KEY', 'GROQ_API_KEY', 'DEEPSEEK_API_KEY', 'XAI_API_KEY', 'OPENROUTER_API_KEY', 'GITHUB_TOKEN']) {
      const env: NodeJS.ProcessEnv = { [key]: 'test-key-value' };
      expect(isModelConfigured({ env, checkDisk: false })).toBe(true);
    }
  });

  it('returns true when cloud provider flags are set', () => {
    expect(isModelConfigured({ env: { CLAUDE_CODE_USE_BEDROCK: '1' }, checkDisk: false })).toBe(true);
    expect(isModelConfigured({ env: { CLAUDE_CODE_USE_VERTEX: 'true' }, checkDisk: false })).toBe(true);
    expect(isModelConfigured({ env: { CLAUDE_CODE_USE_FOUNDRY: '1' }, checkDisk: false })).toBe(true);
  });

  it('returns true when pointing to a local provider endpoint (Ollama / LocalAI)', () => {
    expect(isModelConfigured({ env: { OPENAI_BASE_URL: 'http://localhost:11434/v1' }, checkDisk: false })).toBe(true);
    expect(isModelConfigured({ env: { OPENAI_BASE_URL: 'http://127.0.0.1:8000/v1' }, checkDisk: false })).toBe(true);
    expect(isModelConfigured({ env: { ANTHROPIC_BASE_URL: 'http://localhost:8080' }, checkDisk: false })).toBe(true);
  });

  it('returns false when base URL is remote and no API key is provided', () => {
    expect(isModelConfigured({ env: { OPENAI_BASE_URL: 'https://api.openai.com/v1' }, checkDisk: false })).toBe(false);
  });
});
