import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPARE_PREFERENCES, normalizeComparePreferences, normalizeComparisonRule, ruleForPreset } from './comparePreferences'

describe('ComparePreferences', () => {
  it('normalizes missing, malformed and out-of-range values to safe defaults', () => {
    expect(normalizeComparePreferences(null)).toEqual(DEFAULT_COMPARE_PREFERENCES)
    const normalized = normalizeComparePreferences({ layout: 'bad', wordWrap: 'column', wordWrapColumn: 999, lineNumbers: 'yes', whitespace: 'bad', syncScroll: 0, rule: { preset: 'custom', whitespace: 'bad', unicode: 'bad' } })
    expect(normalized).toMatchObject({ layout: 'auto', wordWrap: 'column', wordWrapColumn: 200, lineNumbers: true, whitespace: 'selection', syncScroll: true })
    expect(normalized.rule).toMatchObject({ preset: 'custom', caseSensitive: true, whitespace: 'trim-trailing', unicode: 'nfc' })
  })

  it('keeps all preset semantics deterministic and returns immutable copies', () => {
    const review = ruleForPreset('review')
    review.caseSensitive = false
    expect(ruleForPreset('review').caseSensitive).toBe(true)
    expect(normalizeComparisonRule({ preset: 'relaxed', caseSensitive: true })).toEqual(ruleForPreset('relaxed'))
  })
})
