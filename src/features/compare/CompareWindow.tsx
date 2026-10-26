import { useEffect, useState } from 'react'
import { CompareWorkspace } from './CompareWorkspace'
import { useComparePreferences } from './comparePreferences'
import { normalizeAppearance, readCachedAppearance } from '../settings/appearance'
import { loadSetting } from '../settings/settingsRepository'
import { useAppearanceRuntime } from '../settings/useAppearanceRuntime'
import { isTauriRuntime } from '../../lib/platform'
import {
  normalizeWindowBehavior,
  readCachedWindowBehavior,
  type WindowBehaviorPreferences,
} from '../settings/windowBehavior'

export function CompareWindow() {
  const [appearance, setAppearance] = useState(readCachedAppearance)
  const [, setStatus] = useState('同一比较会话')
  const { resolvedTheme } = useAppearanceRuntime(appearance)
  const { preferences } = useComparePreferences(setStatus)
  const [windowBehavior, setWindowBehavior] = useState(readCachedWindowBehavior)

  useEffect(() => {
    if (!isTauriRuntime()) return
    let dispose: (() => void) | undefined
    let cancelled = false
    void loadSetting<unknown>('appearance').then((saved) => {
      if (saved && !cancelled) setAppearance(normalizeAppearance(saved))
    }).catch(() => setStatus('外观设置读取失败，已使用安全默认值'))
    void loadSetting<unknown>('window-behavior').then((saved) => {
      if (saved && !cancelled) setWindowBehavior(normalizeWindowBehavior(saved))
    }).catch(() => setStatus('窗口行为设置读取失败，已使用兼容默认值'))
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const disposeAppearance = await listen<unknown>('appearance-changed', ({ payload }) => {
        setAppearance(normalizeAppearance(payload))
      })
      const disposeWindowBehavior = await listen<WindowBehaviorPreferences>('window-behavior-changed', ({ payload }) => {
        setWindowBehavior(normalizeWindowBehavior(payload))
      })
      return () => { disposeAppearance(); disposeWindowBehavior() }
    }).then((unlisten) => { if (cancelled) unlisten(); else dispose = unlisten })
    return () => { cancelled = true; dispose?.() }
  }, [])

  return <main className="compare-window-root"><CompareWorkspace standalone onStatusChange={setStatus} resolvedTheme={resolvedTheme} editorFontFamily="var(--font-editor)" fontMeasureKey={`${appearance.fonts.editorFontId ?? 'system'}:${appearance.importedFonts.map((font) => font.id).join(',')}`} editorFontSize={appearance.compareEditorFontSize} preferences={preferences} mainWindowCloseBehavior={windowBehavior.compare.close} /></main>
}
