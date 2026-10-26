import {
  BookOpen, FilePlus2, GripHorizontal, ListTree, LoaderCircle,
  Maximize2, Minus, PanelRightOpen, Trash2, Type, X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isTauriRuntime } from '../../lib/platform'
import { blockIndexForOffset, buildReaderDocument, linesForBlock, parseReaderLocator, progressForOffset } from './readerLogic'
import {
  createBrowserCandidate, deleteReaderBook, importTextBook, listReaderBooks,
  loadReaderBookContent, pickTextBookCandidate, refreshTextBookPreview, saveReaderProgress,
} from './readerRepository'
import type { ReaderBook, ReaderBookContent, ReaderLocator, ReaderPreferences, TextBookCandidate } from './types'
import { accumulateBoundaryWheel, adjacentChapterBlockIndex, EMPTY_WHEEL_ACCUMULATOR, isScrollBoundary, keyboardReaderDirection, type WheelAccumulator } from './readerNavigation'

const ENCODING_OPTIONS = [['UTF-8', 'UTF-8'], ['GBK', 'GB18030 / GBK'], ['Big5', 'Big5'], ['Shift_JIS', 'Shift_JIS'], ['UTF-16LE', 'UTF-16 LE'], ['UTF-16BE', 'UTF-16 BE']] as const

function friendlySize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function ImportDialog({ candidate, onCancel, onImported, onStatusChange }: { candidate: TextBookCandidate; onCancel(): void; onImported(book: ReaderBook): void; onStatusChange(message: string): void }) {
  const initialEncoding = ENCODING_OPTIONS.some(([value]) => value.toLowerCase() === candidate.detectedEncoding.toLowerCase()) ? candidate.detectedEncoding : 'UTF-8'
  const [encoding, setEncoding] = useState(initialEncoding)
  const [preview, setPreview] = useState(candidate)
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null)

  async function changeEncoding(next: string) {
    setEncoding(next); setBusy('preview')
    try { setPreview(await refreshTextBookPreview(candidate, next)) } catch (error) { onStatusChange(`编码预览失败：${String(error)}`) } finally { setBusy(null) }
  }
  async function confirmImport() {
    setBusy('import')
    try { onImported(await importTextBook(candidate, encoding)) } catch (error) { onStatusChange(`TXT 导入失败：${String(error)}`); setBusy(null) }
  }
  return <div className="reader-dialog-backdrop" role="presentation"><section className="reader-import-dialog" role="dialog" aria-modal="true" aria-labelledby="reader-import-title">
    <header><div><span className="eyebrow">导入前检查</span><h2 id="reader-import-title">{candidate.title}</h2></div><button className="icon-only-button" onClick={onCancel} aria-label="取消导入"><X size={17} /></button></header>
    <div className="reader-import-meta"><span>{candidate.sourceFileName}</span><span>{friendlySize(candidate.byteSize)}</span><label>文字编码<select value={encoding} disabled={busy !== null} onChange={(event) => void changeEncoding(event.target.value)}>{ENCODING_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    <div className="reader-preview-heading"><strong>内容预览</strong><span>{busy === 'preview' ? '正在重新解码…' : `检测结果：${preview.detectedEncoding}`}</span></div>
    <pre className="reader-import-preview">{preview.preview || '文件中没有可显示的文字。'}</pre>
    {preview.hadDecodingErrors ? <p className="reader-encoding-warning">当前编码产生了替换字符，请切换编码并确认预览正常后再导入。</p> : null}
    <footer><p>导入后会保存 UTF-8 副本；移动或删除原文件不会影响书库。</p><div><button className="secondary-button" onClick={onCancel}>取消</button><button className="primary-button" disabled={busy !== null || preview.hadDecodingErrors} onClick={() => void confirmImport()}>{busy === 'import' ? <LoaderCircle className="reader-spinner" size={16} /> : <FilePlus2 size={16} />}导入书库</button></div></footer>
  </section></div>
}

