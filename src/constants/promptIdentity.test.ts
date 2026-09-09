import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

const originalSimpleEnv = process.env.CLAUDE_CODE_SIMPLE
const originalMacro = (globalThis as Record<string, unknown>).MACRO
const hadOriginalMacro = Object.hasOwn(globalThis, 'MACRO')

let clearSystemPromptSections: typeof import('./systemPromptSections.js').clearSystemPromptSections
let getSystemPrompt: typeof import('./prompts.js').getSystemPrompt
let DEFAULT_AGENT_PROMPT: typeof import('./prompts.js').DEFAULT_AGENT_PROMPT
let OUTPUT_STYLE_CONFIG: typeof import('./outputStyles.js').OUTPUT_STYLE_CONFIG
let CLI_SYSPROMPT_PREFIXES: typeof import('./system.js').CLI_SYSPROMPT_PREFIXES
let getCLISyspromptPrefix: typeof import('./system.js').getCLISyspromptPrefix
let getCoordinatorSystemPrompt: typeof import('../coordinator/coordinatorMode.js').getCoordinatorSystemPrompt

beforeAll(async () => {
  await acquireSharedMutationLock('constants/promptIdentity.test.ts')

  // MACRO is replaced at build time by Bun.define but not in test mode.
  // Define it globally under the shared lock before importing modules that use it.
  ;(globalThis as Record<string, unknown>).MACRO = {
    VERSION: '99.0.0',
    DISPLAY_VERSION: '0.0.0-test',
    BUILD_TIME: new Date().toISOString(),
    ISSUES_EXPLAINER:
      'report the issue at https://github.com/HIMAVARASAGAR/Soteria/issues',
    PACKAGE_URL: '@himavarasagar/soteria',
    NATIVE_PACKAGE_URL: undefined,
  }

  ;({ clearSystemPromptSections } = await import('./systemPromptSections.js'))
  ;({ getSystemPrompt, DEFAULT_AGENT_PROMPT } = await import('./prompts.js'))
  ;({ OUTPUT_STYLE_CONFIG } = await import('./outputStyles.js'))
  ;({ CLI_SYSPROMPT_PREFIXES, getCLISyspromptPrefix } = await import('./system.js'))
  ;({ getCoordinatorSystemPrompt } = await import(
    '../coordinator/coordinatorMode.js'
  ))
})

afterAll(() => {
  try {
    if (hadOriginalMacro) {
      ;(globalThis as Record<string, unknown>).MACRO = originalMacro
    } else {
      delete (globalThis as Record<string, unknown>).MACRO
    }
  } finally {
    releaseSharedMutationLock()
  }
})

afterEach(() => {
  if (originalSimpleEnv === undefined) {
    delete process.env.CLAUDE_CODE_SIMPLE
  } else {
    process.env.CLAUDE_CODE_SIMPLE = originalSimpleEnv
  }
  clearSystemPromptSections()
})

test('CLI identity prefixes describe Soteria balanced identity', () => {
  expect(getCLISyspromptPrefix()).toContain('Soteria')
  expect(getCLISyspromptPrefix()).toContain('general-purpose assistant')
  expect(getCLISyspromptPrefix()).toContain(
    'strong cybersecurity analysis capabilities',
  )
  expect(getCLISyspromptPrefix()).not.toContain('OpenClaude')
  expect(getCLISyspromptPrefix()).not.toContain('Claude Code')
  expect(getCLISyspromptPrefix()).not.toContain('coding agent')

  for (const prefix of CLI_SYSPROMPT_PREFIXES) {
    expect(prefix).toContain('Soteria')
    expect(prefix).toContain('general-purpose assistant')
    expect(prefix).not.toContain('Claude Code')
    expect(prefix).not.toContain('OpenClaude')
    expect(prefix).not.toContain('coding agent')
  }
})

test('simple mode identity describes Soteria balanced identity', async () => {
  process.env.CLAUDE_CODE_SIMPLE = '1'

  const prompt = await getSystemPrompt([], 'gpt-4o')

  expect(prompt[0]).toContain('Soteria')
  expect(prompt[0]).toContain('general-purpose assistant')
  expect(prompt[0]).toContain('strong cybersecurity analysis capabilities')
  expect(prompt[0]).not.toContain('OpenClaude')
  expect(prompt[0]).not.toContain('Claude Code')
  expect(prompt[0]).not.toContain('coding agent')
})

