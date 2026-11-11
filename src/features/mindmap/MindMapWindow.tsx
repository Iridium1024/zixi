import { Maximize2, Minus, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { WindowResizeEdges } from '../../components/WindowResizeEdges'
import { isTauriRuntime } from '../../lib/platform'
import { normalizeAppearance, readCachedAppearance } from '../settings/appearance'
import { loadSetting } from '../settings/settingsRepository'
import { useAppearanceRuntime } from '../settings/useAppearanceRuntime'
import { MindMapWorkspace } from './MindMapWorkspace'

export function MindMapWindow({ mapId }: { mapId: string }) {
  const [appearance, setAppearance] = useState(readCachedAppearance)
  const [status, setStatus] = useState('')
  const { resolvedTheme } = useAppearanceRuntime(appearance)
  const beforeClose = useRef<(() => Promise<boolean>) | null>(null)
  const disposeClose = useRef<(() => void) | null>(null)
  const closing = useRef(false)
  const allowClose = useRef(false)
  const registerBeforeClose = useCallback((handler: (() => Promise<boolean>) | null) => { beforeClose.current = handler }, [])

  useEffect(() => {
    if (!isTauriRuntime()) return
    let cancelled = false
    let dispose: (() => void) | undefined
    void loadSetting<unknown>('appearance').then((saved) => {
      if (saved && !cancelled) setAppearance(normalizeAppearance(saved))
    }).catch(() => { if (!cancelled) setStatus('外观设置读取失败') })
    void import('@tauri-apps/api/event').then(async ({ listen }) => listen<unknown>('appearance-changed', ({ payload }) => {
      setAppearance(normalizeAppearance(payload))
    })).then((unlisten) => { if (cancelled) unlisten(); else dispose = unlisten }).catch(() => {
      if (!cancelled) setStatus('跨窗口外观同步不可用')
    })
    return () => { cancelled = true; dispose?.() }
  }, [])

  const close = useCallback(async () => {
    if (closing.current) return
    closing.current = true
    try {
      if (!beforeClose.current || !await beforeClose.current()) {
        setStatus('关闭已取消：请先保存或处理导图冲突')
        closing.current = false
        return
      }
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      allowClose.current = true
      await getCurrentWindow().close()
    } catch {
      allowClose.current = false
      closing.current = false
      setStatus('关闭失败，导图窗口仍保留')
    }
  }, [])

  useEffect(() => {
    if (!isTauriRuntime()) return
    let cancelled = false
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const dispose = await getCurrentWindow().onCloseRequested((event) => {
        if (allowClose.current) return
        event.preventDefault()
        void close()
      })
      if (cancelled) dispose()
      else disposeClose.current = dispose
    }).catch(() => { if (!cancelled) setStatus('窗口关闭保护初始化失败') })
    return () => { cancelled = true; disposeClose.current?.(); disposeClose.current = null }
  }, [close])

  async function windowAction(action: 'minimize' | 'toggleMaximize') {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow()[action]()
    } catch { setStatus('窗口操作失败') }
  }

  return <main className="mind-map-window">
    <header className="mind-map-window-titlebar">
      <div data-tauri-drag-region className="mind-map-window-drag">思维导图</div>
      <span role="status" title={status}>{status}</span>
      <div className="titlebar-window-actions">
        <button aria-label="最小化窗口" title="最小化" onClick={() => void windowAction('minimize')}><Minus size={16} /></button>
        <button aria-label="最大化或还原窗口" title="最大化或还原" onClick={() => void windowAction('toggleMaximize')}><Maximize2 size={15} /></button>
        <button className="window-close-button" aria-label="关闭导图窗口" title="关闭导图窗口" onClick={() => void close()}><X size={16} /></button>
      </div>
    </header>
    <MindMapWorkspace standaloneId={mapId} theme={resolvedTheme} onStatusChange={setStatus} onBeforeLeaveReady={registerBeforeClose} />
    <WindowResizeEdges onError={() => setStatus('窗口缩放失败')} />
  </main>
}
