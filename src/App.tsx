import {
  Archive,
  CheckCircle2,
  FileText,
  LockKeyhole,
  Moon,
  Plus,
  Settings,
  StickyNote,
  Sun,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { NotesWorkspace } from './features/notes/NotesWorkspace'
import { NoteWindow } from './features/notes/NoteWindow'
import { executeNewNoteEntry } from './features/notes/noteEntryFlow'
import { createNote } from './features/notes/noteRepository'
import { hideMainWindow, openNoteWindow } from './features/notes/openNoteWindow'
import { AppearanceSettingsPanel } from './features/settings/AppearanceSettingsPanel'
import { useComparePreferences } from './features/compare/comparePreferences'
import { CompareWindow } from './features/compare/CompareWindow'
import { BrandMark } from './components/BrandMark'
import {
  cacheAppearance,
  normalizeAppearance,
  readCachedAppearance,
  type ThemeMode,
} from './features/settings/appearance'
import { loadSetting, saveSetting } from './features/settings/settingsRepository'
import { useAppearanceRuntime } from './features/settings/useAppearanceRuntime'

const CompareWorkspace = lazy(() =>
  import('./features/compare/CompareWorkspace').then((module) => ({
    default: module.CompareWorkspace,
  })),
)

type View = 'compare' | 'notes' | 'trash' | 'settings'

const NAV_ITEMS: Array<{ id: View; label: string; description: string; icon: typeof FileText }> = [
  { id: 'compare', label: '文字对比', description: '审阅原文与修改稿', icon: FileText },
  { id: 'notes', label: '便签', description: '记录与整理', icon: StickyNote },
  { id: 'trash', label: '回收站', description: '恢复已删除内容', icon: Archive },
  { id: 'settings', label: '设置', description: '外观、字体与数据', icon: Settings },
]

const PAGE_COPY: Record<View, { title: string; description: string }> = {
  compare: { title: '文字对比', description: '对照原文与修改稿，快速发现差异并完成审阅。' },
  notes: { title: '桌面便签', description: '记录灵感、会议要点和需要持续关注的文字。' },
  trash: { title: '回收站', description: '检查并恢复暂时移除的便签。' },
  settings: { title: '设置', description: '调整主题、背景、字体与本地数据选项。' },
}

function ThemeShortcut({
  value,
  active,
  label,
  onClick,
}: {
  value: Exclude<ThemeMode, 'system'>
  active: boolean
  label: string
  onClick(value: Exclude<ThemeMode, 'system'>): void
}) {
  const Icon = value === 'light' ? Sun : Moon
  return <button className={active ? 'active' : ''} title={`切换为${label}主题`} onClick={() => onClick(value)}><Icon size={15} /><span>{label}</span></button>
}

function MainApp() {
  const [view, setView] = useState<View>('compare')
  const [status, setStatus] = useState('内容仅保存在此设备')
  const [appearance, setAppearance] = useState(readCachedAppearance)
  const appearanceHydrated = useRef(false)
  const { resolvedTheme, issues: runtimeIssues } = useAppearanceRuntime(appearance)
  const { preferences, setPreferences } = useComparePreferences(setStatus)

  useEffect(() => {
    loadSetting<unknown>('appearance')
      .then((saved) => {
        appearanceHydrated.current = true
        if (saved) setAppearance(normalizeAppearance(saved))
      })
      .catch(() => {
        appearanceHydrated.current = true
        setStatus('设置数据库读取失败，已使用安全的本地缓存')
      })
  }, [])

  useEffect(() => {
    cacheAppearance(appearance)
    if ('__TAURI_INTERNALS__' in window) {
      void import('@tauri-apps/api/event')
        .then(({ emit }) => emit('appearance-changed', appearance))
        .catch(() => undefined)
    }
    if (appearanceHydrated.current) {
      void saveSetting('appearance', appearance).catch(() => setStatus('界面设置保存失败，请稍后重试'))
    }
  }, [appearance])

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('sync_main_window_chrome', { theme: resolvedTheme }))
      .catch(() => setStatus('Windows 原生标题栏配色未能同步，已使用系统默认标题栏'))
  }, [resolvedTheme])

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    const disposers: Array<() => void> = []
    let cancelled = false
    const handledRequests = new Set<number>()
    const handleTrayRequest = async (requestId: number) => {
      if (cancelled || handledRequests.has(requestId)) return
      handledRequests.add(requestId)
      try {
        await executeNewNoteEntry('tray', {
          create: createNote,
          open: (note) => openNoteWindow(note.id, note.title),
          hideMain: hideMainWindow,
        })
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('acknowledge_tray_note_request', { requestId })
      } catch {
        handledRequests.delete(requestId)
        setStatus('托盘新建便签失败；请求已保留，将在主窗口就绪后重试')
      }
    }
    void Promise.all([
      import('@tauri-apps/api/event'),
      import('@tauri-apps/api/core'),
    ]).then(async ([{ listen }, { invoke }]) => {
      const trayDispose = await listen<number>('tray-new-note', ({ payload }) => {
        void handleTrayRequest(payload)
      })
      if (cancelled) {
        trayDispose()
        return
      }
      disposers.push(trayDispose)
      const pending = await invoke<number[]>('take_pending_tray_note_requests')
      for (const requestId of pending) {
        await handleTrayRequest(requestId)
      }
      const errorDispose = await listen<string>('note-window-error', (event) => {
        setStatus(`独立便签窗口打开失败：${event.payload}`)
      })
      if (cancelled) errorDispose()
      else disposers.push(errorDispose)
    }).catch(() => {
      if (!cancelled) setStatus('托盘入口初始化失败，请从主窗口新建便签')
    })
    return () => {
      cancelled = true
      disposers.forEach((dispose) => dispose())
    }
  }, [])

  const page = useMemo(() => PAGE_COPY[view], [view])

  async function quickNote() {
    try {
      await executeNewNoteEntry('sidebar', {
        create: createNote,
        open: (note) => openNoteWindow(note.id, note.title),
        hideMain: hideMainWindow,
      })
    } catch {
      setStatus('新建或打开浮动便签失败；主窗口保持显示，内容未丢失')
    }
  }

  function setThemeMode(themeMode: ThemeMode) {
    setAppearance((current) => ({ ...current, themeMode }))
  }

  async function openCompareWindow() {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const result = await invoke<{ created: boolean }>('open_compare_window')
      setStatus(result.created ? '已打开独立文字比较窗口' : '已聚焦独立文字比较窗口')
    } catch {
      setStatus('独立文字比较窗口打开失败；主窗口保持可用')
    }
  }

  return (
    <div className="app-shell">
      <div className="app-background" aria-hidden="true" />
      <div className="app-background-tint" aria-hidden="true" />
      <aside className="app-sidebar">
        <div className="brand"><BrandMark /><span><strong>字隙</strong><small>文字之间，留有余地</small></span></div>
        <nav aria-label="主导航">
          {NAV_ITEMS.map(({ id, label, description, icon: Icon }) => (
            <button key={id} aria-label={label} aria-current={view === id ? 'page' : undefined} className={view === id ? 'active' : ''} onClick={() => setView(id)}>
              <Icon size={18} strokeWidth={1.75} /><span><strong>{label}</strong><small>{description}</small></span>
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <button className="quick-note" onClick={quickNote} aria-label="新建浮动便签"><Plus size={17} /><span>新建浮动便签</span></button>
        <div className="local-chip"><LockKeyhole size={15} /><div><strong>本地优先</strong><small>内容不离开设备</small></div></div>
        <div className="sidebar-theme" aria-label="快速主题切换">
          <ThemeShortcut value="light" label="浅色" active={appearance.themeMode === 'light'} onClick={setThemeMode} />
          <ThemeShortcut value="dark" label="深色" active={appearance.themeMode === 'dark'} onClick={setThemeMode} />
          <button className={appearance.themeMode === 'system' ? 'active' : ''} title="跟随系统主题" onClick={() => setThemeMode('system')}><span>自动</span></button>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <div><h1>{page.title}</h1><p>{page.description}</p></div>
          <div className="topbar-status" title={status}><CheckCircle2 size={15} /><span>{status}</span></div>
        </header>
        <div className="view-host">
          {view === 'compare' && <Suspense fallback={<div className="view-loading">正在载入文字比较器…</div>}><CompareWorkspace onStatusChange={setStatus} resolvedTheme={resolvedTheme} editorFontFamily="var(--font-editor)" fontMeasureKey={`${appearance.fonts.editorFontId ?? 'system'}:${appearance.importedFonts.map((font) => font.id).join(',')}`} editorFontSize={appearance.compareEditorFontSize} preferences={preferences} onOpenStandalone={openCompareWindow} /></Suspense>}
          {view === 'notes' && <NotesWorkspace appearance={appearance} onStatusChange={setStatus} />}
          {view === 'trash' && <NotesWorkspace appearance={appearance} trashMode onStatusChange={setStatus} />}
          {view === 'settings' && <AppearanceSettingsPanel appearance={appearance} runtimeIssues={runtimeIssues} onChange={setAppearance} onStatusChange={setStatus} comparePreferences={preferences} onComparePreferencesChange={setPreferences} />}
        </div>
      </div>
    </div>
  )
}

function App() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('window') === 'note' && params.get('id')) {
    return <NoteWindow noteId={params.get('id')!} />
  }
  if (params.get('window') === 'compare') return <CompareWindow />
  return <MainApp />
}

export default App
