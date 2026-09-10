import { afterAll, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from './test/sharedMutationLock.js'

const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'PermissionRequest',
  'PermissionDenied',
  'Setup',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
  'Elicitation',
  'ElicitationResult',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'InstructionsLoaded',
  'CwdChanged',
  'FileChanged',
] as const

await acquireSharedMutationLock('tools.cybersecurity.test.ts')

mock.module('./entrypoints/agentSdkTypes.js', () => ({ HOOK_EVENTS }))
mock.module('src/entrypoints/agentSdkTypes.js', () => ({ HOOK_EVENTS }))

const { getAllBaseTools } = await import('./tools.js')

afterAll(() => {
  try {
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

test('registers all 6 deterministic security tools in getAllBaseTools()', () => {
  const tools = getAllBaseTools()
  const toolNames = tools.map(t => t.name)

  expect(toolNames).toContain('audit_dependencies')
  expect(toolNames).toContain('scan_secrets')
  expect(toolNames).toContain('security_scan')
  expect(toolNames).toContain('taint_analysis')
  expect(toolNames).toContain('audit_container')
  expect(toolNames).toContain('generate_sbom')
})
