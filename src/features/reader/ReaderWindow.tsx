import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeAppearance, readCachedAppearance } from '../settings/appearance'
import { loadSetting } from '../settings/settingsRepository'
import { useAppearanceRuntime } from '../settings/useAppearanceRuntime'
import { applyMainWindowCloseBehavior, normalizeWindowBehavior, readCachedWindowBehavior } from '../settings/windowBehavior'
import { loadReaderPreferences, normalizeReaderPreferences, persistReaderPreferences, readCachedReaderPreferences } from './readerPreferences'
import { ReaderWorkspace } from './ReaderWorkspace'
import type { ReaderPreferences } from './types'

interface ReaderWindowProps { bookId: string }

export function ReaderWindow({ bookId }: ReaderWindowProps) {
  const [appearance, setAppearance] = useState(readCachedAppearance)
  const [preferences, setPreferences] = useState(readCachedReaderPreferences)
  const [windowBehavior, setWindowBehavior] = useState(readCachedWindowBehavior)
  const [status, setStatus] = useState('正在载入阅读位置…')
  const [panelOpen, setPanelOpen] = useState(false)
  const [temporarilyHidden, setTemporarilyHidden] = useState(false)
  const flushRef = useRef<() => Promise<void>>(async () => undefined)
  const closeDisposeRef = useRef<(() => void) | null>(null)
  const closingRef = useRef(false)
  useAppearanceRuntime(appearance)

  useEffect(() => {
    document.documentElement.classList.add('reader-window-root')
    return () => document.documentElement.classList.remove('reader-window-root')
  }, [])

  useEffect(() => {
    let cancelled = false
    const disposers: Array<() => void> = []
    void Promise.all([
      loadSetting<unknown>('appearance'),
      loadReaderPreferences(),
      loadSetting<unknown>('window-behavior'),
      import('@tauri-apps/api/event'),
    ]).then(async ([savedAppearance, savedPreferences, savedBehavior, { listen }]) => {
      if (cancelled) return
      if (savedAppearance) setAppearance(normalizeAppearance(savedAppearance))
      setPreferences(normalizeReaderPreferences(savedPreferences))
      if (savedBehavior) setWindowBehavior(normalizeWindowBehavior(savedBehavior))
      disposers.push(await listen<unknown>('appearance-changed', ({ payload }) => setAppearance(normalizeAppearance(payload))))
      disposers.push(await listen<unknown>('reader-preferences-changed', ({ payload }) => setPreferences(normalizeReaderPreferences(payload))))
      disposers.push(await listen<unknown>('window-behavior-changed', ({ payload }) => setWindowBehavior(normalizeWindowBehavior(payload))))
    }).catch(() => setStatus('独立窗口设置读取失败，已使用本地缓存'))
    return () => { cancelled = true; disposers.forEach((dispose) => dispose()) }
  }, [])

  const closeWindow = useCallback(async () => {
    if (closingRef.current) return
    closingRef.current = true
    setStatus('正在保存阅读位置…')
    try {
      await flushRef.current()
      await applyMainWindowCloseBehavior(windowBehavior.reader.close)
      closeDisposeRef.current?.()
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().close()
    } catch {
      closingRef.current = false
      setStatus('关闭已取消：阅读位置保存失败')
    }
  }, [windowBehavior.reader.close])

  const setHidden = useCallback(async (hidden: boolean) => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().setIgnoreCursorEvents(hidden)
    setPanelOpen(false)
    setTemporarilyHidden(hidden)
  }, [])

  useEffect(() => {
    let cancelled = false
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const dispose = await getCurrentWindow().onCloseRequested((event) => {
        event.preventDefault()
        void closeWindow()
      })
      if (cancelled) dispose()
      else closeDisposeRef.current = dispose
    })
    return () => { cancelled = true; closeDisposeRef.current?.() }
  }, [closeWindow])

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    let cancelled = false
    const disposers: Array<() => void> = []
    void Promise.all([import('@tauri-apps/api/event'), import('@tauri-apps/api/window')]).then(async ([{ listen }, { getCurrentWindow }]) => {
      disposers.push(await listen('reader-restore-requested', () => void setHidden(false)))
      disposers.push(await getCurrentWindow().onFocusChanged(({ payload }) => {
        if (payload) void import('@tauri-apps/api/core').then(({ invoke }) => invoke('mark_reader_window_active')).catch(() => undefined)
      }))
      if (cancelled) disposers.forEach((dispose) => dispose())
    })
    return () => { cancelled = true; disposers.forEach((dispose) => dispose()) }
  }, [setHidden])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.isComposing || event.repeat) return
      if (event.key === 'Escape') {
        event.preventDefault()
        if (panelOpen) setPanelOpen(false)
        else void closeWindow()
      } else if (!target?.closest('input, textarea, select, button, [contenteditable="true"]') && event.key.toLowerCase() === 'b' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault()
        void setHidden(!temporarilyHidden)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeWindow, panelOpen, setHidden, temporarilyHidden])

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().setAlwaysOnTop(preferences.standaloneAlwaysOnTop)).catch(() => setStatus('置顶状态更新失败'))
  }, [preferences.standaloneAlwaysOnTop])

  async function updatePreferences(next: ReaderPreferences) {
    setPreferences(next)
    try {
      await persistReaderPreferences(next)
      const { emit } = await import('@tauri-apps/api/event')
      await emit('reader-preferences-changed', next)
    } catch { setStatus('阅读设置保存失败，请稍后重试') }
  }

  async function minimize() { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().minimize() }
  async function toggleMaximize() { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().toggleMaximize() }

  const showStatus = /失败|取消|错误/.test(status)

  return <main className={`reader-window minimal ${temporarilyHidden ? 'temporarily-hidden' : ''}`} style={{ ['--reader-background-opacity' as string]: `${preferences.backgroundOpacity * 100}%` }}>
    <ReaderWorkspace standalone initialBookId={bookId} preferences={preferences} onPreferencesChange={(next) => void updatePreferences(next)} onStatusChange={setStatus} onFlushReady={(flush) => { flushRef.current = flush }} panelOpen={panelOpen} onPanelOpenChange={setPanelOpen} onRequestClose={() => void closeWindow()} onMinimize={() => void minimize()} onToggleMaximize={() => void toggleMaximize()} />
    {showStatus ? <output className="reader-window-alert" role="alert">{status}<button onClick={() => setStatus('')}>知道了</button></output> : null}
  </main>
}
