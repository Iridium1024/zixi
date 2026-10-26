import { describe, expect, it } from 'vitest'
import { DEFAULT_WINDOW_BEHAVIOR, normalizeWindowBehavior } from './windowBehavior'

describe('window behavior preferences', () => {
  it('preserves the existing note and compare defaults', () => {
    expect(normalizeWindowBehavior(null)).toEqual(DEFAULT_WINDOW_BEHAVIOR)
    expect(DEFAULT_WINDOW_BEHAVIOR.note).toEqual({ open: 'hide', close: 'keep' })
    expect(DEFAULT_WINDOW_BEHAVIOR.compare).toEqual({ open: 'keep', close: 'keep' })
    expect(DEFAULT_WINDOW_BEHAVIOR.reader).toEqual({ open: 'keep', close: 'keep' })
  })

  it('normalizes each independent-window behavior separately', () => {
    expect(normalizeWindowBehavior({
      note: { open: 'minimize', close: 'show' },
      compare: { open: 'hide', close: 'show' },
      reader: { open: 'minimize', close: 'show' },
    })).toEqual({
      version: 2,
      note: { open: 'minimize', close: 'show' },
      compare: { open: 'hide', close: 'show' },
      reader: { open: 'minimize', close: 'show' },
    })
  })

  it('falls back per invalid field without discarding valid choices', () => {
    expect(normalizeWindowBehavior({ note: { open: 'invalid', close: 'show' } }).note)
      .toEqual({ open: 'hide', close: 'show' })
  })
})
