import { useEffect, useState } from 'react'
import { CompareWorkspace } from './CompareWorkspace'
import { useComparePreferences } from './comparePreferences'
import { normalizeAppearance, readCachedAppearance } from '../settings/appearance'
import { loadSetting } from '../settings/settingsRepository'
import { useAppearanceRuntime } from '../settings/useAppearanceRuntime'
import { isTauriRuntime } from '../../lib/platform'

export function CompareWindow() {
  const [appearance, setAppearance] = useState(readCachedAppearance)
  const [, setStatus] = useState('同一比较会话')
  const { resolvedTheme } = useAppearanceRuntime(appearance)
  const { preferences } = useComparePreferences(setStatus)

  useEffect(() => {
    if (!isTauriRuntime()) return
    let dispose: (() => void) | undefined
    let cancelled = false
    void loadSetting<unknown>('appearance').then((saved) => {
      if (saved && !cancelled) setAppearance(normalizeAppearance(saved))
    }).catch(() => setStatus('外观设置读取失败，已使用安全默认值'))
    void import('@tauri-apps/api/event').then(({ listen }) => listen<unknown>('appearance-changed', ({ payload }) => {
      setAppearance(normalizeAppearance(payload))
    })).then((unlisten) => { if (cancelled) unlisten(); else dispose = unlisten })
    return () => { cancelled = true; dispose?.() }
  }, [])

  return <main className="compare-window-root"><CompareWorkspace standalone onStatusChange={setStatus} resolvedTheme={resolvedTheme} editorFontFamily="var(--font-editor)" fontMeasureKey={`${appearance.fonts.editorFontId ?? 'system'}:${appearance.importedFonts.map((font) => font.id).join(',')}`} editorFontSize={appearance.compareEditorFontSize} preferences={preferences} /></main>
}
