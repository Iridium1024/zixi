import { compareText } from './diffEngine'
import { FloatingMenu } from '../../components/FloatingMenu'
import { copyText } from '../../lib/copyText'
import { countGraphemes } from './tokenize'
import { ViewStatus } from '../../components/ViewStatus'
import Editor, { loader, type OnMount } from '@monaco-editor/react'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker'
import * as localMonaco from 'monaco-editor/esm/vs/editor/editor.api'
import { ArrowDown, ArrowLeftRight, ArrowUp, Check, Clipboard, Download, Eraser, FileDown, PanelTopOpen, StickyNote } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isTauriRuntime } from '../../lib/platform'
import { formatComparison, type ExportFormat } from '../export/formatters'
import { saveExport } from '../export/saveExport'
import { createNote } from '../notes/noteRepository'
import { openNoteWindow } from '../notes/openNoteWindow'
import { compareEditorLineHeight, type ResolvedTheme } from '../settings/appearance'
import { type ComparePreferences } from './comparePreferences'
import { ComparisonConflictError, loadComparison, saveComparison, type ComparisonDraft } from './comparisonRepository'
import { acceptComparisonEvent, type ComparisonSessionEvent } from './comparisonEvents'
import { coordinateCompareWindowClose, type CompareWindowCloseResult, type ComparisonSaveResult } from './compareWindowClose'
import { type DiffChange } from './types'
import { useDiffWorker } from './useDiffWorker'
import { MONACO_DARK_THEME, MONACO_LIGHT_THEME } from './monacoThemes'
import { createBoundedLayoutScheduler, layoutEditorFromContainer } from './responsiveLayout'
import { compactGutterDecorationWidth, MANUSCRIPT_INSET, MANUSCRIPT_SCROLLBAR, monacoWrappingOptions } from './monacoOptions'
import { useSaveShortcut } from '../../lib/useSaveShortcut'
import { applyMainWindowCloseBehavior, type MainWindowCloseBehavior } from '../settings/windowBehavior'

type Monaco = typeof import('monaco-editor')
type MonacoEditor = import('monaco-editor').editor.IStandaloneCodeEditor
type DecorationCollection = import('monaco-editor').editor.IEditorDecorationsCollection

const monacoGlobal = self as typeof globalThis & { MonacoEnvironment?: { getWorker(): Worker } }
monacoGlobal.MonacoEnvironment = { getWorker() { return new editorWorker() } }
loader.config({ monaco: localMonaco })

const SAMPLE_LEFT = `各位同事：\n\n请于周五前提交项目总结。附件中的数据需要再次核对。\n\n谢谢。`
const SAMPLE_RIGHT = `各位同事：\n\n请务必于本周五前提交项目总结。附件中的关键数据需要再次核对！\n\n谢谢。`

interface CompareWorkspaceProps {
  statusMessage?: string
  onStatusChange?: (status: string) => void
  resolvedTheme: ResolvedTheme
  editorFontFamily: string
  fontMeasureKey: string
  editorFontSize: number
  preferences: ComparePreferences
  standalone?: boolean
  onOpenStandalone?: () => void
  mainWindowCloseBehavior?: MainWindowCloseBehavior
  onBeforeLeaveReady?: (handler: (() => Promise<boolean>) | null) => void
}

function optionsFor(change: DiffChange, side: 'left' | 'right', colors: Record<string, string>) {
  const isLeft = side === 'left'
  const className = change.kind === 'replace' ? 'diff-replace' : isLeft ? 'diff-delete' : 'diff-insert'
  const kind = change.kind === 'replace' ? 'replace' : isLeft ? 'delete' : 'insert'
  return { inlineClassName: className, className, overviewRuler: { color: colors[kind], position: 4 } }
}

function makeDecorations(editor: MonacoEditor | null, changes: DiffChange[], side: 'left' | 'right') {
  const model = editor?.getModel()
  if (!editor || !model) return []
  const style = getComputedStyle(document.documentElement)
  const colors = Object.fromEntries(['insert', 'delete', 'replace'].map((kind) => [kind, style.getPropertyValue(`--diff-${kind}`).trim()]))
  return changes.flatMap((change) => {
    const sourceRange = side === 'left' ? change.leftRange : change.rightRange
    if (!sourceRange) return []
    const start = model.getPositionAt(sourceRange.start); const end = model.getPositionAt(sourceRange.end)
    return [{ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, options: optionsFor(change, side, colors) }]
  })
}

