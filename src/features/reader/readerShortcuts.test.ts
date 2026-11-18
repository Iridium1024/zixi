import { describe, expect, it } from 'vitest'
import { DEFAULT_READER_SHORTCUTS, normalizeShortcuts, readerAction } from './readerShortcuts'
import { normalizeReaderPreferences } from './readerPreferences'

describe('reader shortcut preferences', () => {
  it('preserves legacy opacity and enables a safe panel shortcut on upgrade', () => {
    const prefs = normalizeReaderPreferences({ backgroundOpacity: .94 })
    expect(prefs.backgroundOpacity).toBe(.94)
    expect(prefs.hideTitlebar).toBe(false)
    expect(prefs.shortcuts.panel).toBe('B')
  })
  it('rejects duplicate bindings and dispatches customized modifiers exactly', () => {
    expect(normalizeShortcuts({ panel: 'ArrowUp' })).toEqual(DEFAULT_READER_SHORTCUTS)
    const shortcuts = normalizeShortcuts({ panel: 'Ctrl+Shift+M' })
    expect(readerAction(new KeyboardEvent('keydown', { key: 'M', ctrlKey: true, shiftKey: true }), shortcuts)).toBe('panel')
    expect(readerAction(new KeyboardEvent('keydown', { key: 'M', ctrlKey: true }), shortcuts)).toBeUndefined()
  })
})
