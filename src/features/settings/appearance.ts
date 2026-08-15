export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'
export type BackgroundFit = 'cover' | 'contain' | 'native'
export type ManagedAssetKind = 'background' | 'font'
export type FontFormat = 'woff2' | 'woff' | 'ttf' | 'otf'
export type BackgroundFormat = 'png' | 'jpeg' | 'webp'

export interface BackgroundAssetRecord {
  id: string
  sourceFileName: string
  storedPath: string
  format: BackgroundFormat
  byteSize: number
  width: number
  height: number
  importedAt: string
}

export interface ImportedFontRecord {
  id: string
  internalFamily: string
  displayName: string
  sourceFileName: string
  storedPath: string
  format: FontFormat
  weight?: string
  style?: 'normal' | 'italic'
  importedAt: string
}

export interface AppearanceSettings {
  version: 4
  themeMode: ThemeMode
  uiFontSize: number
  compareEditorFontSize: number
  accent: string
  background: {
    asset: BackgroundAssetRecord | null
    fit: BackgroundFit
    position: 'center'
    dim: number
    blur: number
    surfaceOpacity: number
  }
  fonts: {
    uiFontId: string | null
    editorFontId: string | null
    noteDefaultFontId: string | null
  }
  importedFonts: ImportedFontRecord[]
  accessibility: {
    increasedContrast: boolean
    reduceTransparency: boolean
    reduceMotion: boolean
  }
}

export const APPEARANCE_STORAGE_KEY = 'zixi.appearance.v4'
export const LEGACY_APPEARANCE_STORAGE_KEYS = ['zixi.appearance.v3', 'zixi.appearance.v2', 'zixi.appearance.v1'] as const

export const BUNDLED_FONT_ID = 'bundled-noto-serif-sc'
export const BUNDLED_FONT_FAMILY = 'Noto Serif SC'
export const UI_FALLBACK_STACK = "'Microsoft YaHei UI', 'Segoe UI', system-ui, sans-serif"
export const EDITOR_FALLBACK_STACK = "'Microsoft YaHei UI', 'PingFang SC', 'Segoe UI', system-ui, sans-serif"
export const NOTE_FALLBACK_STACK = "'Microsoft YaHei UI', 'PingFang SC', 'Segoe UI', system-ui, sans-serif"
export const BUNDLED_SERIF_STACK = `'${BUNDLED_FONT_FAMILY}', 'Noto Serif CJK SC', 'Source Han Serif SC', '思源宋体', 'Songti SC', 'SimSun', serif`

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  version: 4,
  themeMode: 'system',
  uiFontSize: 14,
  compareEditorFontSize: 15,
  accent: '#786aa3',
  background: {
    asset: null,
    fit: 'cover',
    position: 'center',
    dim: 0.32,
    blur: 0,
    surfaceOpacity: 0.94,
  },
  fonts: {
    uiFontId: BUNDLED_FONT_ID,
    editorFontId: BUNDLED_FONT_ID,
    noteDefaultFontId: BUNDLED_FONT_ID,
  },
  importedFonts: [],
  accessibility: {
    increasedContrast: false,
    reduceTransparency: false,
    reduceMotion: false,
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clamp(value: unknown, minimum: number, maximum: number, fallback: number) {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : fallback
}

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number) {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : fallback
}

/** Keeps the paired Monaco editors on the same, readable text rhythm. */
export function compareEditorLineHeight(fontSize: number) {
  return Math.min(46, Math.max(20, Math.round(fontSize * 5 / 3)))
}

function nullableString(value: unknown) {
  return typeof value === 'string' && value ? value : null
}

function normalizeAccent(value: unknown) {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : DEFAULT_APPEARANCE.accent
}

function normalizeBackgroundAsset(value: unknown): BackgroundAssetRecord | null {
  if (!isRecord(value)) return null
  const format = value.format
  if (format !== 'png' && format !== 'jpeg' && format !== 'webp') return null
  if (
    typeof value.id !== 'string'
    || typeof value.sourceFileName !== 'string'
    || typeof value.storedPath !== 'string'
  ) return null
  return {
    id: value.id,
    sourceFileName: value.sourceFileName,
    storedPath: value.storedPath,
    format,
    byteSize: clamp(value.byteSize, 0, 24 * 1024 * 1024, 0),
    width: clamp(value.width, 1, 20_000, 1),
    height: clamp(value.height, 1, 20_000, 1),
    importedAt: typeof value.importedAt === 'string' ? value.importedAt : new Date(0).toISOString(),
  }
}

function normalizeFont(value: unknown): ImportedFontRecord | null {
  if (!isRecord(value)) return null
  const format = value.format
  if (format !== 'woff2' && format !== 'woff' && format !== 'ttf' && format !== 'otf') return null
  if (
    typeof value.id !== 'string'
    || typeof value.internalFamily !== 'string'
    || !/^ZixiImported_[A-Za-z0-9_]+$/.test(value.internalFamily)
    || typeof value.displayName !== 'string'
    || typeof value.sourceFileName !== 'string'
    || typeof value.storedPath !== 'string'
  ) return null
  return {
    id: value.id,
    internalFamily: value.internalFamily,
    displayName: value.displayName.slice(0, 80),
    sourceFileName: value.sourceFileName,
    storedPath: value.storedPath,
    format,
    weight: typeof value.weight === 'string' ? value.weight : undefined,
    style: value.style === 'italic' ? 'italic' : 'normal',
    importedAt: typeof value.importedAt === 'string' ? value.importedAt : new Date(0).toISOString(),
  }
}