type CloseDecision = { status: 'saving' } | Exclude<CompareWindowCloseResult, { status: 'clean' | 'saved' }>

export function CompareWorkspace({ statusMessage, onStatusChange, resolvedTheme, editorFontFamily, fontMeasureKey, editorFontSize, preferences, standalone = false, onOpenStandalone, mainWindowCloseBehavior = 'keep', onBeforeLeaveReady }: CompareWorkspaceProps) {
  const [left, setLeft] = useState(SAMPLE_LEFT)
  const [right, setRight] = useState(SAMPLE_RIGHT)
  const [activeIndex, setActiveIndex] = useState(0)
  const [copied, setCopied] = useState<'left' | 'right' | null>(null)
  const [reportAnchor, setReportAnchor] = useState<HTMLElement | null>(null)
  const closeReportMenu = useCallback(() => setReportAnchor(null), [])
  const [saveNotice, setSaveNotice] = useState('')
  const [sessionConflict, setSessionConflict] = useState<ComparisonDraft | null>(null)
  const [closeDecision, setCloseDecision] = useState<CloseDecision | null>(null)
  const [gridWidth, setGridWidth] = useState(0)
  const { result, isCalculating, hasCurrentResult } = useDiffWorker(left, right, preferences.rule)
  const leftEditor = useRef<MonacoEditor | null>(null)
  const rightEditor = useRef<MonacoEditor | null>(null)
  const leftEditorHost = useRef<HTMLDivElement | null>(null)
  const rightEditorHost = useRef<HTMLDivElement | null>(null)
  const editorGrid = useRef<HTMLDivElement | null>(null)
  const leftDecorations = useRef<DecorationCollection | null>(null)
  const rightDecorations = useRef<DecorationCollection | null>(null)
  const scrolling = useRef(false)
  const syncScroll = useRef(preferences.syncScroll)
  const hydrated = useRef(false)
  const revision = useRef<number | null>(null)
  const leftRef = useRef(left); const rightRef = useRef(right)
  const dirty = useRef(false)
  const saveTimer = useRef<number | undefined>(undefined)
  const saveInFlight = useRef<Promise<ComparisonSaveResult> | null>(null)
  const closeInFlight = useRef<Promise<void> | null>(null)
  const sourceWindow = useRef(`compare-${crypto.randomUUID()}`)
  const seenEvents = useRef(new Set<string>())

  useEffect(() => { leftRef.current = left; rightRef.current = right; syncScroll.current = preferences.syncScroll }, [left, preferences.syncScroll, result.stats, right])

  useEffect(() => {
    let cancelled = false
    if (isTauriRuntime()) void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => { sourceWindow.current = getCurrentWindow().label }).catch(() => undefined)
    loadComparison().then((saved) => {
      if (cancelled || !saved) return
      setLeft(saved.leftText); setRight(saved.rightText); revision.current = saved.revision
    }).catch(() => setSaveNotice('读取上次比较会话失败，当前输入仍可继续使用。')).finally(() => { hydrated.current = true })
    return () => { cancelled = true }
  }, [])

  const publishSession = useCallback((nextLeft: string, nextRight: string) => {
    if (!isTauriRuntime()) return
    const event: ComparisonSessionEvent = { eventId: crypto.randomUUID(), sourceWindow: sourceWindow.current, sessionId: 'comparison-current', revision: revision.current, leftText: nextLeft, rightText: nextRight }
    seenEvents.current.add(event.eventId)
    void import('@tauri-apps/api/event').then(({ emit }) => emit('comparison-session-changed', event)).catch(() => undefined)
  }, [])

  const updateTexts = useCallback((nextLeft: string, nextRight: string) => {
    setLeft(nextLeft); setRight(nextRight); dirty.current = true; setSessionConflict(null); publishSession(nextLeft, nextRight)
  }, [publishSession])

  const saveCurrent = useCallback(async (): Promise<ComparisonSaveResult> => {
    if (!dirty.current) return { status: 'clean' }
    if (!hydrated.current) return { status: 'failed', error: new Error('比较会话仍在读取') }
    if (saveInFlight.current) return saveInFlight.current

    const submittedLeft = leftRef.current
    const submittedRight = rightRef.current
    const submittedStats = hasCurrentResult && submittedLeft === left && submittedRight === right ? result.stats : compareText({ left: submittedLeft, right: submittedRight, preset: preferences.rule }).stats
    const preset = preferences.rule.preset === 'custom' ? 'review' : preferences.rule.preset
    const operation = (async (): Promise<ComparisonSaveResult> => {
      try {
        const saved = await saveComparison({ leftText: submittedLeft, rightText: submittedRight, preset, stats: submittedStats }, revision.current)
        revision.current = saved.revision
        dirty.current = leftRef.current !== submittedLeft || rightRef.current !== submittedRight
        setSessionConflict(null)
        setSaveNotice('')
        return { status: 'saved' }
      } catch (error) {
        if (error instanceof ComparisonConflictError) {
          setSessionConflict(error.persisted)
          setSaveNotice('另一窗口已有更新；当前草稿未被覆盖。')
          return { status: 'conflict' }
        }
        setSaveNotice('比较会话保存失败，当前草稿仍保留在本窗口。')
        return { status: 'failed', error }
      }
    })()
    saveInFlight.current = operation
    try {
      return await operation
    } finally {
      if (saveInFlight.current === operation) saveInFlight.current = null
    }
  }, [hasCurrentResult, left, preferences.rule, result.stats, right])

  useEffect(() => {
    onBeforeLeaveReady?.(async () => {
      if (!hydrated.current) return false
      const result = await saveCurrent()
      return (result.status === 'saved' || result.status === 'clean') && !dirty.current
    })
    return () => onBeforeLeaveReady?.(null)
  }, [onBeforeLeaveReady, saveCurrent])

  useSaveShortcut(useCallback(async () => {
    const result = await saveCurrent()
    if (result.status === 'saved') {
      setSaveNotice('已保存')
      onStatusChange?.('比较会话已保存')
    } else if (result.status === 'clean') {
      setSaveNotice('没有需要保存的更改')
      onStatusChange?.('没有需要保存的更改')
    }
  }, [onStatusChange, saveCurrent]))

  useEffect(() => {
    if (!hydrated.current || !dirty.current || isCalculating) return
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => { void saveCurrent() }, 650)
    return () => window.clearTimeout(saveTimer.current)
  }, [isCalculating, left, preferences.rule.preset, right, saveCurrent])

  useEffect(() => {
    if (!isTauriRuntime()) return
    let dispose: (() => void) | undefined
    let cancelled = false
    void import('@tauri-apps/api/event').then(({ listen }) => listen<ComparisonSessionEvent>('comparison-session-changed', ({ payload }) => {
      if (payload.sessionId !== 'comparison-current' || !acceptComparisonEvent(seenEvents.current, sourceWindow.current, payload)) return
      if (dirty.current) { setSaveNotice('另一窗口正在编辑同一会话；当前草稿已保留，保存时会要求解决冲突。'); return }
      setLeft(payload.leftText); setRight(payload.rightText)
      if (payload.revision !== null) revision.current = payload.revision
    })).then((unlisten) => { if (cancelled) unlisten(); else dispose = unlisten })
    return () => { cancelled = true; dispose?.() }
  }, [])

  const destroyStandaloneWindow = useCallback(async () => {
    await applyMainWindowCloseBehavior(mainWindowCloseBehavior)
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().destroy()
  }, [mainWindowCloseBehavior])

  useEffect(() => {
    if (!standalone || !isTauriRuntime()) return
    let dispose: (() => void) | undefined
    let cancelled = false
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const current = getCurrentWindow()
      const unlisten = await current.onCloseRequested((event) => {
        event.preventDefault()
        if (closeInFlight.current) return
        setCloseDecision({ status: 'saving' })
        const request = coordinateCompareWindowClose({
          hasUnsavedChanges: () => dirty.current,
          save: saveCurrent,
          destroy: destroyStandaloneWindow,
        }).then((result) => {
          if (result.status === 'conflict' || result.status === 'failed') setCloseDecision(result)
        }).finally(() => {
          if (closeInFlight.current === request) closeInFlight.current = null
        })
        closeInFlight.current = request
      })
      if (cancelled) unlisten()
      else dispose = unlisten
    }).catch(() => setSaveNotice('独立窗口关闭监听初始化失败；当前内容仍会继续自动保存。'))
    return () => { cancelled = true; dispose?.() }
  }, [destroyStandaloneWindow, saveCurrent, standalone])

  const refreshEditorLayout = useCallback(() => {
    layoutEditorFromContainer(leftEditor.current, leftEditorHost.current)
    layoutEditorFromContainer(rightEditor.current, rightEditorHost.current)
  }, [])

  useEffect(() => {
    const scheduler = createBoundedLayoutScheduler(refreshEditorLayout)
    const hosts = [leftEditorHost.current, rightEditorHost.current].filter((host): host is HTMLDivElement => Boolean(host))
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => scheduler.schedule())
    hosts.forEach((host) => observer?.observe(host))
    let unlisten: (() => void) | undefined; let cancelled = false
    if (isTauriRuntime()) void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const dispose = await getCurrentWindow().onResized(() => scheduler.schedule())
      if (cancelled) dispose(); else unlisten = dispose
    }).catch(() => undefined)
    scheduler.schedule()
    return () => { cancelled = true; observer?.disconnect(); unlisten?.(); scheduler.dispose() }
  }, [refreshEditorLayout])

  useEffect(() => {
    const scheduler = createBoundedLayoutScheduler(refreshEditorLayout)
    localMonaco.editor.remeasureFonts(); scheduler.schedule()
    let cancelled = false
    void document.fonts?.ready.then(() => { if (!cancelled) { localMonaco.editor.remeasureFonts(); scheduler.schedule() } })
    return () => { cancelled = true; scheduler.dispose() }
  }, [editorFontFamily, editorFontSize, fontMeasureKey, refreshEditorLayout])

  useEffect(() => {
    const host = editorGrid.current
    if (!host || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setGridWidth(entry.contentRect.width))
    observer.observe(host); return () => observer.disconnect()
  }, [])

  const effectiveLayout = standalone ? 'stacked' : preferences.layout === 'auto' ? gridWidth > 0 && gridWidth < 920 ? 'stacked' : 'side-by-side' : preferences.layout
  const editorOptions = useMemo(() => ({
    ...monacoWrappingOptions(preferences),
    fontFamily: editorFontFamily, fontSize: editorFontSize, lineHeight: compareEditorLineHeight(editorFontSize),
    minimap: { enabled: false }, glyphMargin: false, lineNumbers: preferences.lineNumbers ? 'on' as const : 'off' as const,
    lineNumbersMinChars: 3, renderWhitespace: preferences.whitespace, scrollBeyondLastLine: false, smoothScrolling: true,
    padding: { top: 18, bottom: 18 }, scrollbar: { verticalScrollbarSize: MANUSCRIPT_INSET + MANUSCRIPT_SCROLLBAR, horizontalScrollbarSize: 6, verticalSliderSize: MANUSCRIPT_SCROLLBAR, horizontalSliderSize: 6, verticalHasArrows: false, horizontalHasArrows: false, arrowSize: 0 }, automaticLayout: true, accessibilityPageSize: 20,
  }), [editorFontFamily, editorFontSize, preferences])

  const configureEditor = useCallback((editor: MonacoEditor, monaco: Monaco, side: 'left' | 'right') => {
    monaco.editor.defineTheme('zixi-paper', MONACO_LIGHT_THEME); monaco.editor.defineTheme('zixi-charcoal', MONACO_DARK_THEME)
    monaco.editor.setTheme(resolvedTheme === 'dark' ? 'zixi-charcoal' : 'zixi-paper')
    const compactGutter = () => {
      const option = monaco.editor.EditorOption
      const foldingWidth = editor.getOption(option.folding) && editor.getOption(option.showFoldingControls) !== 'never' ? 16 : 0
      const width = MANUSCRIPT_INSET + compactGutterDecorationWidth(editor.getOption(option.lineHeight), editor.getOption(option.fontInfo).maxDigitWidth, editor.getModel()?.getLineCount() ?? 1, editor.getOption(option.lineNumbers).renderType !== 0, foldingWidth)
      if (editor.getOption(option.lineDecorationsWidth) !== width) editor.updateOptions({ lineDecorationsWidth: width })
    }
    compactGutter()
    const gutterConfig = editor.onDidChangeConfiguration(compactGutter)
    const gutterContent = editor.onDidChangeModelContent(compactGutter)
    editor.onDidDispose(() => { gutterConfig.dispose(); gutterContent.dispose() })
    if (side === 'left') { leftEditor.current = editor; leftDecorations.current = editor.createDecorationsCollection() }
    else { rightEditor.current = editor; rightDecorations.current = editor.createDecorationsCollection() }
    requestAnimationFrame(refreshEditorLayout)
    editor.onDidScrollChange((event) => {
      if (!syncScroll.current || scrolling.current || !event.scrollTopChanged) return
      const peer = side === 'left' ? rightEditor.current : leftEditor.current
      if (!peer) return
      scrolling.current = true; peer.setScrollTop(event.scrollTop); requestAnimationFrame(() => { scrolling.current = false })
    })
  }, [refreshEditorLayout, resolvedTheme])

  const mountLeft: OnMount = useCallback((editor, monaco) => configureEditor(editor, monaco, 'left'), [configureEditor])
  const mountRight: OnMount = useCallback((editor, monaco) => configureEditor(editor, monaco, 'right'), [configureEditor])

  useEffect(() => { localMonaco.editor.setTheme(resolvedTheme === 'dark' ? 'zixi-charcoal' : 'zixi-paper') }, [resolvedTheme])
  useEffect(() => {
    // Parent theme effects must finish before resolving the same CSS colors as the text.
    const frame = requestAnimationFrame(() => {
      leftDecorations.current?.set(makeDecorations(leftEditor.current, result.changes, 'left'))
      rightDecorations.current?.set(makeDecorations(rightEditor.current, result.changes, 'right'))
    })
    setActiveIndex((current) => Math.min(current, Math.max(result.changes.length - 1, 0)))
    onStatusChange?.(isCalculating ? '正在计算差异…' : `${result.stats.totalChanges} 处差异 · ${result.durationMs.toFixed(1)} ms`)
    return () => cancelAnimationFrame(frame)
  }, [isCalculating, onStatusChange, resolvedTheme, result])

  const revealChange = useCallback((index: number) => {
    const count = result.changes.length; if (!count) return
    const normalized = (index + count) % count; setActiveIndex(normalized)
    const change = result.changes[normalized]
    ;(['left', 'right'] as const).forEach((side) => {
      const editor = side === 'left' ? leftEditor.current : rightEditor.current; const range = side === 'left' ? change.leftRange : change.rightRange; const model = editor?.getModel()
      if (!editor || !model || !range) return
      const start = model.getPositionAt(range.start); const end = model.getPositionAt(range.end)
      const selection = { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }
      editor.revealRangeInCenter(selection); editor.setSelection(selection)
    })
  }, [result.changes])

  const copySide = async (side: 'left' | 'right') => { try { await copyText(side === 'left' ? left : right); setCopied(side); setSaveNotice(''); window.setTimeout(() => setCopied(null), 1300) } catch { setSaveNotice('无法写入剪贴板，请在对应稿件中手动全选复制。') } }
  const exportComparison = async (format: ExportFormat) => {
    closeReportMenu()
    if (!hasCurrentResult) { setSaveNotice('正在计算当前文本的差异，请完成后再导出报告。'); return }
    try { const saved = await saveExport('字隙-比较结果', format, formatComparison(left, right, result, format, preferences.rule)); if (saved) onStatusChange?.(`已导出 ${format === 'diff' ? 'Unified Diff' : format.toUpperCase()} 对比报告`) } catch { setSaveNotice('导出失败，当前输入仍保留在编辑器中，请重新选择路径。') }
  }
  const exportPlain = async (side: 'left' | 'right') => { try { await saveExport(side === 'left' ? '字隙-原文' : '字隙-修改稿', 'txt', side === 'left' ? left : right) } catch { setSaveNotice('导出失败，当前输入仍保留在编辑器中，请重新选择路径。') } }
  const createNoteFromSide = async (side: 'left' | 'right') => { try { const note = await createNote({ title: `${side === 'left' ? '原文' : '修改稿'} ${new Date().toLocaleDateString('zh-CN')}`, content: side === 'left' ? left : right }); await openNoteWindow(note.id, note.title); onStatusChange?.('稿件已保存为本地便签') } catch { setSaveNotice('无法打开独立便签，请在便签列表中检查已创建的记录；原稿件仍保留。') } }
  function sideHeader(side: 'left' | 'right') {
    const label = side === 'left' ? '原文' : '修改稿'
    return <header><h2>{label}</h2><span>{countGraphemes(side === 'left' ? left : right)} 字符</span><div className="manuscript-actions">
      <button className="ghost-icon" aria-label={`复制${label}`} title={copied === side ? '已复制' : `复制${label}`} onClick={() => void copySide(side)}>{copied === side ? <Check size={16} /> : <Clipboard size={16} />}</button>
      <button className="ghost-icon" aria-label={`导出${label}`} title={`导出${label} · TXT`} onClick={() => void exportPlain(side)}><Download size={16} /></button>
      <button className="ghost-icon" aria-label={`将${label}转为便签`} title={`将${label}转为便签`} onClick={() => void createNoteFromSide(side)}><StickyNote size={16} /></button>
    </div></header>
  }
  const restoreConflict = () => { if (!sessionConflict) return; setLeft(sessionConflict.leftText); setRight(sessionConflict.rightText); revision.current = sessionConflict.revision; dirty.current = false; setSessionConflict(null); setSaveNotice('已载入另一窗口保存的版本') }
  const overwriteConflict = () => { if (!sessionConflict) return; revision.current = sessionConflict.revision; dirty.current = true; setSessionConflict(null); void saveCurrent() }
  const discardAndClose = async () => {
    setCloseDecision({ status: 'saving' })
    try {
      await destroyStandaloneWindow()
    } catch (error) {
      setCloseDecision({ status: 'failed', phase: 'destroy', error })
    }
  }

  const closeDecisionCopy = closeDecision?.status === 'conflict'
    ? { title: '另一窗口已经保存了更新', detail: '当前窗口的未保存原文和修改稿仍在内存中。返回后可载入已保存版本，或明确选择保留当前草稿并覆盖。' }
    : closeDecision?.status === 'failed'
      ? closeDecision.phase === 'destroy'
        ? { title: '窗口关闭命令失败', detail: '当前窗口仍保持打开；已保存内容不会因此丢失，请返回后重试。' }
        : closeDecision.phase === 'changing'
          ? { title: '关闭前内容仍在变化', detail: '当前窗口仍保持打开。请停止输入后重试，避免遗漏最后一次修改。' }
          : { title: '关闭前保存失败', detail: '当前窗口的未保存原文和修改稿仍在内存中。返回可继续处理，放弃关闭会丢失这些未保存内容。' }
      : null

  return (
    <section className={`compare-workspace ${standalone ? 'compare-window-workspace' : ''}`} aria-label="文字比较工作区">
      <header className="workspace-toolbar compare-topline">
        <div className="compare-inline-stats" aria-label="差异统计" aria-live="polite"><span className="compare-stat insert" title="新增字符数"><i aria-hidden="true" />+{result.stats.insertedCharacters}</span><span className="compare-stat delete" title="删除字符数"><i aria-hidden="true" />−{result.stats.deletedCharacters}</span><span className="compare-stat replace" title="替换组数"><i aria-hidden="true" />↔ {result.stats.replacementGroups}</span></div>
        <ViewStatus message={statusMessage} />
        <div className="toolbar-actions">
          <div className="change-navigation" role="group" aria-label="差异导航"><button className="ghost-icon" title="上一处差异" aria-label="上一处差异" onClick={() => revealChange(activeIndex - 1)} disabled={!result.changes.length}><ArrowUp size={16} /></button><button className="ghost-icon" title="下一处差异" aria-label="下一处差异" onClick={() => revealChange(activeIndex + 1)} disabled={!result.changes.length}><ArrowDown size={16} /></button><output className="change-counter" aria-live="polite">{isCalculating ? '计算中…' : `${result.changes.length ? activeIndex + 1 : 0} / ${result.changes.length}`}</output></div>
          <button className="ghost-icon" aria-label="交换原文与修改稿" title="交换原文与修改稿" onClick={() => updateTexts(right, left)}><ArrowLeftRight size={16} /></button>
          <button className="ghost-icon" aria-label="清空两栏" title="清空两栏" onClick={() => updateTexts('', '')}><Eraser size={16} /></button>
          {onOpenStandalone && <button className="ghost-icon" aria-label="打开独立比较窗口" title="打开独立比较窗口" onClick={onOpenStandalone}><PanelTopOpen size={16} /></button>}
          <button className="ghost-icon" aria-label="导出对比报告" title={hasCurrentResult ? '导出双稿对比报告' : '等待当前比较完成'} disabled={!hasCurrentResult} aria-haspopup="menu" aria-expanded={Boolean(reportAnchor)} onClick={(event) => setReportAnchor(reportAnchor ? null : event.currentTarget)}><FileDown size={16} /></button>
        </div>
      </header>
      {reportAnchor && <FloatingMenu anchor={reportAnchor} label="导出对比报告" onClose={closeReportMenu}>{(['md', 'json', 'html', 'diff'] as ExportFormat[]).map((format) => <button role="menuitem" key={format} disabled={!hasCurrentResult} onClick={() => void exportComparison(format)}>{format === 'diff' ? 'Unified Diff（原始文本补丁）' : format.toUpperCase()}</button>)}</FloatingMenu>}
      {(result.message || saveNotice) && <div className="engine-notice">{saveNotice || result.message}</div>}
      {closeDecision?.status === 'saving' && <div className="compare-close-decision" role="status"><strong>正在安全保存并关闭…</strong><span>请稍候，当前窗口不会跳过未完成的保存。</span></div>}
      {closeDecisionCopy && <div className="compare-close-decision" role="alert"><strong>{closeDecisionCopy.title}</strong><span>{closeDecisionCopy.detail}</span><button onClick={() => setCloseDecision(null)}>返回处理</button><button className="discard-close-button" onClick={() => void discardAndClose()}>放弃未保存内容并关闭</button></div>}
      {sessionConflict && !closeDecision && <div className="comparison-conflict" role="alert"><strong>检测到并发编辑</strong><span>另一窗口已保存更新；当前草稿未被自动覆盖。</span><button onClick={restoreConflict}>载入已保存版本</button><button onClick={overwriteConflict}>保留当前草稿并覆盖</button></div>}
      <div ref={editorGrid} className={`editor-grid ${effectiveLayout === 'stacked' ? 'editor-grid-stacked' : ''}`}>
        <article className="editor-card">{sideHeader('left')}<div className="manuscript-body"><div className="monaco-editor-host" ref={leftEditorHost}><Editor height="100%" language="plaintext" value={left} onChange={(value) => updateTexts(value ?? '', rightRef.current)} onMount={mountLeft} options={editorOptions} aria-label="修改前文本" /></div></div></article>
        <article className="editor-card">{sideHeader('right')}<div className="manuscript-body"><div className="monaco-editor-host" ref={rightEditorHost}><Editor height="100%" language="plaintext" value={right} onChange={(value) => updateTexts(leftRef.current, value ?? '')} onMount={mountRight} options={editorOptions} aria-label="修改后文本" /></div></div></article>
      </div>

    </section>
  )
}
