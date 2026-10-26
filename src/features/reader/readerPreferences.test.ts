import { describe, expect, it } from 'vitest'
import { DEFAULT_READER_PREFERENCES, normalizeReaderPreferences } from './readerPreferences'

describe('reader preferences', () => {
  it('adds safe standalone-window defaults to older saved settings', () => {
    const value = normalizeReaderPreferences({ readingMode: 'paged', fontSize: 18 })
    expect(value.readingMode).toBe('paged')
    expect(value.autoTurnChapterOnWheel).toBe(true)
    expect(value.standaloneAlwaysOnTop).toBe(false)
    expect(value.backgroundOpacity).toBe(DEFAULT_READER_PREFERENCES.backgroundOpacity)
    expect(value.firstLineIndent).toBe(0)
    expect(value.restoreShortcut).toBe('Control+Alt+B')
  })

  it('clamps standalone opacity to the readable range', () => {
    expect(normalizeReaderPreferences({ backgroundOpacity: -.2 }).backgroundOpacity).toBe(0)
    expect(normalizeReaderPreferences({ backgroundOpacity: 2 }).backgroundOpacity).toBe(1)
  })

  it('accepts only the supported recovery shortcuts', () => {
    expect(normalizeReaderPreferences({ restoreShortcut: 'Alt+Shift+B' }).restoreShortcut).toBe('Alt+Shift+B')
    expect(normalizeReaderPreferences({ restoreShortcut: 'Control+B' }).restoreShortcut).toBe('Control+Alt+B')
  })
})
