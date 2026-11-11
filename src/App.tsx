import {
  Archive,
  BookOpen,
  FileText,
  GitBranchPlus,
  Maximize2,
  Minus,
  PanelLeft,
  Settings,
  StickyNote,
  X,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import './navigation.css'
import './surfaces.css'
import { NavigationTarget } from './components/WorkspaceNavigation'
import { TooltipLayer } from './components/TooltipLayer'
import { ThemeSwitcher } from './components/ThemeSwitcher'
import { NotesWorkspace } from './features/notes/NotesWorkspace'
import { NoteWindow } from './features/notes/NoteWindow'
import { executeNewNoteEntry } from './features/notes/noteEntryFlow'
import { createNote } from './features/notes/noteRepository'
import { openNoteWindow } from './features/notes/openNoteWindow'
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
import {
  cacheNotePreferences,
  normalizeNotePreferences,
  readCachedNotePreferences,
} from './features/notes/notePreferences'
import {
  applyMainWindowOpenBehavior,
  cacheWindowBehavior,
  normalizeWindowBehavior,
  readCachedWindowBehavior,
} from './features/settings/windowBehavior'
import {
  loadReaderPreferences,
  normalizeReaderPreferences,
  persistReaderPreferences,
  readCachedReaderPreferences,
} from './features/reader/readerPreferences'
import type { ReaderBook } from './features/reader/types'
import { WindowResizeEdges } from './components/WindowResizeEdges'

const CompareWorkspace = lazy(() =>
  import('./features/compare/CompareWorkspace').then((module) => ({
    default: module.CompareWorkspace,
  })),
)

const ReaderWorkspace = lazy(() =>
  import('./features/reader/ReaderWorkspace').then((module) => ({
    default: module.ReaderWorkspace,
  })),
)

const ReaderWindow = lazy(() =>
  import('./features/reader/ReaderWindow').then((module) => ({
    default: module.ReaderWindow,
  })),
)

const MindMapWorkspace = lazy(() =>
  import('./features/mindmap/MindMapWorkspace').then((module) => ({
    default: module.MindMapWorkspace,
  })),
)

const MindMapWindow = lazy(() =>
  import('./features/mindmap/MindMapWindow').then((module) => ({ default: module.MindMapWindow })),
)

type View = 'compare' | 'reader' | 'notes' | 'mindmap' | 'trash' | 'settings'

type PanelVisibility = { navigation: boolean; noteSettings: boolean }
const PANEL_VISIBILITY_KEY = 'zixi.main.panels.v1'
function readPanelVisibility(): PanelVisibility {
  const defaults = { navigation: true, noteSettings: false }
  try {
    const saved: Partial<PanelVisibility> = JSON.parse(localStorage.getItem(PANEL_VISIBILITY_KEY) ?? '{}')
    return {
      navigation: typeof saved.navigation === 'boolean' ? saved.navigation : defaults.navigation,
      noteSettings: typeof saved.noteSettings === 'boolean' ? saved.noteSettings : defaults.noteSettings,
    }
  } catch { return defaults }
}

const NAV_ITEMS: Array<{ id: View; label: string; icon: typeof FileText }> = [
  { id: 'compare', label: '文字对比', icon: FileText },
  { id: 'reader', label: '书架', icon: BookOpen },
  { id: 'notes', label: '便签', icon: StickyNote },
  { id: 'mindmap', label: '思维导图', icon: GitBranchPlus },
  { id: 'trash', label: '回收站', icon: Archive },
  { id: 'settings', label: '设置', icon: Settings },
]

const PAGE_COPY: Record<View, { title: string; description: string }> = {
  compare: { title: '文字对比', description: '对照原文与修改稿，快速发现差异并完成审阅。' },
  reader: { title: '本地书架', description: '管理 TXT 书籍，并在独立窗口中继续阅读。' },
  notes: { title: '桌面便签', description: '记录灵感、会议要点和需要持续关注的文字。' },
  mindmap: { title: '思维导图', description: '用横向树状结构整理想法。' },
  trash: { title: '回收站', description: '检查并恢复暂时移除的便签。' },
  settings: { title: '设置', description: '调整主题、背景、字体与本地数据选项。' },
}

function MainApp() {
  const [navigationTarget, setNavigationTarget] = useState<HTMLElement | null>(null)
  const [view, setView] = useState<View>('compare')
  const [status, setStatus] = useState('就绪')
  const [panels, setPanels] = useState(readPanelVisibility)
  const [navigating, setNavigating] = useState(false)
  const navigatingRef = useRef(false)
  const beforeNotesLeave = useRef<(() => Promise<boolean>) | null>(null)
  const beforeCompareLeave = useRef<(() => Promise<boolean>) | null>(null)
  const beforeMindMapLeave = useRef<(() => Promise<boolean>) | null>(null)
  const [appearance, setAppearance] = useState(readCachedAppearance)
  const [notePreferences, setNotePreferences] = useState(readCachedNotePreferences)
  const [windowBehavior, setWindowBehavior] = useState(readCachedWindowBehavior)
  const [readerPreferences, setReaderPreferences] = useState(readCachedReaderPreferences)
  const [readerPreferencesReady, setReaderPreferencesReady] = useState(false)
  const appearanceHydrated = useRef(false)
  const notePreferencesHydrated = useRef(false)
  const windowBehaviorHydrated = useRef(false)
  const readerPreferencesHydrated = useRef(false)
  const { resolvedTheme, issues: runtimeIssues } = useAppearanceRuntime(appearance)
  const { preferences, setPreferences } = useComparePreferences(setStatus)

  useEffect(() => {
    try { localStorage.setItem(PANEL_VISIBILITY_KEY, JSON.stringify(panels)) } catch { /* UI still works for this session. */ }
  }, [panels])

  const registerBeforeNotesLeave = useCallback((handler: (() => Promise<boolean>) | null) => {
    beforeNotesLeave.current = handler
  }, [])

  const registerBeforeCompareLeave = useCallback((handler: (() => Promise<boolean>) | null) => {
    beforeCompareLeave.current = handler
  }, [])

  const registerBeforeMindMapLeave = useCallback((handler: (() => Promise<boolean>) | null) => {
    beforeMindMapLeave.current = handler
  }, [])

  async function navigateTo(next: View) {
    if (next === view || navigatingRef.current) return
    navigatingRef.current = true
    setNavigating(true)
    try {
      if (view === 'compare' && (!beforeCompareLeave.current || !await beforeCompareLeave.current())) {
        setStatus('比较稿件尚未安全保存，请处理后再切换页面')
        return
      }
      if (view === 'notes') {
        if (!beforeNotesLeave.current || !await beforeNotesLeave.current()) {
          setStatus('便签尚未安全保存，请处理后再切换页面')
          return
        }
      }
      if (view === 'mindmap' && (!beforeMindMapLeave.current || !await beforeMindMapLeave.current())) {
        setStatus('导图尚未安全保存，请处理后再切换页面')
        return
      }
      setView(next)
      setStatus('就绪')
    } finally {
      navigatingRef.current = false
      setNavigating(false)
    }
  }

  function togglePanel(panel: keyof PanelVisibility) {
    setPanels((current) => ({ ...current, [panel]: !current[panel] }))
  }

  async function windowAction(action: 'minimize' | 'toggleMaximize' | 'close') {
    if (!('__TAURI_INTERNALS__' in window)) return
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow()[action]()
    } catch { setStatus('窗口操作失败，请重试') }
  }

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
    loadSetting<unknown>('note-preferences')
      .then((saved) => {
        notePreferencesHydrated.current = true
        if (saved) setNotePreferences(normalizeNotePreferences(saved))
      })
      .catch(() => {
        notePreferencesHydrated.current = true
        setStatus('便签设置读取失败，已使用安全默认值')
      })
  }, [])

  useEffect(() => {
    cacheNotePreferences(notePreferences)
    if ('__TAURI_INTERNALS__' in window) {
      void import('@tauri-apps/api/event')
        .then(({ emit }) => emit('note-preferences-changed', notePreferences))
        .catch(() => undefined)
    }
    if (notePreferencesHydrated.current) {
      void saveSetting('note-preferences', notePreferences).catch(() => setStatus('便签设置保存失败，请稍后重试'))
    }
  }, [notePreferences])

  useEffect(() => {
    loadSetting<unknown>('window-behavior')
      .then((saved) => {
        windowBehaviorHydrated.current = true
        if (saved) setWindowBehavior(normalizeWindowBehavior(saved))
      })
      .catch(() => {
        windowBehaviorHydrated.current = true
        setStatus('窗口行为设置读取失败，已使用兼容默认值')
      })
  }, [])

  useEffect(() => {
    cacheWindowBehavior(windowBehavior)
    if ('__TAURI_INTERNALS__' in window) {
      void import('@tauri-apps/api/event')
        .then(({ emit }) => emit('window-behavior-changed', windowBehavior))
        .catch(() => undefined)
    }
    if (windowBehaviorHydrated.current) {
      void saveSetting('window-behavior', windowBehavior).catch(() => setStatus('窗口行为设置保存失败，请稍后重试'))
    }
  }, [windowBehavior])

  useEffect(() => {
    loadReaderPreferences()
      .then((saved) => {
        readerPreferencesHydrated.current = true
        setReaderPreferences(normalizeReaderPreferences(saved))
        setReaderPreferencesReady(true)
      })
      .catch(() => {
        readerPreferencesHydrated.current = true
        setReaderPreferencesReady(true)
        setStatus('阅读设置读取失败，已使用安全默认值')
      })
  }, [])

  useEffect(() => {
    if ('__TAURI_INTERNALS__' in window) {
      void import('@tauri-apps/api/event')
        .then(({ emit }) => emit('reader-preferences-changed', readerPreferences))
        .catch(() => undefined)
    }
    if (readerPreferencesHydrated.current) {
      void persistReaderPreferences(readerPreferences).catch(() => setStatus('阅读设置保存失败，请稍后重试'))
    }
  }, [readerPreferences])

  useEffect(() => {
    if (!readerPreferencesReady || !('__TAURI_INTERNALS__' in window)) return
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('set_reader_restore_shortcut', { shortcut: readerPreferences.restoreShortcut }))
      .catch((error) => setStatus(`恢复阅读窗快捷键注册失败：${String(error)}。已保留上一个可用快捷键，也可使用托盘菜单恢复。`))
  }, [readerPreferences.restoreShortcut, readerPreferencesReady])

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
          open: (note) => openNoteWindow(note.id, note.title, true),
          afterOpen: () => applyMainWindowOpenBehavior(windowBehavior.note.open),
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
  }, [windowBehavior.note.open])

  const page = useMemo(() => PAGE_COPY[view], [view])

  function setThemeMode(themeMode: ThemeMode) {
    setAppearance((current) => ({ ...current, themeMode }))
  }

  async function openCompareWindow() {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const result = await invoke<{ created: boolean }>('open_compare_window')
      await applyMainWindowOpenBehavior(windowBehavior.compare.open)
      setStatus(result.created ? '已打开独立文字比较窗口' : '已聚焦独立文字比较窗口')
    } catch {
      setStatus('独立文字比较窗口打开失败；主窗口保持可用')
    }
  }

  async function openReaderWindow(book: ReaderBook) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const result = await invoke<{ created: boolean }>('open_reader_window', {
        bookId: book.id,
        title: book.title,
        alwaysOnTop: readerPreferences.standaloneAlwaysOnTop,
      })
      await applyMainWindowOpenBehavior(windowBehavior.reader.open)
      setStatus(result.created ? `已在独立窗口打开《${book.title}》` : `已聚焦《${book.title}》的独立窗口`)
    } catch {
      setStatus('独立阅读窗口打开失败；主窗口保持可用')
    }
  }

  return (
    <NavigationTarget value={navigationTarget}><div className={`app-shell ${panels.navigation ? '' : 'navigation-closed'}`}>
      <div className="app-background" aria-hidden="true" />
      <div className="app-background-tint" aria-hidden="true" />
      <header className="app-titlebar">
        <button className="titlebar-button" aria-label={panels.navigation ? '收起主导航' : '展开主导航'} title={panels.navigation ? '收起主导航' : '展开主导航'} aria-expanded={panels.navigation} aria-controls="main-navigation" onClick={() => togglePanel('navigation')}><PanelLeft size={17} /></button>

        <div className="titlebar-drag-region" data-tauri-drag-region title="拖动窗口；双击最大化或还原"><strong data-tauri-drag-region>{page.title}</strong></div>


        <div className="titlebar-window-actions"><button aria-label="最小化窗口" title="最小化" onClick={() => void windowAction('minimize')}><Minus size={16} /></button><button aria-label="最大化或还原窗口" title="最大化或还原" onClick={() => void windowAction('toggleMaximize')}><Maximize2 size={15} /></button><button className="window-close-button" aria-label="关闭主窗口" title="关闭主窗口" onClick={() => void windowAction('close')}><X size={16} /></button></div>
      </header>
      <aside id="main-navigation" className="app-sidebar" data-state={panels.navigation ? 'expanded' : 'collapsed'}>
        <div className="brand"><BrandMark /><span><strong>字隙</strong></span></div>
        <nav aria-label="主导航">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button key={id} title={label} aria-label={label} disabled={navigating} aria-current={view === id ? 'page' : undefined} className={view === id ? 'active' : ''} onClick={() => void navigateTo(id)}>
              <Icon size={18} strokeWidth={1.75} /><span><strong>{label}</strong></span>
            </button>
          ))}
        </nav>
        <div className="workspace-directory-reveal" inert={!panels.navigation} aria-hidden={!panels.navigation}><div className="workspace-directory" ref={setNavigationTarget} /></div>
        <ThemeSwitcher value={appearance.themeMode} collapsed={!panels.navigation} onChange={setThemeMode} />
      </aside>

      <div className="app-main">
        <div className="view-host">
          {view === 'compare' && <Suspense fallback={<div className="view-loading">正在载入文字比较器…</div>}><CompareWorkspace statusMessage={status} onStatusChange={setStatus} resolvedTheme={resolvedTheme} editorFontFamily="var(--font-editor)" fontMeasureKey={`${appearance.fonts.editorFontId ?? 'system'}:${appearance.importedFonts.map((font) => font.id).join(',')}`} editorFontSize={appearance.compareEditorFontSize} preferences={preferences} onBeforeLeaveReady={registerBeforeCompareLeave} onOpenStandalone={openCompareWindow} /></Suspense>}
          {view === 'reader' && <Suspense fallback={<div className="view-loading">正在载入阅读器…</div>}><ReaderWorkspace statusMessage={status} onStatusChange={setStatus} preferences={readerPreferences} onPreferencesChange={setReaderPreferences} onOpenStandalone={(book) => void openReaderWindow(book)} /></Suspense>}
          {view === 'notes' && <NotesWorkspace statusMessage={status} appearance={appearance} windowBehavior={windowBehavior} onStatusChange={setStatus} listOpen settingsOpen={panels.noteSettings} onSettingsOpenChange={(open) => setPanels((current) => ({ ...current, noteSettings: open }))} onBeforeLeaveReady={registerBeforeNotesLeave} />}
          {view === 'mindmap' && <Suspense fallback={<div className="view-loading">正在载入思维导图…</div>}><MindMapWorkspace statusMessage={status} theme={resolvedTheme} onStatusChange={setStatus} onBeforeLeaveReady={registerBeforeMindMapLeave} /></Suspense>}
          {view === 'trash' && <NotesWorkspace statusMessage={status} appearance={appearance} windowBehavior={windowBehavior} trashMode onStatusChange={setStatus} listOpen settingsOpen={panels.noteSettings} onSettingsOpenChange={(open) => setPanels((current) => ({ ...current, noteSettings: open }))} />}
          {view === 'settings' && <AppearanceSettingsPanel statusMessage={status} appearance={appearance} runtimeIssues={runtimeIssues} onChange={setAppearance} onStatusChange={setStatus} comparePreferences={preferences} onComparePreferencesChange={setPreferences} notePreferences={notePreferences} onNotePreferencesChange={setNotePreferences} windowBehavior={windowBehavior} onWindowBehaviorChange={setWindowBehavior} readerPreferences={readerPreferences} onReaderPreferencesChange={setReaderPreferences} />}
        </div>
      </div>
      <WindowResizeEdges />
    </div></NavigationTarget>
  )
}

function AppContent() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('window') === 'mindmap' && params.get('id')) return <Suspense fallback={<div className="view-loading">正在载入思维导图…</div>}><MindMapWindow mapId={params.get('id')!} /></Suspense>
  if (params.get('window') === 'note' && params.get('id')) {
    return <NoteWindow noteId={params.get('id')!} createdFromNew={params.get('new') === '1'} />
  }
  if (params.get('window') === 'compare') return <CompareWindow />
  if (params.get('window') === 'reader' && params.get('id')) {
    return <Suspense fallback={<main className="note-window-loading">正在载入独立阅读窗口…</main>}><ReaderWindow bookId={params.get('id')!} /></Suspense>
  }
  return <MainApp />
}

function App() {
  return <><AppContent /><TooltipLayer /></>
}

export default App
