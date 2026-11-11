import { useScrollEdgeFade } from '../../components/useScrollEdgeFade'
import { DirectoryHeader } from '../../components/DirectoryHeader'
import { SelectControl, RangeControl } from '../../components/FormControls'
import { Popconfirm } from '../../components/Popconfirm'
import { DIRECTORY_DRAG, readDirectoryDrag, insertionTarget, orderItems, moveBefore } from '../../lib/directoryOrder'
import { ViewStatus, isFailureStatus } from '../../components/ViewStatus'
import {
  ArchiveRestore,
  ListChecks,
  CheckCheck,
  Square,
  AlertTriangle,
  Clipboard,
  Copy,
  Clock3,
  ExternalLink,
  Folder,
  FolderPlus,
  CheckCircle2,
  LoaderCircle,
  PanelRight,
  X,
  FileDown,
  Plus,
  RotateCcw,
  Search,
  StickyNote,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { WorkspaceNavigation, useUnifiedNavigation } from '../../components/WorkspaceNavigation'
import { NoteSearchDialog } from './NoteSearchDialog'
import { NoteFolderDirectory, type NoteFolderDirectoryHandle } from './NoteFolderDirectory'
import { readNoteFolders, mutateNoteFolder, type NoteFolderState, type FolderMutation } from './noteFolders'
import { formatNote, type ExportFormat } from '../export/formatters'
import { saveExport } from '../export/saveExport'
import type { AppearanceSettings } from '../settings/appearance'
import { contrastRatio } from './colorContrast'
import {
  applyRevision,
  createConflictCopy,
  createNote,
  getNote,
  listNotes,
  listRevisions,
  moveNoteToTrash,
  NoteConflictError,
  permanentlyDeleteNotes,
  restoreNote,
  restoreNotes,
  saveNote,
} from './noteRepository'
import { subscribeNoteEvents } from './noteEvents'
import { copyNoteIndex } from './noteIndex'
import { NoteIndexPrompt } from './NoteIndexPrompt'
import { executeIndependentWindowEntry, executeNewNoteEntry } from './noteEntryFlow'
import { openNoteWindow } from './openNoteWindow'
import { applyMainWindowOpenBehavior, type WindowBehaviorPreferences } from '../settings/windowBehavior'
import { NoteSaveCoordinator, type CoordinatedSaveState } from './saveCoordinator'
import { useSaveShortcut } from '../../lib/useSaveShortcut'
import {
  retainExistingTrashSelection,
  selectFilteredTrashIds,
  toggleTrashSelection,
} from './trashSelection'
import type { NoteRecord, NoteRevision } from './types'

interface NotesWorkspaceProps {
  statusMessage?: string
  appearance: AppearanceSettings
  windowBehavior: WindowBehaviorPreferences
  trashMode?: boolean
  onStatusChange?: (status: string) => void
  listOpen?: boolean
  settingsOpen?: boolean
  onSettingsOpenChange?: (open: boolean) => void
  onBeforeLeaveReady?: (handler: (() => Promise<boolean>) | null) => void
}

const BUILTIN_FONT_OPTIONS = [
  { id: 'yahei', family: "'Microsoft YaHei UI', 'Segoe UI', sans-serif", label: '微软雅黑' },
  { id: 'segoe', family: "'Segoe UI', 'Microsoft YaHei UI', sans-serif", label: 'Segoe UI' },
  { id: 'simsun', family: "'SimSun', 'Microsoft YaHei UI', serif", label: '宋体' },
  { id: 'kaiti', family: "'KaiTi', 'Microsoft YaHei UI', serif", label: '楷体' },
  { id: 'mono', family: "'Cascadia Mono', Consolas, 'Microsoft YaHei UI', monospace", label: '等宽字体' },
]

export function NotesWorkspace({ statusMessage, appearance, windowBehavior, trashMode = false, onStatusChange, listOpen = true, settingsOpen: controlledSettingsOpen, onSettingsOpenChange, onBeforeLeaveReady }: NotesWorkspaceProps) {
  const unifiedNavigation = useUnifiedNavigation()
  const [folderState, setFolderState] = useState<NoteFolderState>({ folders: [], entries: {} })
  const [folderFilter, setFolderFilter] = useState('all')
  const [folderError, setFolderError] = useState('')
  const [notes, setNotes] = useState<NoteRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<NoteRecord | null>(null)
  const [revisions, setRevisions] = useState<NoteRevision[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [trashQuery, setTrashQuery] = useState('')
  const closeSearch = useCallback(() => setSearchOpen(false), [])
  const [localSettingsOpen, setLocalSettingsOpen] = useState(false)
  const settingsOpen = controlledSettingsOpen ?? localSettingsOpen
  const settingsToggle = useRef<HTMLButtonElement>(null)
  const noteEditor = useRef<HTMLTextAreaElement>(null)
  useScrollEdgeFade(noteEditor, draft)
  const folderDirectory = useRef<NoteFolderDirectoryHandle>(null)
  const changeSettingsOpen = useCallback((open: boolean) => {
    if (controlledSettingsOpen === undefined) setLocalSettingsOpen(open)
    onSettingsOpenChange?.(open)
    if (!open) settingsToggle.current?.focus()
  }, [controlledSettingsOpen, onSettingsOpenChange])
  useEffect(() => {
    if (!settingsOpen) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return
      if ((event.target as Element)?.closest?.('select')) return
      changeSettingsOpen(false)
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [settingsOpen, changeSettingsOpen])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [conflict, setConflict] = useState<NoteConflictError | null>(null)
  const [externalConflict, setExternalConflict] = useState(false)
  const [busy, setBusy] = useState('')
  const [indexPrompt, setIndexPrompt] = useState<{ noteId: string; newNote: boolean } | null>(null)
  const [indexStatus, setIndexStatus] = useState('')
  const [leaving, setLeaving] = useState(false)
  const leavingRef = useRef(false)
  const [noteMultiSelection, setNoteMultiSelection] = useState(false)
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(() => new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedTrashIds, setSelectedTrashIds] = useState<Set<string>>(() => new Set())
  const draftRef = useRef<NoteRecord | null>(null)
  const [pendingCreatedIds] = useState(() => new Set<string>())

  const refreshFolders = useCallback(async () => {
    try { setFolderState(await readNoteFolders()); setFolderError('') }
    catch { setFolderError('文件夹读取失败，请重试') }
  }, [])
  useEffect(() => { void refreshFolders() }, [refreshFolders])
  async function changeFolder(input: FolderMutation) {
    if (busy || leavingRef.current) return false
    setBusy('folder')
    try { setFolderState(await mutateNoteFolder(input)); setFolderError(''); return true }
    catch (error) { await refreshFolders(); setFolderError(error instanceof Error ? error.message : '文件夹操作失败'); return false }
    finally { setBusy('') }
  }

  useEffect(() => { draftRef.current = draft }, [draft])

  const [coordinator] = useState(() => new NoteSaveCoordinator({
      delay: 700,
      save: (pending) => saveNote(pending),
      onSaved: (saved) => {
        pendingCreatedIds.delete(saved.id)
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
    setSelectedNoteIds((current) => retainExistingTrashSelection(current, filtered.map((note) => note.id)))
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
      if (event.action === 'folders-changed') { await refreshFolders(); return }
      const current = draftRef.current
      const affectsCurrent = current
        && (event.noteId === current.id || event.noteIds?.includes(current.id))
      if (affectsCurrent) {
        setIndexPrompt(null)
        setIndexStatus('')
        setBusy((currentBusy) => currentBusy === 'copy-index-choice' ? '' : currentBusy)
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
  }, [coordinator, refresh, refreshFolders])

  useEffect(() => () => {
    if (coordinator.hasPendingSave()) void coordinator.flush().catch(() => undefined)
  }, [coordinator])

  function updateDraft(next: NoteRecord) {
    if (leavingRef.current) return
    setIndexStatus('')
    setDraft(next)
    draftRef.current = next
    if (!trashMode) coordinator.schedule(next)
  }

  const flushCurrent = useCallback(async () => {
    if (!draftRef.current || trashMode) return draftRef.current
    return coordinator.flush(draftRef.current)
  }, [coordinator, trashMode])

  const prepareToLeave = useCallback(async () => {
    if (leavingRef.current) return false
    if (busy || conflict || externalConflict) {
      setSaveError('请先完成当前操作或处理便签冲突，再切换页面')
      return false
    }
    leavingRef.current = true
    setLeaving(true)
    try {
      await flushCurrent()
      return true
    } catch {
      leavingRef.current = false
      setLeaving(false)
      setSaveError('当前草稿尚未安全保存，请处理后再切换页面')
      return false
    }
  }, [busy, conflict, externalConflict, flushCurrent])

  useEffect(() => {
    onBeforeLeaveReady?.(prepareToLeave)
    return () => onBeforeLeaveReady?.(null)
  }, [onBeforeLeaveReady, prepareToLeave])

  useSaveShortcut(useCallback(async () => {
    if (!draftRef.current || trashMode) return
    try {
      const saved = await flushCurrent()
      if (saved) pendingCreatedIds.delete(saved.id)
      onStatusChange?.('便签已保存')
    } catch {
      setSaveError('保存失败，草稿仍保留在编辑器中')
      onStatusChange?.('便签保存失败，请处理后重试')
    }
  }, [flushCurrent, onStatusChange, pendingCreatedIds, trashMode]), !trashMode)

  async function selectNote(id: string, additive = false) {
    if (additive) {
      if (trashMode) { setSelectionMode(true); setSelectedTrashIds((current) => toggleTrashSelection(selectionMode ? current : new Set(selectedId ? [selectedId] : []), id)) }
      else { setNoteMultiSelection(true); setSelectedNoteIds((current) => toggleTrashSelection(noteMultiSelection ? current : new Set(selectedId ? [selectedId] : []), id)) }
      return
    }
    if (!trashMode) { setNoteMultiSelection(false); setSelectedNoteIds(new Set([id])) }
    if (trashMode && selectionMode) {
      setSelectedTrashIds((current) => toggleTrashSelection(current, id))
      return
    }
    if (id === selectedId || leavingRef.current || busy) return
    if (conflict || externalConflict) { setSaveError('请先处理便签冲突，再切换便签'); return }
    leavingRef.current = true
    setLeaving(true)
    try {
      await flushCurrent()
      setIndexStatus('')
      setSelectedId(id)
      setSelectedNoteIds(new Set([id]))
    } catch {
      setSaveError('当前草稿尚未安全保存，请先处理后再切换')
    } finally {
      leavingRef.current = false
      setLeaving(false)
    }
  }

  async function addNote() {
    if (leavingRef.current || busy) return
    if (conflict || externalConflict) { setSaveError('请先处理便签冲突，再新建便签'); return }
    leavingRef.current = true
    setLeaving(true)
    try {
      await flushCurrent()
    } catch {
      setSaveError('当前草稿尚未安全保存，请先处理后再新建便签')
      leavingRef.current = false
      setLeaving(false)
      return
    }
    try {
      const note = await executeNewNoteEntry('notes-page', {
        create: async () => {
          const created = await createNote()
          if (folderFilter !== 'all' && folderFilter && folderState.folders.some((folder) => folder.id === folderFilter)) {
            try { setFolderState(await mutateNoteFolder({ action: 'move', noteId: created.id, folderId: folderFilter })) }
            catch { setFolderError('便签已创建在未分类中；移动文件夹失败'); setFolderFilter('all') }
          }
          return created
        },
        open: (value) => openNoteWindow(value.id, value.title, true),
        afterOpen: () => applyMainWindowOpenBehavior(windowBehavior.note.open),
      })
      setNotes((items) => [note, ...items])
      setSelectedId(note.id)
      setNoteMultiSelection(false)
      setSelectedNoteIds(new Set([note.id]))
      setDraft(note)
      draftRef.current = note
      coordinator.setBaseline(note)
      pendingCreatedIds.add(note.id)
      setSaveError('')
      onStatusChange?.(`${notes.length + 1} 张便签`)
    } catch {
      setSaveError('新建失败，请检查本地数据库')
      onStatusChange?.('无法新建便签，本地数据库不可用')
    } finally {
      leavingRef.current = false
      setLeaving(false)
    }
  }

  async function openDraftWindow() {
    if (!draft) return
    const createdFromNew = pendingCreatedIds.has(draft.id)
    try {
      await executeIndependentWindowEntry(async () => {
        const saved = await flushCurrent()
        if (!saved) throw new Error('没有可打开的便签')
        return saved
      }, {
        open: (saved) => openNoteWindow(saved.id, saved.title, createdFromNew),
        afterOpen: () => applyMainWindowOpenBehavior(windowBehavior.note.open),
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
      const ids = noteMultiSelection ? [...selectedNoteIds] : [saved.id]
      for (const id of ids) { const latest = await getNote(id); if (latest && !latest.deletedAt) await moveNoteToTrash(latest) }
      await refresh()
      return true
    } catch {
      setSaveError('移至回收站失败，请重试')
      onStatusChange?.('部分便签未能移入回收站，请检查列表后重试')
      await refresh().catch(() => undefined)
      return false
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

  function exitSelectionMode() {
    setSelectionMode(false)
    setSelectedTrashIds(new Set())
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

  async function copyIndex(saveChanges: boolean, targetId: string) {
    const current = draftRef.current
    if (!current || current.id !== targetId || conflict || externalConflict) {
      setIndexPrompt(null)
      setBusy('')
      setIndexStatus('便签已变化，请确认后重试')
      return
    }
    setIndexPrompt(null)
    setBusy('copy-index')
    let savingDraft = saveChanges
    try {
      if (saveChanges) {
        const saved = await coordinator.flush(current)
        pendingCreatedIds.delete(saved.id)
      }
      savingDraft = false
      await copyNoteIndex(targetId)
      setIndexStatus('副本路径已复制')
      onStatusChange?.('便签文本副本路径已复制到剪贴板')
    } catch (error) {
      setIndexStatus(savingDraft ? '保存失败，未复制路径' : error instanceof Error ? error.message : '复制路径失败')
    } finally {
      setBusy('')
    }
  }

  function requestCopyIndex() {
    const current = draftRef.current
    if (!current || busy || leaving || conflict || externalConflict) return
    setIndexStatus('')
    const newNote = pendingCreatedIds.has(current.id)
    if (coordinator.hasPendingSave() || newNote) {
      setBusy('copy-index-choice')
      setIndexPrompt({ noteId: current.id, newNote })
    } else {
      void copyIndex(false, current.id)
    }
  }

  const displayedSaveError = saveError || (statusMessage && isFailureStatus(statusMessage) ? statusMessage : '')
  const visibleNotes = trashMode ? notes.filter((note) => `${note.title}\n${note.content}`.toLocaleLowerCase().includes(trashQuery.toLocaleLowerCase())) : notes
  const currentFolderName = draft ? folderState.folders.find((folder) => folder.id === folderState.entries[draft.id])?.name ?? '未分类' : '未分类'
  const selectedTrashCount = selectedTrashIds.size
  const deletionIds = trashMode ? (selectionMode ? [...selectedTrashIds] : selectedId ? [selectedId] : []) : (noteMultiSelection ? [...selectedNoteIds] : selectedId ? [selectedId] : [])
  async function deleteDirectorySelection() {
    if (trashMode) {
      if (!deletionIds.length) return false
      setBusy('batch-delete')
      try { await permanentlyDeleteNotes(deletionIds); await refresh(); setSaveError(''); return true }
      catch { setSaveError('永久删除失败，已保留所选项，请重试'); await refresh().catch(() => undefined); return false }
      finally { setBusy('') }
    }
    return await trashSelected() ?? false
  }
  function deleteControl() {
    return <Popconfirm title={trashMode ? '永久删除便签确认' : '删除便签确认'} description={trashMode ? `永久删除所选 ${deletionIds.length} 张便签？此操作无法撤销，相关历史版本也会一并删除。` : `将所选 ${deletionIds.length} 张便签移入回收站？之后可以恢复。`} confirmLabel={trashMode ? `确认永久删除 ${deletionIds.length} 张` : '确认移至回收站'} disabled={!deletionIds.length || Boolean(busy) || leaving || Boolean(conflict) || externalConflict} onConfirm={deleteDirectorySelection} trigger={<button className="ghost-icon" aria-label={trashMode ? '永久删除' : '移至回收站'} title={trashMode ? '永久删除所选便签' : '移至回收站'}><Trash2 size={16} /></button>} />
  }
  async function dropTrash(data: DataTransfer, target: string, after: boolean) {
    const item = readDirectoryDrag(data)
    if (item?.kind === 'trash' && !busy) await changeFolder({ action: 'reorder', kind: 'trash', ids: moveBefore(orderItems(notes, folderState.orders?.trash).map((note) => note.id), item.ids, insertionTarget(orderItems(notes, folderState.orders?.trash).map((note) => note.id), item.ids, target, after)) })
  }

  return (
    <section className={`notes-workspace ${listOpen && !unifiedNavigation ? '' : 'list-closed'} ${settingsOpen ? '' : 'settings-closed'}`}>

      {searchOpen && <NoteSearchDialog notes={notes} folders={folderState} disabled={Boolean(busy) || leaving || Boolean(conflict) || externalConflict} initialQuery={trashMode ? trashQuery : ''} onApplyFilter={trashMode ? (value) => { setTrashQuery(value); closeSearch() } : undefined} onClose={closeSearch} onSelect={(id) => { void selectNote(id); setFolderFilter('all'); closeSearch() }} />}
      <WorkspaceNavigation><aside id="note-list-panel" hidden={!listOpen} className={`note-list-panel ${trashMode ? 'trash-list-panel' : ''} ${selectionMode ? 'selecting' : ''}`}>
        <DirectoryHeader title={trashMode ? '回收站' : '桌面便签'}>
          <button className="ghost-icon" disabled={Boolean(busy) || leaving} onClick={() => setSearchOpen(true)} aria-label={trashMode ? '搜索回收站' : '搜索便签'} title={trashMode ? (trashQuery ? `搜索回收站：${trashQuery}` : '搜索回收站') : '搜索便签'}><Search size={16} /></button>
          {trashMode ? <>
            {trashQuery && <button className="ghost-icon" aria-label="清除回收站筛选" title="清除回收站筛选" onClick={() => setTrashQuery('')}><X size={15} /></button>}
            <button className="ghost-icon" aria-pressed={selectionMode} aria-label={selectionMode ? '退出选择' : '选择'} title={selectionMode ? `退出选择（已选 ${selectedTrashCount} 项）` : '选择回收站项目'} disabled={!notes.length || Boolean(busy)} onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}><ListChecks size={16} /></button>
            {selectionMode && <><button className="ghost-icon" title="全选当前筛选结果" aria-label="全选当前筛选结果" disabled={!visibleNotes.length || Boolean(busy)} onClick={() => setSelectedTrashIds(selectFilteredTrashIds(visibleNotes.map((note) => note.id)))}><CheckCheck size={16} /></button><button className="ghost-icon" title="取消全选" aria-label="取消全选" disabled={!selectedTrashCount || Boolean(busy)} onClick={() => setSelectedTrashIds(new Set())}><Square size={16} /></button></>}
            <button className="ghost-icon" aria-label={selectionMode ? '恢复所选' : '恢复便签'} title={selectionMode ? `恢复所选 ${selectedTrashCount} 项` : '恢复当前便签'} disabled={Boolean(busy) || (selectionMode ? !selectedTrashCount : !draft)} onClick={selectionMode ? restoreSelectedTrashNotes : restoreSelected}><ArchiveRestore size={16} /></button>
          </> : <><button className="ghost-icon" disabled={Boolean(busy) || leaving} onClick={() => folderDirectory.current?.create()} aria-label="新建文件夹" title="新建文件夹"><FolderPlus size={16} /></button><button className="ghost-icon" disabled={Boolean(busy) || leaving} onClick={addNote} aria-label="新建便签" title="在主窗口新建便签"><Plus size={18} /></button></>}
          {deleteControl()}
        </DirectoryHeader>
        {!trashMode && <>
          {folderError && <div className="folder-error" role="alert">{folderError}<button className="text-button" onClick={() => void refreshFolders()}>重试</button></div>}
          <NoteFolderDirectory ref={folderDirectory} state={folderState} notes={visibleNotes} selectedId={selectedId} selectedIds={noteMultiSelection ? selectedNoteIds : new Set(selectedId ? [selectedId] : [])} disabled={Boolean(busy) || leaving} query="" filter={folderState.folders.some((folder) => folder.id === folderFilter) || folderFilter === '' ? folderFilter : 'all'} onFilter={setFolderFilter} onSelect={(id, additive) => void selectNote(id, additive)} onMutate={changeFolder} />
        </>}
        {trashMode && <div className="note-list">
          {orderItems(visibleNotes, folderState.orders?.trash).map((note) => (
            <button key={note.id} data-note-id={note.id} disabled={Boolean(busy) || leaving} aria-pressed={trashMode && selectionMode ? selectedTrashIds.has(note.id) : undefined} className={`note-list-item ${(!selectionMode && selectedId === note.id) ? 'selected' : ''} ${trashMode && selectionMode ? 'trash-selectable' : ''} ${trashMode && selectionMode && selectedTrashIds.has(note.id) ? 'batch-selected' : ''}`} onClick={(event) => void selectNote(note.id, event.ctrlKey || event.metaKey)} draggable={!busy && !leaving} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData(DIRECTORY_DRAG, JSON.stringify({ kind: 'trash', ids: selectedTrashIds.has(note.id) ? [...selectedTrashIds] : [note.id] })) }} onDragOver={(event) => { if (!busy && event.dataTransfer.types.includes(DIRECTORY_DRAG)) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); void dropTrash(event.dataTransfer, note.id, event.clientY > rect.top + rect.height / 2) }}>
              {trashMode && selectionMode && <span className="trash-selection-check" aria-hidden="true">{selectedTrashIds.has(note.id) ? '✓' : ''}</span>}
              <span data-tooltip-overflow title={note.title || '未命名便签'}><strong>{note.title || '未命名便签'}</strong></span>
            </button>
          ))}
          {!visibleNotes.length && <div className="empty-state"><StickyNote size={24} /><p>{notes.length ? '没有匹配的搜索结果' : trashMode ? '回收站是空的' : '还没有便签'}</p>{!trashMode && !notes.length && <button onClick={addNote}>创建第一张</button>}</div>}
        </div>}
      </aside></WorkspaceNavigation>

      <main className="note-detail-panel">
        {indexPrompt && <NoteIndexPrompt newNote={indexPrompt.newNote} onCancel={() => { setIndexPrompt(null); setBusy('') }} onCopySaved={() => { void copyIndex(false, indexPrompt.noteId) }} onSaveAndCopy={() => { void copyIndex(true, indexPrompt.noteId) }} />}
        {trashMode && selectionMode ? <div className="detail-empty trash-selection-empty"><StickyNote size={32} /><p>正在选择回收站项目</p><small>普通点击会勾选或取消勾选，不会切换当前详情。</small><ViewStatus message={displayedSaveError} /></div> : draft ? (
          <section className="note-paper" aria-label="便签内容" style={{ '--note-paper-background': `${draft.style.backgroundColor}${Math.round((appearance.accessibility.reduceTransparency ? 1 : draft.style.backgroundOpacity) * 255).toString(16).padStart(2, '0')}`, '--note-paper-ink': draft.style.textColor, color: draft.style.textColor } as CSSProperties}>
            <header className="note-detail-toolbar">
              <span className="note-folder-hint" tabIndex={0} role="img" aria-label={`所属文件夹：${currentFolderName}`} data-tooltip={currentFolderName}><Folder size={16} /></span>
              <input className="note-title-input" disabled={trashMode || Boolean(busy) || leaving} value={draft.title} onChange={(event) => updateDraft({ ...draft, title: event.target.value })} aria-label="便签标题" />
              <span className={`save-indicator ${saving ? 'saving' : ''} ${displayedSaveError ? 'failed' : ''}`} role="status" title={displayedSaveError || (saving ? '保存中…' : '已自动保存')} aria-label={displayedSaveError || (saving ? '保存中…' : '已自动保存')}>{displayedSaveError ? <AlertTriangle size={15} /> : saving ? <LoaderCircle size={15} className="reader-spinner" /> : <CheckCircle2 size={15} />}<span className="save-state-label">{displayedSaveError || (saving ? '保存中…' : '已自动保存')}</span></span>
              {!trashMode && <span className="note-index-feedback" role="status" aria-live="polite">{indexStatus}</span>}
              {!trashMode && <button className="ghost-icon" disabled={Boolean(busy) || leaving || Boolean(conflict) || externalConflict} onClick={requestCopyIndex} title="复制已保存便签的文本副本路径；副本不会自动更新或写回便签" aria-label="复制便签副本路径"><Clipboard size={16} /></button>}
              {!trashMode && <button className="ghost-icon" disabled={Boolean(busy) || Boolean(conflict) || externalConflict} onClick={openDraftWindow} aria-label="独立窗口" title="在独立窗口打开"><ExternalLink size={16} /></button>}
              {trashMode && <button className="ghost-icon" disabled={Boolean(busy)} onClick={restoreSelected} aria-label="恢复便签" title="恢复"><ArchiveRestore size={16} /></button>}
              <span className="note-action-separator" aria-hidden="true" />
              <button ref={settingsToggle} className="ghost-icon" aria-label={settingsOpen ? '隐藏便签设置' : '显示便签设置'} title={settingsOpen ? '隐藏便签设置' : '显示便签设置'} aria-expanded={settingsOpen} aria-controls="note-settings-panel" onClick={() => changeSettingsOpen(!settingsOpen)}><PanelRight size={16} /></button>
            </header>
            {(conflict || externalConflict) && <div className="note-conflict-banner" role="alert"><AlertTriangle size={18} /><div><strong>检测到并发编辑</strong><p>已保存版本与本地草稿均会保留；请选择重新载入或创建副本。</p></div><button className="secondary-button" disabled={Boolean(busy)} onClick={reloadConflict}>重新载入</button><button className="primary-button" disabled={Boolean(busy)} onClick={keepConflictCopy}><Copy size={15} />保留草稿副本</button></div>}
            <div className="note-body-viewport"><textarea
              ref={noteEditor}
              className="note-editor edge-fade-scroll"
              value={draft.content}
              onChange={(event) => updateDraft({ ...draft, content: event.target.value })}
              placeholder="记录灵感、待办或会议信息…"
              readOnly={trashMode || Boolean(busy) || leaving}
              style={{
                fontFamily: draft.style.usesDefaultFont ? 'var(--font-note)' : draft.style.fontFamily,
                fontSize: draft.style.fontSize,
                lineHeight: draft.style.lineHeight,
                color: draft.style.textColor,
              }}
            /><div className="toolbar-edge-fade" aria-hidden="true" /></div>
          </section>
        ) : <div className="detail-empty"><StickyNote size={32} /><p>选择一张便签开始编辑</p><ViewStatus message={displayedSaveError} /></div>}
      </main>

      <aside id="note-settings-panel" className="inspector-panel" aria-hidden={!settingsOpen} inert={!settingsOpen}>
        <div className="inspector-content"><div className="inspector-heading"><h2>便签设置</h2><button className="ghost-icon" onClick={() => changeSettingsOpen(false)} aria-label="关闭便签设置" title="关闭便签设置"><X size={16} /></button></div>
        {draft && (
          <>
            <section className="inspector-section">
              <h3>外观</h3>
              <label>字体<SelectControl aria-label="字体" disabled={trashMode} value={draft.style.usesDefaultFont ? 'default' : appearance.importedFonts.find((font) => draft.style.fontFamily.includes(font.internalFamily))?.id ?? BUILTIN_FONT_OPTIONS.find((font) => font.family === draft.style.fontFamily)?.id ?? 'custom'} onChange={(event) => {
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
              }}><option value="default">跟随默认便签字体</option>{!draft.style.usesDefaultFont && !appearance.importedFonts.some((font) => draft.style.fontFamily.includes(font.internalFamily)) && !BUILTIN_FONT_OPTIONS.some((font) => font.family === draft.style.fontFamily) && <option value="custom">原有自定义字体</option>}{BUILTIN_FONT_OPTIONS.map((font) => <option value={font.id} key={font.id}>{font.label}</option>)}{appearance.importedFonts.map((font) => <option value={font.id} key={font.id}>{font.displayName}（已导入）</option>)}</SelectControl></label>
              <label>字号<div className="range-row"><RangeControl aria-label="字号" disabled={trashMode}  min="12" max="32" value={draft.style.fontSize} onChange={(event) => updateDraft({ ...draft, style: { ...draft.style, fontSize: Number(event.target.value) } })} /><output>{draft.style.fontSize}px</output></div></label>
              <label>行距<div className="range-row"><RangeControl aria-label="行距" disabled={trashMode}  min="130" max="220" value={draft.style.lineHeight * 100} onChange={(event) => updateDraft({ ...draft, style: { ...draft.style, lineHeight: Number(event.target.value) / 100 } })} /><output>{draft.style.lineHeight.toFixed(1)}</output></div></label>
              <div className="color-row"><label>文字颜色<input disabled={trashMode} type="color" value={draft.style.textColor} onChange={(event) => updateDraft({ ...draft, style: { ...draft.style, textColor: event.target.value } })} /></label><label>背景颜色<input disabled={trashMode} type="color" value={draft.style.backgroundColor} onChange={(event) => updateDraft({ ...draft, style: { ...draft.style, backgroundColor: event.target.value } })} /></label></div>
              {contrastRatio(draft.style.textColor, draft.style.backgroundColor) < 4.5 && <p className="contrast-warning" role="status">文字与背景对比度偏低，建议调整其中一种颜色。</p>}
              <label>背景透明度<div className="range-row"><RangeControl aria-label="背景透明度" disabled={trashMode}  min="25" max="100" value={draft.style.backgroundOpacity * 100} onChange={(event) => updateDraft({ ...draft, style: { ...draft.style, backgroundOpacity: Number(event.target.value) / 100 } })} /><output>{Math.round(draft.style.backgroundOpacity * 100)}%</output></div></label>
            </section>
            <section className="inspector-section export-section">
              <h3><FileDown size={15} />导出</h3>
              <div>{(['txt', 'md', 'json', 'html'] as ExportFormat[]).map((format) => <button key={format} onClick={() => exportSelected(format)}>{format.toUpperCase()}</button>)}</div>
            </section>
            {!trashMode && <section className="inspector-section revisions-section"><h3><Clock3 size={15} />历史版本</h3><div>{revisions.length ? revisions.slice(0, 6).map((revision) => <button key={revision.id} onClick={() => restoreVersion(revision)}><span>{new Date(revision.createdAt).toLocaleString('zh-CN')}</span><RotateCcw size={14} /></button>) : <p>编辑后会自动保留最近版本</p>}</div></section>}
          </>
        )}
        </div>
      </aside>
    </section>
  )
}
