import { loadSetting, saveSetting } from '../settings/settingsRepository'
import type { ReaderPreferences } from './types'

const CACHE_KEY = 'zixi.reader.preferences.v4'
const LEGACY_CACHE_KEY = 'zixi.reader.preferences.v2'
const LEGACY_V3_CACHE_KEY = 'zixi.reader.preferences.v3'
export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  fontSize: 20,
  lineHeight: 1.9,
  fontFamily: 'serif',
  contentWidth: 760,
  readingMode: 'chapter-scroll',
  autoOpenRecent: false,
  openAfterImport: false,
  autoTurnChapterOnWheel: true,
  standaloneAlwaysOnTop: false,
  backgroundOpacity: 0.94,
  textColor: '',
  textShadow: true,
  firstLineIndent: 2,
  restoreShortcut: 'Control+Alt+B',
}

export function normalizeReaderPreferences(value: unknown): ReaderPreferences {
  const input = value && typeof value === 'object' ? value as Partial<ReaderPreferences> : {}
  const legacyInput = input as Partial<ReaderPreferences> & { standaloneOpacity?: number }
  const existingPreferences = Boolean(value && typeof value === 'object')
  const fontSize = typeof input.fontSize === 'number' ? Math.min(32, Math.max(14, input.fontSize)) : 20
  const lineHeight = typeof input.lineHeight === 'number' ? Math.min(2.4, Math.max(1.4, input.lineHeight)) : 1.9
  const contentWidth = input.contentWidth === 640 || input.contentWidth === 880 ? input.contentWidth : 760
  return {
    fontSize,
    lineHeight,
    fontFamily: input.fontFamily === 'sans' ? 'sans' : 'serif',
    contentWidth,
    readingMode: input.readingMode === 'paged' ? 'paged' : 'chapter-scroll',
    autoOpenRecent: input.autoOpenRecent === true,
    openAfterImport: input.openAfterImport === true,
    autoTurnChapterOnWheel: input.autoTurnChapterOnWheel !== false,
    standaloneAlwaysOnTop: input.standaloneAlwaysOnTop === true,
    backgroundOpacity: typeof input.backgroundOpacity === 'number'
      ? Math.min(1, Math.max(0, input.backgroundOpacity))
      : typeof legacyInput.standaloneOpacity === 'number' ? Math.min(1, Math.max(0, legacyInput.standaloneOpacity)) : 0.94,
    textColor: typeof input.textColor === 'string' && (input.textColor === '' || /^#[0-9a-f]{6}$/i.test(input.textColor)) ? input.textColor : '',
    textShadow: input.textShadow !== false,
    firstLineIndent: typeof input.firstLineIndent === 'number'
      ? Math.min(8, Math.max(0, Math.round(input.firstLineIndent)))
      : existingPreferences ? 0 : 2,
    restoreShortcut: input.restoreShortcut === 'Control+Shift+B' || input.restoreShortcut === 'Alt+Shift+B'
      ? input.restoreShortcut
      : 'Control+Alt+B',
  }
}

export function readCachedReaderPreferences(): ReaderPreferences {
  try { return normalizeReaderPreferences(JSON.parse(localStorage.getItem(CACHE_KEY) ?? localStorage.getItem(LEGACY_V3_CACHE_KEY) ?? localStorage.getItem(LEGACY_CACHE_KEY) ?? 'null')) } catch { return DEFAULT_READER_PREFERENCES }
}

export async function loadReaderPreferences(): Promise<ReaderPreferences> {
  return normalizeReaderPreferences(await loadSetting<unknown>('reader-preferences') ?? readCachedReaderPreferences())
}

export async function persistReaderPreferences(value: ReaderPreferences): Promise<void> {
  localStorage.setItem(CACHE_KEY, JSON.stringify(value))
  await saveSetting('reader-preferences', value)
}
