import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPARE_PREFERENCES } from './comparePreferences'
import { monacoWrappingOptions } from './monacoOptions'

describe('Monaco wrap preferences', () => {
  it('maps all supported wrap modes to Monaco options', () => {
    expect(monacoWrappingOptions({ ...DEFAULT_COMPARE_PREFERENCES, wordWrap: 'window' })).toMatchObject({ wordWrap: 'on', wrappingStrategy: 'advanced' })
    expect(monacoWrappingOptions({ ...DEFAULT_COMPARE_PREFERENCES, wordWrap: 'column', wordWrapColumn: 126 })).toMatchObject({ wordWrap: 'wordWrapColumn', wordWrapColumn: 126 })
    expect(monacoWrappingOptions({ ...DEFAULT_COMPARE_PREFERENCES, wordWrap: 'off' })).toMatchObject({ wordWrap: 'off' })
  })
})
