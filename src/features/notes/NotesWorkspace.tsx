import {
  ArchiveRestore,
  AlertTriangle,
  Copy,
  Clock3,
  ExternalLink,
  FileDown,
  Plus,
  RotateCcw,
  Search,
  StickyNote,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { formatNote, type ExportFormat } from '../export/formatters'
import { saveExport } from '../export/saveExport'
import type { AppearanceSettings } from '../settings/appearance'
import { contrastRatio } from './colorContrast'
import {
  applyRevision,
  createConflictCopy,
  createNote,
  emptyTrash,
  getNote,
  listNotes,
  listRevisions,
  moveNoteToTrash,
  NoteConflictError,
  permanentlyDeleteNote,
  permanentlyDeleteNotes,
  restoreNote,
  restoreNotes,
  saveNote,
} from './noteRepository'
import { subscribeNoteEvents } from './noteEvents'
import { executeIndependentWindowEntry, executeNewNoteEntry } from './noteEntryFlow'
import { hideMainWindow, openNoteWindow } from './openNoteWindow'
import { NoteSaveCoordinator, type CoordinatedSaveState } from './saveCoordinator'
import {
  retainExistingTrashSelection,
  selectFilteredTrashIds,
  toggleTrashSelection,
} from './trashSelection'
import type { NoteRecord, NoteRevision } from './types'

interface NotesWorkspaceProps {
  appearance: AppearanceSettings
  trashMode?: boolean
  onStatusChange?: (status: string) => void
}

const BUILTIN_FONT_OPTIONS = [
  { id: 'yahei', family: "'Microsoft YaHei UI', 'Segoe UI', sans-serif", label: '微软雅黑' },
  { id: 'segoe', family: "'Segoe UI', 'Microsoft YaHei UI', sans-serif", label: 'Segoe UI' },
  { id: 'simsun', family: "'SimSun', 'Microsoft YaHei UI', serif", label: '宋体' },
  { id: 'kaiti', family: "'KaiTi', 'Microsoft YaHei UI', serif", label: '楷体' },
  { id: 'mono', family: "'Cascadia Mono', Consolas, 'Microsoft YaHei UI', monospace", label: '等宽字体' },
]

export function NotesWorkspace({ appearance, trashMode = false, onStatusChange }: NotesWorkspaceProps) {
  const [notes, setNotes] = useState<NoteRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<NoteRecord | null>(null)
  const [revisions, setRevisions] = useState<NoteRevision[]>([])
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [conflict, setConflict] = useState<NoteConflictError | null>(null)
  const [externalConflict, setExternalConflict] = useState(false)
  const [busy, setBusy] = useState('')
  const [confirmation, setConfirmation] = useState<'delete' | 'batch-delete' | 'empty-trash' | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedTrashIds, setSelectedTrashIds] = useState<Set<string>>(() => new Set())
  const draftRef = useRef<NoteRecord | null>(null)

  useEffect(() => { draftRef.current = draft }, [draft])

  const [coordinator] = useState(() => new NoteSaveCoordinator({
      delay: 700,
      save: (pending) => saveNote(pending),
      onSaved: (saved) => {
        setNotes((items) => [
          saved,
          ...items.filter((item) => item.id !== saved.id),
        ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
        setDraft((current) => {
          if (!current || current.id !== saved.id) return current
          return { ...current, updatedAt: saved.updatedAt }
        })
        void listRevisions(saved.id).then(setRevisions).catch(() => undefined)
      },
      onStateChange: (state: CoordinatedSaveState, error?: unknown) => {
        setSaving(state === 'scheduled' || state === 'saving')
        if (state === 'saved') {
          setSaveError('')
          setConflict(null)
        } else if (state === 'conflict' && error instanceof NoteConflictError) {
          setConflict(error)
          setSaveError('检测到另一窗口的新版本，请选择处理方式')
        } else if (state === 'failed') {
          setSaveError('保存失败，草稿仍保留在编辑器中')
        }
      },
    }))

  const refresh = useCallback(async () => {
    const all = await listNotes(trashMode)
    const filtered = all.filter((note) => trashMode ? Boolean(note.deletedAt) : !note.deletedAt)
    setNotes(filtered)
    if (trashMode && filtered.length === 0) setConfirmation(null)
    if (trashMode) setSelectedTrashIds((current) => retainExistingTrashSelection(current, filtered.map((note) => note.id)))
    setSelectedId((current) => current && filtered.some((note) => note.id === current)
      ? current
      : filtered[0]?.id ?? null)
    onStatusChange?.(`${filtered.length} 张${trashMode ? '已删除' : ''}便签`)
  }, [onStatusChange, trashMode])

  useEffect(() => {
    void refresh().catch(() => {
      setSaveError('读取失败，请检查本地数据库')
      onStatusChange?.('无法读取便签，本地数据库不可用')
    })
  }, [onStatusChange, refresh])

  useEffect(() => {
    const selected = notes.find((note) => note.id === selectedId) ?? null
    if (draftRef.current?.id !== selected?.id) {
      setDraft(selected)
      draftRef.current = selected
      if (selected) coordinator.setBaseline(selected)
      setConflict(null)
      setExternalConflict(false)
    }
    if (selected) {
      void listRevisions(selected.id)
        .then(setRevisions)
        .catch(() => {
          setRevisions([])
          setSaveError('历史版本读取失败')
        })
    }
    else setRevisions([])
  }, [coordinator, notes, selectedId])

  useEffect(() => {
    let dispose: (() => void) | undefined
    let cancelled = false
    void subscribeNoteEvents(async (event) => {
      const current = draftRef.current
      const affectsCurrent = current
        && (event.noteId === current.id || event.noteIds?.includes(current.id))
      if (affectsCurrent) {
        if (event.action === 'deleted' || event.action === 'trash-cleared') {
          coordinator.cancelPending()
          setDraft(null)
          setSelectedId(null)
        } else if (coordinator.hasPendingSave()) {
          setExternalConflict(true)
          setSaveError('另一窗口已更新此便签；本地草稿未被覆盖')
        } else {
          const latest = await getNote(current.id)
          if (latest) {
            draftRef.current = latest
            setDraft(latest)
            coordinator.setBaseline(latest)
          }
        }
      }
      await refresh()
    }).then((unlisten) => {
      if (cancelled) unlisten()
      else dispose = unlisten
    })
    const catchUp = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', catchUp)
    return () => {
      cancelled = true
      dispose?.()
      document.removeEventListener('visibilitychange', catchUp)
    }
  }, [coordinator, refresh])

  useEffect(() => () => {
    if (coordinator.hasPendingSave()) void coordinator.flush().catch(() => undefined)
  }, [coordinator])

  function updateDraft(next: NoteRecord) {
    setDraft(next)
    draftRef.current = next
    if (!trashMode) coordinator.schedule(next)
  }

  async function flushCurrent() {
    if (!draftRef.current || trashMode) return draftRef.current
    return coordinator.flush(draftRef.current)
  }

  async function selectNote(id: string) {
    if (trashMode && selectionMode) {
      setSelectedTrashIds((current) => toggleTrashSelection(current, id))
      return
    }
    if (id === selectedId) return
    try {
      await flushCurrent()
      setSelectedId(id)
    } catch {
      setSaveError('当前草稿尚未安全保存，请先处理后再切换')
    }
  }

  async function addNote() {
    try {
      const note = await executeNewNoteEntry('notes-page', {
        create: createNote,
        open: (value) => openNoteWindow(value.id, value.title),
        hideMain: hideMainWindow,
      })
      setNotes((items) => [note, ...items])
      setSelectedId(note.id)
      setDraft(note)
      draftRef.current = note
      coordinator.setBaseline(note)
      setSaveError('')
      onStatusChange?.(`${notes.length + 1} 张便签`)
    } catch {
      setSaveError('新建失败，请检查本地数据库')
      onStatusChange?.('无法新建便签，本地数据库不可用')
    }
  }

  async function openDraftWindow() {
    if (!draft) return
    try {
      await executeIndependentWindowEntry(async () => {
        const saved = await flushCurrent()
        if (!saved) throw new Error('没有可打开的便签')
        return saved
      }, {
        open: (saved) => openNoteWindow(saved.id, saved.title),
        hideMain: hideMainWindow,
      })
      setSaveError('')
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setSaveError(`独立窗口打开失败：${detail}`)
      onStatusChange?.('独立便签窗口打开失败，便签内容仍安全保存在本地')
    }
  }

  async function trashSelected() {
    if (!draft) return
    try {
      setBusy('trash')
      const saved = await flushCurrent()
      if (!saved) return
      coordinator.cancelPending()
      await moveNoteToTrash(saved)
      await refresh()
    } catch {
      setSaveError('移至回收站失败，请重试')
      onStatusChange?.('便签删除失败，原内容未丢失')
    } finally { setBusy('') }
  }

  async function restoreSelected() {
    if (!draft) return
    try {
      setBusy('restore')
      await restoreNote(draft)
      await refresh()
    } catch {
      setSaveError('恢复失败，请重试')
      onStatusChange?.('便签恢复失败，回收站内容未丢失')
    } finally { setBusy('') }
  }

  async function deleteSelectedForever() {
    if (!draft) return
    setBusy('delete')
    try {
      coordinator.cancelPending()
      await permanentlyDeleteNote(draft.id)
      setConfirmation(null)
      await refresh()
      setSaveError('')
    } catch {
      setSaveError('永久删除失败；已重新读取数据库状态')
      await refresh().catch(() => undefined)
    } finally { setBusy('') }
  }

  async function clearTrash() {
    if (!notes.length) return
    setBusy('empty-trash')
    try {
      const result = await emptyTrash()
      setConfirmation(null)
      await refresh()
      onStatusChange?.(`已永久删除 ${result.count} 张便签`)
    } catch {
      setSaveError('清空回收站失败；已重新读取数据库状态')
      await refresh().catch(() => undefined)
    } finally { setBusy('') }
  }

  function exitSelectionMode() {
    setSelectionMode(false)
    setSelectedTrashIds(new Set())
  }

  function selectCurrentTrashNote() {
    if (!selectedId) return
    setSelectedTrashIds((current) => toggleTrashSelection(current, selectedId))
  }

  async function restoreSelectedTrashNotes() {
    if (!selectedTrashIds.size) return
    setBusy('batch-restore')
    try {
      const result = await restoreNotes(selectedTrashIds)
      if (!result.noteIds.length) {
        setSaveError('所选便签已不在回收站，已重新读取列表')
      } else {
        setSaveError('')
        onStatusChange?.(`已恢复 ${result.noteIds.length} 张便签`)
      }
      await refresh()
    } catch {
      setSaveError('批量恢复失败，所选项已保留，请重试')
      await refresh().catch(() => undefined)
    } finally { setBusy('') }
  }

  async function deleteSelectedTrashNotes() {
    if (!selectedTrashIds.size) return
    setBusy('batch-delete')
    try {
      coordinator.cancelPending()
      const result = await permanentlyDeleteNotes(selectedTrashIds)
      setConfirmation(null)
      if (!result.noteIds.length) {
        setSaveError('所选便签已不在回收站，已重新读取列表')
      } else {
        setSaveError('')
        onStatusChange?.(`已永久删除 ${result.noteIds.length} 张便签`)
      }
      await refresh()
    } catch {
      setSaveError('批量永久删除失败，所选项已保留并已重新读取数据库状态')
      await refresh().catch(() => undefined)
    } finally { setBusy('') }
  }

  async function reloadConflict() {
    const current = draftRef.current
    if (!current) return
    const latest = conflict?.persisted ?? await getNote(current.id)
    if (!latest) {
      setSaveError('该便签已被永久删除')
      return
    }
    coordinator.cancelPending()
    coordinator.setBaseline(latest)
    draftRef.current = latest
    setDraft(latest)
    setConflict(null)
    setExternalConflict(false)
    setSaveError('')
    await refresh()
  }

  async function keepConflictCopy() {
    const current = draftRef.current
    if (!current) return
    setBusy('conflict-copy')
    try {
      const copy = await createConflictCopy(current)
      coordinator.cancelPending()
      setNotes((items) => [copy, ...items.filter((item) => item.id !== copy.id)])
      setSelectedId(copy.id)
      setDraft(copy)
      draftRef.current = copy
      coordinator.setBaseline(copy)
      setConflict(null)
      setExternalConflict(false)
      setSaveError('已将本地内容保存为冲突副本，另一窗口版本保持不变')
    } catch {
      setSaveError('冲突副本创建失败，本地草稿仍保留')
    } finally { setBusy('') }
  }

  async function restoreVersion(revision: NoteRevision) {
    if (!draft) return
    try {
      const saved = await flushCurrent()
      if (!saved) return
      const restored = await applyRevision(saved, revision)
      setNotes((items) => items.map((item) => item.id === restored.id ? restored : item))
      setDraft(restored)
      setSaveError('')
    } catch {
      setSaveError('版本恢复失败，当前内容未改变')
    }
  }

  async function exportSelected(format: ExportFormat) {
    if (!draft) return
    try {
      const persisted = await flushCurrent()
      if (!persisted) return
      const saved = await saveExport(persisted.title || '未命名便签', format, formatNote(persisted, format))
      if (saved) onStatusChange?.(`已导出 ${format.toUpperCase()} 便签`)
    } catch {
      setSaveError('导出失败，请重新选择路径')
      onStatusChange?.('便签导出失败，内容仍保留在编辑器中')
    }
  }

  const visibleNotes = notes.filter((note) =>
    `${note.title}\n${note.content}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  )
  const selectedTrashCount = selectedTrashIds.size
  const confirmationCount = confirmation === 'batch-delete' ? selectedTrashCount : notes.length
  const confirmationTitle = confirmation === 'delete'
    ? `永久删除“${draft?.title || '未命名便签'}”？`
    : confirmation === 'batch-delete'
      ? `永久删除所选 ${confirmationCount} 张便签？`
      : `永久清空 ${confirmationCount} 张便签？`
  const confirmationAction = confirmation === 'delete'
    ? deleteSelectedForever
    : confirmation === 'batch-delete'
      ? deleteSelectedTrashNotes
      : clearTrash

  return (
    <section className="notes-workspace">
      {confirmation && <div className="destructive-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="destructive-confirmation-title"><AlertTriangle size={20} /><div><strong id="destructive-confirmation-title">{confirmationTitle}</strong><p>此操作无法撤销，相关历史版本也会一并删除。</p></div><button className="secondary-button" disabled={Boolean(busy)} onClick={() => setConfirmation(null)}>取消</button><button className="danger-button" disabled={Boolean(busy)} onClick={confirmationAction}>{confirmation === 'empty-trash' ? `确认清空 ${confirmationCount} 张` : `确认永久删除 ${confirmation === 'batch-delete' ? `${confirmationCount} 张` : ''}`}</button></div>}
      <aside className={`note-list-panel ${trashMode ? 'trash-list-panel' : ''}`}>
        <header>
          <div><span className="section-kicker">{trashMode ? '已移除内容' : '随手记录'}</span><h2>{trashMode ? '回收站' : '桌面便签'}</h2></div>
          {trashMode
            ? <div className="trash-header-actions"><button className="secondary-button compact-action" disabled={!notes.length || Boolean(busy)} onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}>{selectionMode ? '退出选择' : '选择'}</button><button className="danger-button compact-action" disabled={!notes.length || Boolean(busy)} onClick={() => setConfirmation('empty-trash')} title={`永久清空 ${notes.length} 张便签`}><Trash2 size={15} /><span>清空</span></button></div>
            : <button className="square-button" disabled={Boolean(busy)} onClick={addNote} title="在主窗口新建便签"><Plus size={18} /></button>}
        </header>
        <label className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索便签" /></label>
        {trashMode && selectionMode && <div className="trash-selection-toolbar" role="group" aria-label="回收站批量选择"><strong>已选择 {selectedTrashCount} 项</strong><div><button className="text-button" disabled={!selectedId || Boolean(busy)} onClick={selectCurrentTrashNote}>选择当前项</button><button className="text-button" disabled={!visibleNotes.length || Boolean(busy)} onClick={() => setSelectedTrashIds(selectFilteredTrashIds(visibleNotes.map((note) => note.id)))}>全选当前筛选结果</button><button className="text-button" disabled={!selectedTrashCount || Boolean(busy)} onClick={() => setSelectedTrashIds(new Set())}>取消全选</button></div><div><button className="primary-button compact-action" disabled={!selectedTrashCount || Boolean(busy)} onClick={restoreSelectedTrashNotes}><ArchiveRestore size={15} />恢复所选</button><button className="danger-button compact-action" disabled={!selectedTrashCount || Boolean(busy)} onClick={() => setConfirmation('batch-delete')}><Trash2 size={15} />永久删除所选</button></div></div>}
        <div className="note-list">
          {visibleNotes.map((note) => (
            <button key={note.id} data-note-id={note.id} disabled={Boolean(busy)} aria-pressed={trashMode && selectionMode ? selectedTrashIds.has(note.id) : undefined} className={`note-list-item ${selectedId === note.id ? 'selected' : ''} ${trashMode && selectionMode ? 'trash-selectable' : ''} ${trashMode && selectionMode && selectedTrashIds.has(note.id) ? 'batch-selected' : ''}`} onClick={() => void selectNote(note.id)}>
              {trashMode && selectionMode && <span className="trash-selection-check" aria-hidden="true">{selectedTrashIds.has(note.id) ? '✓' : ''}</span>}
              <span className="note-swatch" style={{ background: note.style.backgroundColor }} />
              <span><strong>{note.title || '未命名便签'}</strong><small>{note.content.slice(0, 52) || '空便签'}</small></span>
              <time>{new Date(note.updatedAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</time>
            </button>
          ))}
          {!visibleNotes.length && <div className="empty-state"><StickyNote size={24} /><p>{trashMode ? '回收站是空的' : '还没有便签'}</p>{!trashMode && <button onClick={addNote}>创建第一张</button>}</div>}
        </div>
      </aside>

      <main className="note-detail-panel">
        {trashMode && selectionMode ? <div className="detail-empty trash-selection-empty"><StickyNote size={32} /><p>正在选择回收站项目</p><small>普通点击会勾选或取消勾选，不会切换当前详情。</small></div> : draft ? (
          <>
            <header className="note-detail-toolbar">
              <input className="note-title-input" disabled={trashMode || Boolean(busy)} value={draft.title} onChange={(event) => updateDraft({ ...draft, title: event.target.value })} aria-label="便签标题" />
              <span className={`save-indicator ${saving ? 'saving' : ''} ${saveError ? 'failed' : ''}`}>{saveError || (saving ? '保存中…' : '已自动保存')}</span>
              {!trashMode && <button className="icon-button" disabled={Boolean(busy) || Boolean(conflict) || externalConflict} onClick={openDraftWindow}><ExternalLink size={16} />独立窗口</button>}
              {trashMode
                ? <><button className="primary-button" disabled={Boolean(busy)} onClick={restoreSelected}><ArchiveRestore size={16} />恢复</button><button className="danger-button" disabled={Boolean(busy)} onClick={() => setConfirmation('delete')}><Trash2 size={16} />永久删除</button></>
                : <button className="danger-button" disabled={Boolean(busy) || Boolean(conflict) || externalConflict} onClick={trashSelected}><Trash2 size={16} />移至回收站</button>}
            </header>
            {(conflict || externalConflict) && <div className="note-conflict-banner" role="alert"><AlertTriangle size={18} /><div><strong>检测到并发编辑</strong><p>已保存版本与本地草稿均会保留；请选择重新载入或创建副本。</p></div><button className="secondary-button" disabled={Boolean(busy)} onClick={reloadConflict}>重新载入</button><button className="primary-button" disabled={Boolean(busy)} onClick={keepConflictCopy}><Copy size={15} />保留草稿副本</button></div>}
            <textarea
              className="note-editor"
              value={draft.content}
              onChange={(event) => updateDraft({ ...draft, content: event.target.value })}
              placeholder="记录灵感、待办或会议信息…"
              readOnly={trashMode || Boolean(busy)}
              style={{
                fontFamily: draft.style.usesDefaultFont ? 'var(--font-note)' : draft.style.fontFamily,
                fontSize: draft.style.fontSize,
                lineHeight: draft.style.lineHeight,
                color: draft.style.textColor,
                backgroundColor: `${draft.style.backgroundColor}${Math.round((appearance.accessibility.reduceTransparency ? 1 : draft.style.backgroundOpacity) * 255).toString(16).padStart(2, '0')}`,
              }}
            />
          </>
        ) : <div className="detail-empty"><StickyNote size={32} /><p>选择一张便签开始编辑</p></div>}
      </main>

      <aside className="inspector-panel">
        <div className="inspector-heading"><span className="section-kicker">格式与记录</span><h2>便签设置</h2></div>
        {draft && (
          <>
            <section className="inspector-section">
              <h3>外观</h3>
              <label>字体<select disabled={trashMode} value={draft.style.usesDefaultFont ? 'default' : appearance.importedFonts.find((font) => draft.style.fontFamily.includes(font.internalFamily))?.id ?? BUILTIN_FONT_OPTIONS.find((font) => font.family === draft.style.fontFamily)?.id ?? 'custom'} onChange={(event) => {
                const value = event.target.value
                const imported = appearance.importedFonts.find((font) => font.id === value)
                const builtin = BUILTIN_FONT_OPTIONS.find((font) => font.id === value)
                updateDraft({
                  ...draft,
                  style: {
                    ...draft.style,
                    usesDefaultFont: value === 'default',
                    fontFamily: imported
                      ? `'${imported.internalFamily}', 'Microsoft YaHei UI', 'Segoe UI', sans-serif`
                      : builtin?.family ?? draft.style.fontFamily,
                  },
                })
              }}><option value="default">跟随默认便签字体</option>{!draft.style.usesDefaultFont && !appearance.importedFonts.some((font) => draft.style.fontFamily.includes(font.internalFamily)) && !BUILTIN_FONT_OPTIONS.some((font) => font.family === draft.style.fontFamily) && <option value="custom">原有自定义字体</option>}{BUILTIN_FONT_OPTIONS.map((font) => <option value={font.id} key={font.id}>{font.label}</option>)}{appearance.importedFonts.map((font) => <option value={font.id} key={font.id}>{font.displayName}（已导入）</option>)}</select></label>
              <label>字号<div className="range-row"><input disabled={trashMode} type="range" min="12" max="32" value={draft.style.fontSize} onChange={(event) => updateDraft({ ...draft, style: { ...draft.style, fontSize: Number(event.target.value) } })} /><output>{draft.style.fontSize}px</output></div></label>
              <label>行距<div className="range-row"><input disabled={trashMode} type="range" min="130" max="220" value={draft.style.lineHeight * 100} onChange={(event) => updateDraft({ ...draft, style: { ...draft.style, lineHeight: Number(event.target.value) / 100 } })} /><output>{draft.style.lineHeight.toFixed(1)}</output></div></label>
              <div className="color-row"><label>文字颜色<input disabled={trashMode} type="color" value={draft.style.textColor} onChange={(event) => updateDraft({ ...draft, style: { ...draft.style, textColor: event.target.value } })} /></label><label>背景颜色<input disabled={trashMode} type="color" value={draft.style.backgroundColor} onChange={(event) => updateDraft({ ...draft, style: { ...draft.style, backgroundColor: event.target.value } })} /></label></div>
              {contrastRatio(draft.style.textColor, draft.style.backgroundColor) < 4.5 && <p className="contrast-warning" role="status">文字与背景对比度偏低，建议调整其中一种颜色。</p>}
              <label>背景透明度<div className="range-row"><input disabled={trashMode} type="range" min="25" max="100" value={draft.style.backgroundOpacity * 100} onChange={(event) => updateDraft({ ...draft, style: { ...draft.style, backgroundOpacity: Number(event.target.value) / 100 } })} /><output>{Math.round(draft.style.backgroundOpacity * 100)}%</output></div></label>
            </section>
            <section className="inspector-section export-section">
              <h3><FileDown size={15} />导出</h3>
              <div>{(['txt', 'md', 'json', 'html'] as ExportFormat[]).map((format) => <button key={format} onClick={() => exportSelected(format)}>{format.toUpperCase()}</button>)}</div>
            </section>
            {!trashMode && <section className="inspector-section revisions-section"><h3><Clock3 size={15} />历史版本</h3><div>{revisions.length ? revisions.slice(0, 6).map((revision) => <button key={revision.id} onClick={() => restoreVersion(revision)}><span>{new Date(revision.createdAt).toLocaleString('zh-CN')}</span><RotateCcw size={14} /></button>) : <p>编辑后会自动保留最近版本</p>}</div></section>}
          </>
        )}
      </aside>
    </section>
  )
}