interface ReaderWorkspaceProps {
  onStatusChange(message: string): void
  preferences: ReaderPreferences
  onPreferencesChange(value: ReaderPreferences): void
  standalone?: boolean
  initialBookId?: string
  onOpenStandalone?(book: ReaderBook): void
  onFlushReady?(flush: () => Promise<void>): void
  panelOpen?: boolean
  onPanelOpenChange?(open: boolean): void
  onRequestClose?(): void
  onMinimize?(): void
  onToggleMaximize?(): void
}

export function ReaderWorkspace({ onStatusChange, preferences, onPreferencesChange, standalone = false, initialBookId, onOpenStandalone, onFlushReady, panelOpen = false, onPanelOpenChange, onRequestClose, onMinimize, onToggleMaximize }: ReaderWorkspaceProps) {
  const [books, setBooks] = useState<ReaderBook[]>([])
  const [active, setActive] = useState<ReaderBookContent | null>(null)
  const [loadingBookId, setLoadingBookId] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [candidate, setCandidate] = useState<TextBookCandidate | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<ReaderBook | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [highlightedBookId, setHighlightedBookId] = useState<string | null>(null)
  const [blockIndex, setBlockIndex] = useState(0)
  const [displayProgress, setDisplayProgress] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  const [layoutRevision, setLayoutRevision] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const activeIdRef = useRef<string | null>(null)
  const contentLengthRef = useRef(0)
  const locatorRef = useRef<ReaderLocator>({ version: 1, offset: 0, blockId: '' })
  const saveTimerRef = useRef<number | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const loadRequestRef = useRef(0)
  const wheelAccumulatorRef = useRef<WheelAccumulator>(EMPTY_WHEEL_ACCUMULATOR)
  const documentModel = useMemo(() => buildReaderDocument(active?.content ?? ''), [active?.content])
  const block = documentModel.blocks[blockIndex]
  const lines = useMemo(() => block ? linesForBlock(block) : [], [block])

  const flushProgress = useCallback(async (failHard = false) => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null
    const bookId = activeIdRef.current
    const locator = locatorRef.current
    if (!bookId) return
    const progress = progressForOffset(locator.offset, contentLengthRef.current)
    try {
      await saveReaderProgress(bookId, progress, locator)
      const locatorJson = JSON.stringify(locator)
      setBooks((current) => current.map((bookItem) => bookItem.id === bookId ? { ...bookItem, progress, locatorJson } : bookItem))
      if (isTauriRuntime()) {
        const { emit } = await import('@tauri-apps/api/event')
        await emit('reader-progress-changed', { bookId, progress, locatorJson }).catch(() => undefined)
      }
    } catch (error) {
      onStatusChange('阅读进度保存失败，请稍后重试')
      if (failHard) throw error
    }
  }, [onStatusChange])

  useEffect(() => { onFlushReady?.(() => flushProgress(true)) }, [flushProgress, onFlushReady])

  const openBook = useCallback(async (bookId: string) => {
    const requestId = ++loadRequestRef.current
    await flushProgress()
    if (requestId !== loadRequestRef.current) return
    setLoadingBookId(bookId)
    try {
      const loaded = await loadReaderBookContent(bookId)
      if (requestId !== loadRequestRef.current) return
      const model = buildReaderDocument(loaded.content)
      const locator = parseReaderLocator(loaded.book.locatorJson, model.length, loaded.book.progress)
      const nextBlockIndex = Math.max(0, blockIndexForOffset(model.blocks, locator.offset))
      locator.blockId = model.blocks[nextBlockIndex]?.id ?? ''
      const restoredProgress = progressForOffset(locator.offset, model.length)
      const restoredBook = { ...loaded.book, progress: restoredProgress, locatorJson: JSON.stringify(locator) }
      activeIdRef.current = loaded.book.id
      contentLengthRef.current = model.length
      locatorRef.current = locator
      setActive({ ...loaded, book: restoredBook }); setBlockIndex(nextBlockIndex); setDisplayProgress(restoredProgress); setHighlightedBookId(null)
      setBooks((current) => [restoredBook, ...current.filter((item) => item.id !== loaded.book.id)])
      if (!loaded.book.locatorJson) void saveReaderProgress(loaded.book.id, restoredProgress, locator).catch(() => onStatusChange('旧版阅读进度已恢复，但锚点迁移保存失败'))
      onStatusChange(`正在阅读《${loaded.book.title}》`)
    } catch (error) {
      if (requestId === loadRequestRef.current) onStatusChange(`无法打开书籍：${String(error)}`)
    } finally {
      if (requestId === loadRequestRef.current) setLoadingBookId(null)
    }
  }, [flushProgress, onStatusChange])

  useEffect(() => {
    let cancelled = false
    void listReaderBooks().then((savedBooks) => {
      if (cancelled) return
      setBooks(savedBooks); setInitializing(false)
      if (standalone && initialBookId) void openBook(initialBookId)
      else if (!standalone && preferences.autoOpenRecent && savedBooks[0] && onOpenStandalone) onOpenStandalone(savedBooks[0])
    }).catch((error) => { if (!cancelled) { setInitializing(false); onStatusChange(`阅读器初始化失败：${String(error)}`) } })
    return () => { cancelled = true; loadRequestRef.current += 1 }
    // Initial entry behavior is intentionally sampled only when this workspace mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (standalone || !isTauriRuntime()) return
    let dispose: (() => void) | undefined
    void import('@tauri-apps/api/event').then(({ listen }) => listen<{ bookId: string; progress: number; locatorJson: string }>('reader-progress-changed', ({ payload }) => {
      setBooks((current) => current.map((bookItem) => bookItem.id === payload.bookId ? { ...bookItem, progress: payload.progress, locatorJson: payload.locatorJson } : bookItem))
    })).then((unlisten) => { dispose = unlisten })
    return () => dispose?.()
  }, [standalone])

  useEffect(() => () => { if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current); void flushProgress() }, [flushProgress])

  function locateVisibleOffset() {
    const viewport = viewportRef.current
    const article = articleRef.current
    if (!viewport || !article || !block) return locatorRef.current.offset
    const markers = Array.from(article.querySelectorAll<HTMLElement>('[data-reader-offset]'))
    if (markers.length === 0) return block.startOffset
    if (preferences.readingMode === 'paged') {
      const left = viewport.scrollLeft + 8
      return Number((markers.find((marker) => marker.offsetLeft + marker.offsetWidth > left) ?? markers.at(-1))?.dataset.readerOffset ?? block.startOffset)
    }
    const top = viewport.scrollTop + 12
    return Number((markers.find((marker) => marker.offsetTop + marker.offsetHeight > top) ?? markers.at(-1))?.dataset.readerOffset ?? block.startOffset)
  }

  function commitVisiblePosition() {
    if (!block || !active) return
    const offset = Math.min(block.endOffset, Math.max(block.startOffset, locateVisibleOffset()))
    const locator = { version: 1 as const, offset, blockId: block.id }
    locatorRef.current = locator
    const progress = progressForOffset(offset, active.content.length)
    setDisplayProgress(progress)
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => void flushProgress(), 450)
  }

  const updatePageMetrics = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport || preferences.readingMode !== 'paged') { setPageIndex(0); setPageCount(1); return }
    const count = Math.max(1, Math.ceil(viewport.scrollWidth / Math.max(1, viewport.clientWidth)))
    setPageCount(count)
    setPageIndex(Math.min(count - 1, Math.round(viewport.scrollLeft / Math.max(1, viewport.clientWidth))))
  }, [preferences.readingMode])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !block) return
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const markers = Array.from(articleRef.current?.querySelectorAll<HTMLElement>('[data-reader-offset]') ?? [])
      const target = [...markers].reverse().find((marker) => Number(marker.dataset.readerOffset) <= locatorRef.current.offset) ?? markers[0]
      viewport.style.scrollBehavior = 'auto'
      if (preferences.readingMode === 'paged') viewport.scrollLeft = target ? Math.floor(target.offsetLeft / Math.max(1, viewport.clientWidth)) * viewport.clientWidth : 0
      else viewport.scrollTop = target ? Math.max(0, target.offsetTop - 12) : 0
      updatePageMetrics()
    }))
    return () => window.cancelAnimationFrame(frame)
  }, [block, layoutRevision, preferences.contentWidth, preferences.fontFamily, preferences.fontSize, preferences.lineHeight, preferences.readingMode, updatePageMetrics])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(() => setLayoutRevision((value) => value + 1))
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [active])

  function handleScroll() {
    if (scrollFrameRef.current !== null) return
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null; commitVisiblePosition(); updatePageMetrics()
    })
  }

  function moveToBlock(nextIndex: number, atEnd = false) {
    const nextBlock = documentModel.blocks[nextIndex]
    if (!nextBlock) return false
    commitVisiblePosition()
    locatorRef.current = { version: 1, offset: atEnd ? Math.max(nextBlock.startOffset, nextBlock.endOffset - 1) : nextBlock.startOffset, blockId: nextBlock.id }
    setBlockIndex(nextIndex); setPageIndex(0); setPageCount(1)
    return true
  }

  function movePage(direction: 1 | -1) {
    const viewport = viewportRef.current
    if (!viewport || !block) return
    if (preferences.readingMode === 'paged') {
      const next = pageIndex + direction
      if (next >= 0 && next < pageCount) {
        viewport.scrollTo({ left: next * viewport.clientWidth, behavior: 'smooth' }); setPageIndex(next); return
      }
      moveToBlock(blockIndex + direction, direction < 0)
      return
    }
    const edge = direction > 0 ? viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 3 : viewport.scrollTop <= 3
    if (edge) moveToBlock(blockIndex + direction, direction < 0)
    else viewport.scrollBy({ top: direction * viewport.clientHeight * .88, behavior: 'smooth' })
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!block || !preferences.autoTurnChapterOnWheel || Math.abs(event.deltaY) < 1) return
    const viewport = viewportRef.current
    if (!viewport) return
    const direction = event.deltaY > 0 ? 1 : -1
    const atBoundary = preferences.readingMode === 'paged'
      || isScrollBoundary(direction, viewport.scrollTop, viewport.clientHeight, viewport.scrollHeight)
    if (!atBoundary) {
      wheelAccumulatorRef.current = EMPTY_WHEEL_ACCUMULATOR
      return
    }
    const result = accumulateBoundaryWheel(wheelAccumulatorRef.current, event.deltaY, performance.now())
    wheelAccumulatorRef.current = result.state
    if (!result.trigger) return
    event.preventDefault()
    movePage(result.trigger)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.isComposing || target?.closest('input, textarea, select, button, [contenteditable="true"]') || !active) return
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.repeat) {
        const next = adjacentChapterBlockIndex(documentModel.blocks, blockIndex, event.key === 'ArrowRight' ? 1 : -1)
        if (next !== null) { event.preventDefault(); moveToBlock(next) }
        return
      }
      const direction = keyboardReaderDirection(event.key, event.shiftKey, preferences.readingMode)
      if (!direction) return
      event.preventDefault(); movePage(direction)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  async function beginNativeImport() { try { const selected = await pickTextBookCandidate(); if (selected) setCandidate(selected) } catch (error) { onStatusChange(`无法读取 TXT：${String(error)}`) } }
  async function receiveBrowserFile(file: File | undefined) {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.txt')) { onStatusChange('基础阅读器当前仅支持 TXT 文件'); return }
    try { setCandidate(await createBrowserCandidate(file)) } catch (error) { onStatusChange(`无法读取 TXT：${String(error)}`) }
  }
  async function finishImport(bookItem: ReaderBook) {
    setCandidate(null); setBooks((current) => [bookItem, ...current.filter((item) => item.id !== bookItem.id)]); setHighlightedBookId(bookItem.id)
    onStatusChange(`《${bookItem.title}》已复制到本地书库；原 TXT 不受后续书库操作影响`)
    if (preferences.openAfterImport && !standalone && onOpenStandalone) onOpenStandalone(bookItem)
    else if (preferences.openAfterImport) await openBook(bookItem.id)
    else { await flushProgress(); activeIdRef.current = null; contentLengthRef.current = 0; setActive(null); setLoadingBookId(null) }
  }
  async function confirmDelete() {
    if (!deleteCandidate) return
    const target = deleteCandidate; setDeleting(true)
    const wasActive = active?.book.id === target.id
    const wasLoading = loadingBookId === target.id
    if (wasLoading) { loadRequestRef.current += 1; setLoadingBookId(null) }
    if (wasActive) { if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; activeIdRef.current = null; contentLengthRef.current = 0; loadRequestRef.current += 1 }
    try {
      await deleteReaderBook(target.id)
      setBooks((current) => current.filter((item) => item.id !== target.id))
      if (wasActive) { setActive(null); setBlockIndex(0); setDisplayProgress(0) }
      setDeleteCandidate(null); setHighlightedBookId((id) => id === target.id ? null : id)
      onStatusChange(`《${target.title}》已从书库删除；原始 TXT 未被修改`)
    } catch (error) {
      if (wasActive) { activeIdRef.current = active.book.id; contentLengthRef.current = active.content.length }
      onStatusChange(`删除失败，书籍仍保留在书库：${String(error)}`)
    } finally { setDeleting(false) }
  }
  function changeMode(next: ReaderPreferences['readingMode']) { commitVisiblePosition(); onPreferencesChange({ ...preferences, readingMode: next }) }
  function jumpToToc(offset: number) {
    const nextIndex = blockIndexForOffset(documentModel.blocks, offset)
    if (nextIndex < 0) return
    locatorRef.current = { version: 1, offset, blockId: documentModel.blocks[nextIndex].id }; setBlockIndex(nextIndex)
  }

  if (!standalone) return <section className="reader-library-workspace">
    <header className="reader-library-hero"><div><span className="eyebrow">本地 TXT 书架</span><h2>选择一本书，在独立窗口中阅读</h2><p>书架只负责管理内容与进度；正文、目录和排版设置已移入独立阅读窗口。</p></div><button className="primary-button" onClick={() => isTauriRuntime() ? void beginNativeImport() : fileInputRef.current?.click()}><FilePlus2 size={17} />导入 TXT</button></header>
    <input ref={fileInputRef} className="reader-file-input" type="file" accept=".txt,text/plain" onChange={(event) => { void receiveBrowserFile(event.target.files?.[0]); event.currentTarget.value = '' }} />
    {initializing ? <div className="reader-state"><LoaderCircle className="reader-spinner" size={28} /><p>正在读取书架…</p></div> : books.length > 0 ? <div className="reader-library-grid">
      {books.map((bookItem) => <article key={bookItem.id} className={`reader-library-card ${highlightedBookId === bookItem.id ? 'highlighted' : ''}`}>
        <button className="reader-library-cover" onClick={() => onOpenStandalone?.(bookItem)} aria-label={`阅读《${bookItem.title}》`}><BookOpen size={30} /><span>{Math.round(bookItem.progress * 100)}%</span></button>
        <div><strong title={bookItem.title}>{bookItem.title}</strong><small>{friendlySize(bookItem.byteSize)} · {bookItem.encoding}</small><div className="reader-card-progress"><span style={{ width: `${bookItem.progress * 100}%` }} /></div></div>
        <button className="reader-book-delete" aria-label={`删除《${bookItem.title}》`} title="从书架删除" onClick={() => setDeleteCandidate(bookItem)}><Trash2 size={15} /></button>
      </article>)}
    </div> : <div className="reader-state reader-welcome"><BookOpen size={42} /><h2>书架还是空的</h2><p>导入 TXT 后，应用会保存自己的受管副本；原文件之后可以移动或删除。</p><button className="primary-button" onClick={() => isTauriRuntime() ? void beginNativeImport() : fileInputRef.current?.click()}><FilePlus2 size={17} />导入 TXT</button></div>}
    {candidate ? <ImportDialog candidate={candidate} onCancel={() => setCandidate(null)} onImported={(bookItem) => void finishImport(bookItem)} onStatusChange={onStatusChange} /> : null}
    {deleteCandidate ? <div className="reader-dialog-backdrop" role="presentation"><section className="reader-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="reader-delete-title"><Trash2 size={24} /><h2 id="reader-delete-title">从书架删除《{deleteCandidate.title}》？</h2><p>将删除书架记录、阅读进度和应用管理的副本。你最初导入的 TXT 文件不会被修改。</p><footer><button className="secondary-button" disabled={deleting} onClick={() => setDeleteCandidate(null)}>取消</button><button className="danger-button" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? <LoaderCircle className="reader-spinner" size={16} /> : <Trash2 size={16} />}删除书籍</button></footer></section></div> : null}
  </section>

  return <section className="reader-workspace standalone minimal">
    <main className="reader-main-panel">
      <div className="reader-drag-handle" data-tauri-drag-region title="拖动阅读窗口"><GripHorizontal size={18} /></div>
      <button className="reader-edge-toggle" aria-label="显示阅读控制面板" title="显示阅读控制面板" onClick={() => onPanelOpenChange?.(true)}><PanelRightOpen size={18} /></button>
      {initializing ? <div className="reader-state"><LoaderCircle className="reader-spinner" size={28} /><p>正在读取书库…</p></div> : active && block ? <>
        <div ref={viewportRef} className={`reader-scroll-viewport ${preferences.readingMode === 'paged' ? 'paged' : ''}`} onScroll={handleScroll} onWheel={handleWheel} tabIndex={0} aria-label={`${active.book.title}正文`}>
          <article ref={articleRef} className={`reader-document reader-font-${preferences.fontFamily} ${preferences.textShadow ? 'with-text-shadow' : ''}`} style={{ fontSize: `${preferences.fontSize}px`, lineHeight: preferences.lineHeight, color: preferences.textColor || 'var(--text-primary)', ['--reader-content-width' as string]: `${preferences.contentWidth}px`, ['--reader-indent' as string]: preferences.firstLineIndent }}>
            {block.showHeading ? <h2 data-reader-offset={block.chapterOffset}>{block.chapterTitle}</h2> : null}
            {lines.map((line, index) => <p className={line.shouldIndent ? 'reader-indent' : undefined} key={`${line.offset}-${index}`} data-reader-offset={line.offset}>{line.text || <br />}</p>)}
          </article>
        </div>
      </> : <div className="reader-state reader-welcome"><BookOpen size={42} /><h2>{standalone ? '正在准备独立阅读窗口' : '先从书库选择一本书'}</h2><p>{standalone ? '如果正文没有出现，请回到主窗口确认书籍仍在本地书库中。' : '进入阅读器不会自动打开正文。导入的新书也会先留在书库，除非你在设置中开启自动打开。'}</p>{!standalone ? <button className="primary-button" onClick={() => isTauriRuntime() ? void beginNativeImport() : fileInputRef.current?.click()}><FilePlus2 size={17} />导入 TXT</button> : null}</div>}
      {active ? <div className="reader-progress-track" aria-hidden="true"><span style={{ width: `${displayProgress * 100}%` }} /></div> : null}
    </main>
    <aside className={`reader-control-panel ${panelOpen ? 'open' : ''}`} aria-hidden={!panelOpen}>
      <header><div><small>{active ? `${Math.round(displayProgress * 100)}% · ${active.book.encoding}` : '独立阅读'}</small><strong>{active?.book.title ?? '正在载入'}</strong></div><button className="icon-only-button" aria-label="关闭控制面板" onClick={() => onPanelOpenChange?.(false)}><X size={17} /></button></header>
      <div className="reader-panel-window-actions"><button onClick={onMinimize}><Minus size={15} />最小化</button><button onClick={onToggleMaximize}><Maximize2 size={14} />最大化/还原</button><button onClick={onRequestClose}><X size={15} />关闭窗口</button></div>
      <section><h3><Type size={15} />阅读排版</h3>
        <label>阅读方式<select value={preferences.readingMode} onChange={(event) => changeMode(event.target.value as ReaderPreferences['readingMode'])}><option value="chapter-scroll">局部滚动</option><option value="paged">单页分页</option></select></label>
        <label>字号<input type="range" min="14" max="32" value={preferences.fontSize} onChange={(event) => onPreferencesChange({ ...preferences, fontSize: Number(event.target.value) })} /><output>{preferences.fontSize}px</output></label>
        <label>行距<select value={preferences.lineHeight} onChange={(event) => onPreferencesChange({ ...preferences, lineHeight: Number(event.target.value) })}><option value="1.55">紧凑</option><option value="1.9">舒适</option><option value="2.2">宽松</option></select></label>
        <label>字体<select value={preferences.fontFamily} onChange={(event) => onPreferencesChange({ ...preferences, fontFamily: event.target.value as ReaderPreferences['fontFamily'] })}><option value="serif">宋体</option><option value="sans">黑体</option></select></label>
        <label>首行缩进<input type="range" min="0" max="8" step="1" value={preferences.firstLineIndent} onChange={(event) => onPreferencesChange({ ...preferences, firstLineIndent: Number(event.target.value) })} /><output>{preferences.firstLineIndent} 字</output></label>
        <label>背景不透明度<input type="range" min="0" max="1" step="0.02" value={preferences.backgroundOpacity} onChange={(event) => onPreferencesChange({ ...preferences, backgroundOpacity: Number(event.target.value) })} /><output>{Math.round(preferences.backgroundOpacity * 100)}%</output></label>
        <label>文字颜色<input type="color" value={preferences.textColor || '#2f2b27'} onChange={(event) => onPreferencesChange({ ...preferences, textColor: event.target.value })} /><button className="reader-color-reset" onClick={() => onPreferencesChange({ ...preferences, textColor: '' })}>跟随主题</button></label>
        <label className="reader-panel-check"><input type="checkbox" checked={preferences.textShadow} onChange={(event) => onPreferencesChange({ ...preferences, textShadow: event.target.checked })} />复杂背景下增加文字阴影</label>
      </section>
      <section className="reader-panel-toc"><h3><ListTree size={15} />目录 <span>{documentModel.toc.length || '—'}</span></h3>{documentModel.toc.length > 0 ? <nav>{documentModel.toc.map((entry) => <button key={entry.id} onClick={() => { jumpToToc(entry.offset); onPanelOpenChange?.(false) }}>{entry.title}</button>)}</nav> : <p>未识别到章节标题；左右方向键不会把内部区块伪装成章节。</p>}</section>
      <div className="reader-keyboard-help"><strong>快捷键</strong><small>↑/↓ 翻页或滚屏 · ←/→ 切章 · Esc 关闭面板/窗口 · B 临时隐藏</small></div>
    </aside>
    {candidate ? <ImportDialog candidate={candidate} onCancel={() => setCandidate(null)} onImported={(bookItem) => void finishImport(bookItem)} onStatusChange={onStatusChange} /> : null}
    {deleteCandidate ? <div className="reader-dialog-backdrop" role="presentation"><section className="reader-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="reader-delete-title"><Trash2 size={24} /><h2 id="reader-delete-title">从书库删除《{deleteCandidate.title}》？</h2><p>将删除书库记录、阅读进度和应用管理的副本。你最初导入的 TXT 文件不会被修改。</p><footer><button className="secondary-button" disabled={deleting} onClick={() => setDeleteCandidate(null)}>取消</button><button className="danger-button" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? <LoaderCircle className="reader-spinner" size={16} /> : <Trash2 size={16} />}删除书籍</button></footer></section></div> : null}
  </section>
}
