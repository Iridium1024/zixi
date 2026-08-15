import { describe, expect, it } from 'vitest'
import {
  BUNDLED_SERIF_STACK,
  compareEditorLineHeight,
  DEFAULT_APPEARANCE,
  normalizeAppearance,
} from './appearance'

describe('normalizeAppearance', () => {
  it('migrates the legacy contrast preset into light theme plus accessibility contrast', () => {
    const migrated = normalizeAppearance({
      theme: 'contrast',
      accent: '#005fcc',
      chromeOpacity: 0.7,
      uiFontSize: 20,
    })

    expect(migrated.version).toBe(4)
    expect(migrated.themeMode).toBe('light')
    expect(migrated.accessibility.increasedContrast).toBe(true)
    expect(migrated.background.surfaceOpacity).toBe(0.82)
    expect(migrated.uiFontSize).toBe(20)
  })

  it('drops unsafe font identifiers and invalid resources without breaking defaults', () => {
    const normalized = normalizeAppearance({
      themeMode: 'dark',
      importedFonts: [{
        id: 'font-1',
        internalFamily: 'bad; font-family: injected',
        displayName: 'Bad',
        sourceFileName: 'bad.ttf',
        storedPath: 'bad.ttf',
        format: 'ttf',
      }],
      fonts: { uiFontId: 'font-1' },
      background: { asset: { format: 'svg' } },
    })

    expect(normalized.themeMode).toBe('dark')
    expect(normalized.importedFonts).toEqual([])
    expect(normalized.fonts.uiFontId).toBe('bundled-noto-serif-sc')
    expect(normalized.background.asset).toBeNull()
  })

  it('uses calm defaults for corrupt input', () => {
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE)
  })

  it('accepts every integer UI size from 12 through 22', () => {
    for (let size = 12; size <= 22; size += 1) {
      expect(normalizeAppearance({ version: 4, uiFontSize: size }).uiFontSize).toBe(size)
    }
  })

  it('keeps the bundled family and Chinese serif aliases in the safe fallback stack', () => {
    expect(BUNDLED_SERIF_STACK).toContain("'Noto Serif SC'")
    expect(BUNDLED_SERIF_STACK).toContain("'Noto Serif CJK SC'")
    expect(BUNDLED_SERIF_STACK).toContain("'Source Han Serif SC'")
    expect(BUNDLED_SERIF_STACK).toContain("'思源宋体'")
    expect(BUNDLED_SERIF_STACK).toMatch(/'SimSun', serif$/)
  })

  it('migrates the v3 appearance without changing its other choices and adds 15px comparison text', () => {
    const migrated = normalizeAppearance({
      version: 3,
      themeMode: 'dark',
      uiFontSize: 18,
      accent: '#123456',
      fonts: { uiFontId: null, editorFontId: null, noteDefaultFontId: null },
    })

    expect(migrated).toMatchObject({
      version: 4,
      themeMode: 'dark',
      uiFontSize: 18,
      compareEditorFontSize: 15,
      accent: '#123456',
      fonts: { uiFontId: null, editorFontId: null, noteDefaultFontId: null },
    })
  })

  it('normalizes comparison text size to whole pixels within 12–28 and derives bounded line height', () => {
    for (let size = 12; size <= 28; size += 1) {
      expect(normalizeAppearance({ version: 4, compareEditorFontSize: size }).compareEditorFontSize).toBe(size)
    }
    expect(normalizeAppearance({ version: 4, compareEditorFontSize: 11 }).compareEditorFontSize).toBe(12)
    expect(normalizeAppearance({ version: 4, compareEditorFontSize: 29 }).compareEditorFontSize).toBe(28)
    expect(normalizeAppearance({ version: 4, compareEditorFontSize: 15.5 }).compareEditorFontSize).toBe(15)
    expect(normalizeAppearance({ version: 4, compareEditorFontSize: 'bad' }).compareEditorFontSize).toBe(15)
    expect(compareEditorLineHeight(12)).toBe(20)
    expect(compareEditorLineHeight(15)).toBe(25)
    expect(compareEditorLineHeight(28)).toBe(46)
  })
})
