import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { homedir } from 'os'
import { join } from 'path'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

import { isInGlobalClaudeFolder } from '../components/permissions/FilePermissionDialog/permissionOptions.tsx'
import { optionForPermissionSaveDestination } from '../components/permissions/rules/AddPermissionRules.tsx'
import { getDefaultPermissionModeOptions } from './permissions/defaultPermissionModeOptions.ts'
import {
  getClaudeSkillScope,
  isClaudeSettingsPath,
} from './permissions/filesystem.ts'
import { getValidationTip } from './settings/validationTips.ts'

const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

beforeEach(async () => {
  await acquireSharedMutationLock('soteriaUiSurfaces.test.ts')
})

afterEach(() => {
  try {
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    }
  } finally {
    releaseSharedMutationLock()
  }
})

describe('Soteria settings path surfaces', () => {
  test('isClaudeSettingsPath recognizes project .soteria settings files', () => {
    expect(
      isClaudeSettingsPath(
        join(process.cwd(), '.soteria', 'settings.json'),
      ),
    ).toBe(true)

    expect(
      isClaudeSettingsPath(
        join(process.cwd(), '.soteria', 'settings.local.json'),
      ),
    ).toBe(true)
  })

  test('permission save destinations point user settings to ~/.soteria', () => {
    expect(optionForPermissionSaveDestination('userSettings')).toEqual({
      label: 'User settings',
      description: 'Saved in ~/.soteria/settings.json',
      value: 'userSettings',
    })
  })

  test('permission save destinations point project settings to .soteria', () => {
    expect(optionForPermissionSaveDestination('projectSettings')).toEqual({
      label: 'Project settings',
      description: 'Checked in at .soteria/settings.json',
      value: 'projectSettings',
    })

    expect(optionForPermissionSaveDestination('localSettings')).toEqual({
      label: 'Project settings (local)',
      description: 'Saved in .soteria/settings.local.json',
      value: 'localSettings',
    })
  })

  test('permission dialog treats ~/.soteria as the global Claude folder', () => {
    process.env.CLAUDE_CONFIG_DIR = join(homedir(), '.soteria')

    expect(
      isInGlobalClaudeFolder(
        join(homedir(), '.soteria', 'settings.json'),
      ),
    ).toBe(true)
    expect(
      isInGlobalClaudeFolder(join(homedir(), '.claude', 'settings.json')),
    ).toBe(true)
  })

  test('permission dialog does not treat arbitrary CLAUDE_CONFIG_DIR as the global Claude folder', () => {
    process.env.CLAUDE_CONFIG_DIR = join(homedir(), 'custom-soteria')

    expect(
      isInGlobalClaudeFolder(
        join(homedir(), 'custom-soteria', 'settings.json'),
      ),
    ).toBe(false)
  })

  test('global skill scope recognizes ~/.soteria and legacy ~/.claude skills', () => {
    process.env.CLAUDE_CONFIG_DIR = join(homedir(), '.soteria')

    expect(
      getClaudeSkillScope(
        join(homedir(), '.soteria', 'skills', 'demo', 'SKILL.md'),
      ),
    ).toEqual({
      skillName: 'demo',
      pattern: '~/.soteria/skills/demo/**',
    })

    expect(
      getClaudeSkillScope(
        join(homedir(), '.claude', 'skills', 'legacy', 'SKILL.md'),
      ),
    ).toEqual({
      skillName: 'legacy',
      pattern: '~/.claude/skills/legacy/**',
    })
  })

  test('global skill scope does not emit fixed rules for arbitrary CLAUDE_CONFIG_DIR skills', () => {
    process.env.CLAUDE_CONFIG_DIR = join(homedir(), 'custom-soteria')

    expect(
      getClaudeSkillScope(
        join(homedir(), 'custom-soteria', 'skills', 'demo', 'SKILL.md'),
      ),
    ).toBe(null)
  })
})

describe('Soteria validation tips', () => {
  test('permissions.defaultMode invalid value keeps suggestion but no Claude docs link', () => {
    const tip = getValidationTip({
      path: 'permissions.defaultMode',
      code: 'invalid_value',
      enumValues: [
        'acceptEdits',
        'bypassPermissions',
        'default',
        'dontAsk',
        'fullAccess',
        'plan',
      ],
    })

    expect(tip).toEqual({
      suggestion:
        'Valid modes: "acceptEdits" (ask before file changes), "plan" (analysis only), "bypassPermissions" (auto-accept prompts), "fullAccess" (skip even hard safety-check prompts), or "default" (standard behavior)',
    })
  })
})

describe('Soteria permission mode surfaces', () => {
  test('default permission mode picker excludes dangerous persisted modes', () => {
    const options = getDefaultPermissionModeOptions(true)

    expect(options).not.toContain('bypassPermissions')
    expect(options).not.toContain('fullAccess')
  })
})
