import { useEffect, useMemo, useState } from 'react'
import type { AppearanceSettings, ResolvedTheme } from './appearance'
import {
  BUNDLED_FONT_FAMILY,
  EDITOR_FALLBACK_STACK,
  NOTE_FALLBACK_STACK,
  UI_FALLBACK_STACK,
  accentForeground,
  fontStack,
} from './appearance'
import { managedAssetUrl } from './managedAssets'

interface AppearanceRuntime {
  resolvedTheme: ResolvedTheme
  issues: string[]
}

const registeredFontFaces = new Map<string, FontFace>()
let bundledFontFace: FontFace | null = null
let bundledFontPromise: Promise<void> | null = null

async function loadBundledFont() {
  if (bundledFontFace) return
  if (bundledFontPromise) return bundledFontPromise
  bundledFontPromise = (async () => {
    let url = '/src-tauri/resources/fonts/NotoSerifSC-VariableFont_wght.ttf'
    if ('__TAURI_INTERNALS__' in window) {
      const [{ resolveResource }, { convertFileSrc }] = await Promise.all([
        import('@tauri-apps/api/path'),
        import('@tauri-apps/api/core'),
      ])
      url = convertFileSrc(await resolveResource('fonts/NotoSerifSC-VariableFont_wght.ttf'))
    }
    const face = new FontFace(
      BUNDLED_FONT_FAMILY,
      `url(${JSON.stringify(url)}) format('truetype')`,
      { style: 'normal', weight: '200 900', display: 'swap' },
    )
    await face.load()
    document.fonts.add(face)
    bundledFontFace = face
  })().catch((error) => {
    bundledFontPromise = null
    throw error
  })
  return bundledFontPromise
}

function useMediaPreference(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false)
  useEffect(() => {
    const media = window.matchMedia?.(query)
    if (!media) return
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])
  return matches
}

function fontFormatLabel(format: string) {
  if (format === 'ttf') return 'truetype'
  if (format === 'otf') return 'opentype'
  return format
}

export function useAppearanceRuntime(settings: AppearanceSettings): AppearanceRuntime {
  const systemDark = useMediaPreference('(prefers-color-scheme: dark)')
  const systemContrast = useMediaPreference('(prefers-contrast: more)')
  const systemReducedMotion = useMediaPreference('(prefers-reduced-motion: reduce)')
  const [fontIssues, setFontIssues] = useState<string[]>([])
  const [bundledFontIssue, setBundledFontIssue] = useState('')
  const [backgroundIssue, setBackgroundIssue] = useState('')
  const resolvedTheme: ResolvedTheme = settings.themeMode === 'system'
    ? systemDark ? 'dark' : 'light'
    : settings.themeMode
  const backgroundUrl = settings.background.asset
    ? managedAssetUrl(settings.background.asset.storedPath)
    : ''

  useEffect(() => {
    let cancelled = false
    void loadBundledFont()
      .then(() => { if (!cancelled) setBundledFontIssue('') })
      .catch(() => {
        if (!cancelled) setBundledFontIssue('内置思源宋体加载失败，已安全使用系统后备字体。')
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const reduceTransparency = settings.accessibility.reduceTransparency
    root.dataset.theme = resolvedTheme
    root.dataset.themeMode = settings.themeMode
    root.dataset.contrast = settings.accessibility.increasedContrast || systemContrast ? 'more' : 'normal'
    root.dataset.reduceMotion = settings.accessibility.reduceMotion || systemReducedMotion ? 'true' : 'false'
    root.dataset.reduceTransparency = reduceTransparency ? 'true' : 'false'
    root.dataset.hasBackground = backgroundUrl ? 'true' : 'false'
    root.style.setProperty('--ui-font-size', `${settings.uiFontSize}px`)
    root.style.setProperty('--accent', settings.accent)
    root.style.setProperty('--accent-foreground', accentForeground(settings.accent))
    root.style.setProperty('--font-ui', fontStack(settings, settings.fonts.uiFontId, UI_FALLBACK_STACK))
    root.style.setProperty('--font-editor', fontStack(settings, settings.fonts.editorFontId, EDITOR_FALLBACK_STACK))
    root.style.setProperty('--font-note', fontStack(settings, settings.fonts.noteDefaultFontId, NOTE_FALLBACK_STACK))
    root.style.setProperty('--app-background-image', backgroundUrl ? `url(${JSON.stringify(backgroundUrl)})` : 'none')
    root.style.setProperty('--background-fit', settings.background.fit === 'native' ? 'auto' : settings.background.fit)
    root.style.setProperty('--background-position', settings.background.position)
    root.style.setProperty('--background-dim', String(settings.background.dim))
    root.style.setProperty('--background-blur', reduceTransparency ? '0px' : `${settings.background.blur}px`)
    root.style.setProperty('--surface-opacity', reduceTransparency ? '100%' : `${Math.round(settings.background.surfaceOpacity * 100)}%`)
  }, [backgroundUrl, resolvedTheme, settings, systemContrast, systemReducedMotion])

  useEffect(() => {
    if (!backgroundUrl) {
      setBackgroundIssue('')
      return
    }
    const image = new Image()
    image.onload = () => setBackgroundIssue('')
    image.onerror = () => {
      document.documentElement.style.setProperty('--app-background-image', 'none')
      document.documentElement.dataset.hasBackground = 'false'
      setBackgroundIssue('背景资源无法加载，已安全回退到主题默认背景。')
    }
    image.src = backgroundUrl
    return () => {
      image.onload = null
      image.onerror = null
    }
  }, [backgroundUrl])

  useEffect(() => {
    let cancelled = false
    const currentIds = new Set(settings.importedFonts.map((font) => font.id))
    for (const [id, face] of registeredFontFaces) {
      if (!currentIds.has(id)) {
        document.fonts.delete(face)
        registeredFontFaces.delete(id)
      }
    }
    void Promise.all(settings.importedFonts.map(async (font) => {
      if (registeredFontFaces.has(font.id)) return null
      const url = managedAssetUrl(font.storedPath)
      if (!url) return font.displayName
      try {
        const face = new FontFace(
          font.internalFamily,
          `url(${JSON.stringify(url)}) format('${fontFormatLabel(font.format)}')`,
          { style: font.style ?? 'normal', weight: font.weight ?? 'normal', display: 'swap' },
        )
        await face.load()
        if (cancelled) return null
        document.fonts.add(face)
        registeredFontFaces.set(font.id, face)
        return null
      } catch {
        return font.displayName
      }
    })).then((failed) => {
      if (cancelled) return
      setFontIssues(failed.filter((name): name is string => Boolean(name)).map(
        (name) => `字体“${name}”加载失败，相关区域已使用系统后备字体。`,
      ))
    })
    return () => { cancelled = true }
  }, [settings.importedFonts])

  return useMemo(() => ({
    resolvedTheme,
    issues: [bundledFontIssue, backgroundIssue, ...fontIssues].filter(Boolean),
  }), [backgroundIssue, bundledFontIssue, fontIssues, resolvedTheme])
}
