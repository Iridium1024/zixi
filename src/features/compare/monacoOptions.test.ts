import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPARE_PREFERENCES } from './comparePreferences'
import { compactGutterDecorationWidth, monacoWrappingOptions } from './monacoOptions'

describe('Monaco wrap preferences', () => {
  it('reduces the combined gutter by one quarter without truncating long line numbers', () => {
    for (const lines of [10, 1000, 100000]) {
      const numbers = Math.max(3, String(lines).length) * 8
      const compact = numbers + 16 + compactGutterDecorationWidth(28, 8, lines, true)
      expect(compact).toBe(Math.round((28 + numbers + 10 + 16) * .75))
      expect(compact).toBeGreaterThan(numbers)
    }
    expect(compactGutterDecorationWidth(28, 8, 100000, false)).toBe(8)
  })
  it('maps all supported wrap modes to Monaco options', () => {
    expect(monacoWrappingOptions({ ...DEFAULT_COMPARE_PREFERENCES, wordWrap: 'window' })).toMatchObject({ wordWrap: 'on', wrappingStrategy: 'advanced' })
    expect(monacoWrappingOptions({ ...DEFAULT_COMPARE_PREFERENCES, wordWrap: 'column', wordWrapColumn: 126 })).toMatchObject({ wordWrap: 'wordWrapColumn', wordWrapColumn: 126 })
    expect(monacoWrappingOptions({ ...DEFAULT_COMPARE_PREFERENCES, wordWrap: 'off' })).toMatchObject({ wordWrap: 'off' })
  })
})
