import { describe, it, expect } from 'bun:test'
import cyberide from './index.js'

describe('Cyberide Command', () => {
  it('has proper command metadata', () => {
    expect(cyberide.name).toBe('cyberide')
    expect(cyberide.type).toBe('local')
    expect(cyberide.supportsNonInteractive).toBe(true)
  })

  it('loads module and exports call function', async () => {
    const mod = await cyberide.load()
    expect(typeof mod.call).toBe('function')
  })
})
