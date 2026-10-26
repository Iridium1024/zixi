import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTE_PREFERENCES,
  normalizeNotePreferences,
  resolveNoteCloseAction,
} from './notePreferences'

describe('note preferences', () => {
  it('uses ask as the safe default', () => {
    expect(normalizeNotePreferences(null)).toEqual(DEFAULT_NOTE_PREFERENCES)
    expect(normalizeNotePreferences({ closeBehavior: 'unknown' })).toEqual(DEFAULT_NOTE_PREFERENCES)
  })

  it.each(['save', 'discard', 'ask'] as const)('accepts %s close behavior', (closeBehavior) => {
    expect(normalizeNotePreferences({ closeBehavior })).toEqual({ version: 1, closeBehavior })
  })

  it('only asks when ask mode has unsaved changes', () => {
    expect(resolveNoteCloseAction('ask', true)).toBe('ask')
    expect(resolveNoteCloseAction('ask', false)).toBe('close')
    expect(resolveNoteCloseAction('save', true)).toBe('save')
    expect(resolveNoteCloseAction('discard', true)).toBe('close')
  })
})
