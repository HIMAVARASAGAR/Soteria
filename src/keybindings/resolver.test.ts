import { describe, expect, test } from 'bun:test'
import { parseBindings } from './parser.js'
import {
  getBindingDisplayText,
  resolveKeyWithChordState,
} from './resolver.js'

describe('Chord resolver with fallback action', () => {
  const bindings = parseBindings([
    {
      context: 'Chat',
      bindings: {
        'ctrl+x': 'chat:cancel',
        escape: 'chat:cancel',
        'ctrl+x ctrl+k': 'chat:killAgents',
        'ctrl+x ctrl+e': 'chat:externalEditor',
      },
    },
  ])

  test('returns chord_started with fallbackAction when prefix has exact match', () => {
    const key = {
      ctrl: true,
      name: 'x',
      shift: false,
      meta: false,
      super: false,
      escape: false,
    } as any

    const result = resolveKeyWithChordState('x', key, ['Chat'], bindings, null)

    expect(result.type).toBe('chord_started')
    if (result.type === 'chord_started') {
      expect(result.fallbackAction).toBe('chat:cancel')
      expect(result.pending).toHaveLength(1)
      expect(result.pending[0]!.key).toBe('x')
      expect(result.pending[0]!.ctrl).toBe(true)
    }
  })

  test('resolves full chord sequence when second key is pressed', () => {
    const firstKey = {
      ctrl: true,
      name: 'x',
      shift: false,
      meta: false,
      super: false,
      escape: false,
    } as any

    const firstResult = resolveKeyWithChordState('x', firstKey, ['Chat'], bindings, null)
    expect(firstResult.type).toBe('chord_started')

    const secondKey = {
      ctrl: true,
      name: 'k',
      shift: false,
      meta: false,
      super: false,
      escape: false,
    } as any

    const secondResult = resolveKeyWithChordState(
      'k',
      secondKey,
      ['Chat'],
      bindings,
      (firstResult as any).pending,
    )

    expect(secondResult.type).toBe('match')
    if (secondResult.type === 'match') {
      expect(secondResult.action).toBe('chat:killAgents')
    }
  })

  test('preserves Esc as preferred display text for chat:cancel', () => {
    const displayText = getBindingDisplayText('chat:cancel', 'Chat', bindings)
    expect(displayText).toBe('Esc')
  })

  test('single escape matches chat:cancel immediately without chord wait', () => {
    const escKey = {
      ctrl: false,
      name: 'escape',
      shift: false,
      meta: false,
      super: false,
      escape: true,
    } as any

    const result = resolveKeyWithChordState('\x1b', escKey, ['Chat'], bindings, null)
    expect(result.type).toBe('match')
    if (result.type === 'match') {
      expect(result.action).toBe('chat:cancel')
    }
  })
})