export function normalizeAppearance(value: unknown): AppearanceSettings {
  const input = isRecord(value) ? value : {}
  const backgroundInput = isRecord(input.background) ? input.background : {}
  const fontInput = isRecord(input.fonts) ? input.fonts : {}
  const accessibilityInput = isRecord(input.accessibility) ? input.accessibility : {}
  const legacyTheme = input.theme
  const themeMode: ThemeMode = input.themeMode === 'light' || input.themeMode === 'dark' || input.themeMode === 'system'
    ? input.themeMode
    : legacyTheme === 'dark'
      ? 'dark'
      : legacyTheme === 'light' || legacyTheme === 'contrast'
        ? 'light'
        : DEFAULT_APPEARANCE.themeMode
  const importedFonts = Array.isArray(input.importedFonts)
    ? input.importedFonts.map(normalizeFont).filter((font): font is ImportedFontRecord => Boolean(font))
    : []
  const knownFontIds = new Set(importedFonts.map((font) => font.id))
  const normalizeFontId = (candidate: unknown) => {
    const id = nullableString(candidate)
    if (id === BUNDLED_FONT_ID) return id
    return id && knownFontIds.has(id) ? id : null
  }
  const legacyAccent = normalizeAccent(input.accent)

  return {
    version: 4,
    themeMode,
    uiFontSize: clamp(input.uiFontSize, 12, 22, DEFAULT_APPEARANCE.uiFontSize),
    compareEditorFontSize: clampInteger(
      input.compareEditorFontSize,
      12,
      28,
      DEFAULT_APPEARANCE.compareEditorFontSize,
    ),
    accent: input.version !== 2 && input.version !== 3 && input.version !== 4 && legacyAccent === '#5678d4'
      ? DEFAULT_APPEARANCE.accent
      : legacyAccent,
    background: {
      asset: normalizeBackgroundAsset(backgroundInput.asset),
      fit: backgroundInput.fit === 'contain' || backgroundInput.fit === 'native'
        ? backgroundInput.fit
        : 'cover',
      position: 'center',
      dim: clamp(backgroundInput.dim, 0, 0.78, DEFAULT_APPEARANCE.background.dim),
      blur: clamp(backgroundInput.blur, 0, 24, DEFAULT_APPEARANCE.background.blur),
      surfaceOpacity: clamp(
        backgroundInput.surfaceOpacity ?? input.chromeOpacity,
        0.82,
        1,
        DEFAULT_APPEARANCE.background.surfaceOpacity,
      ),
    },
    fonts: {
      uiFontId: input.version === 3 || input.version === 4 ? normalizeFontId(fontInput.uiFontId) : normalizeFontId(fontInput.uiFontId) ?? BUNDLED_FONT_ID,
      editorFontId: input.version === 3 || input.version === 4 ? normalizeFontId(fontInput.editorFontId) : normalizeFontId(fontInput.editorFontId) ?? BUNDLED_FONT_ID,
      noteDefaultFontId: input.version === 3 || input.version === 4 ? normalizeFontId(fontInput.noteDefaultFontId) : normalizeFontId(fontInput.noteDefaultFontId) ?? BUNDLED_FONT_ID,
    },
    importedFonts,
    accessibility: {
      increasedContrast: Boolean(accessibilityInput.increasedContrast || legacyTheme === 'contrast'),
      reduceTransparency: Boolean(accessibilityInput.reduceTransparency),
      reduceMotion: Boolean(accessibilityInput.reduceMotion),
    },
  }
}

export function readCachedAppearance(): AppearanceSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_APPEARANCE
  for (const key of [APPEARANCE_STORAGE_KEY, ...LEGACY_APPEARANCE_STORAGE_KEYS]) {
    try {
      const raw = localStorage.getItem(key)
      if (raw) return normalizeAppearance(JSON.parse(raw))
    } catch {
      // Ignore corrupt cache and continue to the next safe fallback.
    }
  }
  return DEFAULT_APPEARANCE
}

export function cacheAppearance(value: AppearanceSettings) {
  localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(normalizeAppearance(value)))
}

export function fontById(settings: AppearanceSettings, id: string | null) {
  return id ? settings.importedFonts.find((font) => font.id === id) ?? null : null
}

export function fontStack(settings: AppearanceSettings, id: string | null, fallback: string) {
  if (id === BUNDLED_FONT_ID) return BUNDLED_SERIF_STACK
  const font = fontById(settings, id)
  return font ? `'${font.internalFamily}', ${fallback}` : fallback
}

export function accentForeground(hex: string) {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)]
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  return luminance > 0.46 ? '#25231f' : '#ffffff'
}