test('system prompt model identity updates when model changes mid-session', async () => {
  delete process.env.CLAUDE_CODE_SIMPLE
  clearSystemPromptSections()

  const firstPrompt = await getSystemPrompt([], 'old-test-model')
  const secondPrompt = await getSystemPrompt([], 'new-test-model')

  const firstText = firstPrompt.join('\n')
  const secondText = secondPrompt.join('\n')

  expect(firstText).toContain('You are powered by the model old-test-model.')
  expect(secondText).toContain('You are powered by the model new-test-model.')
  expect(secondText).not.toContain('You are powered by the model old-test-model.')
})

test('default agent prompt describes Soteria balanced identity', () => {
  expect(DEFAULT_AGENT_PROMPT).toContain('Soteria')
  expect(DEFAULT_AGENT_PROMPT).toContain('general-purpose assistant')
  expect(DEFAULT_AGENT_PROMPT).toContain(
    'strong cybersecurity analysis capabilities',
  )
  expect(DEFAULT_AGENT_PROMPT).not.toContain('OpenClaude')
  expect(DEFAULT_AGENT_PROMPT).not.toContain('Claude Code')
  expect(DEFAULT_AGENT_PROMPT).not.toContain('coding agent')
})

test('main prompt preserves normal conversation behavior', async () => {
  const prompt = (await getSystemPrompt([], 'gpt-4o')).join('\n')

  expect(prompt).toContain(
    'For non-technical or conversational requests, respond normally without forcing a security frame.',
  )
  expect(prompt).toContain('ordinary questions')
  expect(prompt).not.toContain(
    'The user will primarily request you to perform software engineering tasks',
  )
})

test('main prompt triggers security posture for technical assets', async () => {
  const prompt = (await getSystemPrompt([], 'gpt-4o')).join('\n')

  expect(prompt).toContain(
    'When the request involves a repository, application, website, log file, infrastructure, configuration, cloud resource, dependency, or other technical system',
  )
  expect(prompt).toContain('identify attack surface')
  expect(prompt).toContain('assess vulnerabilities and impact')
})

test('main prompt preserves explicit coding behavior', async () => {
  const prompt = (await getSystemPrompt([], 'gpt-4o')).join('\n')

  expect(prompt).toContain(
    'When the user explicitly asks for a code change, implement the targeted change after reading the relevant code',
  )
  expect(prompt).toContain(
    'do not expand a simple coding request into a full audit unless asked',
  )
  expect(prompt).toContain('When implementing code changes')
})

test('built-in output styles use balanced Soteria identity', () => {
  const explanatory = OUTPUT_STYLE_CONFIG.Explanatory
  const learning = OUTPUT_STYLE_CONFIG.Learning

  expect(explanatory?.description).toContain('Soteria')
  expect(explanatory?.prompt).toContain('Soteria')
  expect(explanatory?.prompt).toContain('security evidence')
  expect(explanatory?.prompt).toContain('implementation choices')
  expect(explanatory?.prompt).not.toContain('software engineering tasks')

  expect(learning?.description).toContain('Soteria')
  expect(learning?.prompt).toContain('analyzing evidence')
  expect(learning?.prompt).toContain(
    'writing small pieces of code when the task is explicitly implementation-focused',
  )
  expect(learning?.prompt).not.toContain('software engineering tasks')
})

test('coordinator prompt supports security analysis and targeted implementation', () => {
  const prompt = getCoordinatorSystemPrompt()

  expect(prompt).toContain('Soteria')
  expect(prompt).toContain('cybersecurity analysis')
  expect(prompt).toContain('targeted remediation')
  expect(prompt).toContain(
    'whether the task is general, coding, or security-focused',
  )
  expect(prompt).toContain(
    'Make targeted changes only when requested or clearly required by the task',
  )
  expect(prompt).not.toContain('orchestrates software engineering tasks')
  expect(prompt).not.toContain('Claude Code')
})
