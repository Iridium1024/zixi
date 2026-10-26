import { AlertTriangle, Copy, Minus, Pencil, Pin, PinOff, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { isTauriRuntime } from '../../lib/platform'
import { BrandMark } from '../../components/BrandMark'
import {
  APPEARANCE_STORAGE_KEY,
  normalizeAppearance,
  readCachedAppearance,
  type AppearanceSettings,
} from '../settings/appearance'
import { loadSetting } from '../settings/settingsRepository'
import { useAppearanceRuntime } from '../settings/useAppearanceRuntime'
import {
  applyMainWindowCloseBehavior,
  normalizeWindowBehavior,
  readCachedWindowBehavior,
  WINDOW_BEHAVIOR_STORAGE_KEY,
  type WindowBehaviorPreferences,
} from '../settings/windowBehavior'
import { useSaveShortcut } from '../../lib/useSaveShortcut'
import { subscribeNoteEvents } from './noteEvents'
import {
  createConflictCopy,
  discardNewNote,
  getNote,
  NoteConflictError,
  saveNote,
} from './noteRepository'
import { openNoteWindow } from './openNoteWindow'
import { NoteSaveCoordinator, type CoordinatedSaveState } from './saveCoordinator'
import type { NoteRecord } from './types'
import {
  NOTE_PREFERENCES_STORAGE_KEY,
  noteContentsEqual,
  normalizeNotePreferences,
  readCachedNotePreferences,
  resolveNoteCloseAction,
  type NotePreferences,
} from './notePreferences'

interface WindowActions {
  close(): Promise<void>
  minimize(): Promise<void>
  onCloseRequested(
    handler: (event: { preventDefault(): void }) => void | Promise<void>,
  ): Promise<() => void>
  setAlwaysOnTop(value: boolean): Promise<void>
  startDragging(): Promise<void>
}

async function getWindowActions(): Promise<WindowActions | null> {
  if (!isTauriRuntime()) return null
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow()
}

interface NoteWindowTitlebarProps {
  title: string
  disabled: boolean
  alwaysOnTop: boolean
  onTitleChange(title: string): void
  onTogglePin(): void
  onMinimize(): void
  onRequestClose(): void
  onStartDragging(): void
}

export function NoteWindowTitlebar({
  title,
  disabled,
  alwaysOnTop,
  onTitleChange,
  onTogglePin,
  onMinimize,
  onRequestClose,
  onStartDragging,
}: NoteWindowTitlebarProps) {
  const [editingTitle, setEditingTitle] = useState(false)
  const titleBeforeEdit = useRef(title)
  const titleInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editingTitle) return
    titleInput.current?.focus()
    titleInput.current?.select()
  }, [editingTitle])

  useEffect(() => {
    if (disabled) setEditingTitle(false)
  }, [disabled])

  function beginTitleEdit() {
    if (disabled) return
    titleBeforeEdit.current = title
    setEditingTitle(true)
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      setEditingTitle(false)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      onTitleChange(titleBeforeEdit.current)
      setEditingTitle(false)
    }
  }

  function handleDragStart(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || editingTitle) return
    onStartDragging()
  }

  return (
    <header className="note-window-titlebar">
      <div
        className="drag-region"
        onMouseDown={handleDragStart}
        onDoubleClick={onMinimize}
        title="拖动窗口；双击最小化"
      >
        <BrandMark />
        {editingTitle ? (
          <input
            ref={titleInput}
            disabled={disabled}
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={handleTitleKeyDown}
            onBlur={() => setEditingTitle(false)}
            aria-label="便签标题"
          />
        ) : (
          <span className="note-window-title" title={title}>{title || '无标题便签'}</span>
        )}
      </div>
      <div className="note-window-controls">
        <button type="button" disabled={disabled} onClick={beginTitleEdit} title="重命名便签" aria-label="重命名便签">
          <Pencil size={14} />
        </button>
        <button type="button" disabled={disabled} onClick={onTogglePin} title={alwaysOnTop ? '取消置顶' : '置顶'}>
          {alwaysOnTop ? <Pin size={15} /> : <PinOff size={15} />}
        </button>
        <button type="button" disabled={disabled} onClick={onMinimize} title="最小化"><Minus size={15} /></button>
        <button type="button" disabled={disabled} onClick={onRequestClose} title="关闭"><X size={15} /></button>
      </div>
    </header>
  )
}

export function NoteWindow({ noteId, createdFromNew = false }: { noteId: string; createdFromNew?: boolean }) {
  const [note, setNote] = useState<NoteRecord | null>(null)
  const [saveState, setSaveState] = useState('读取中…')
  const [appearance, setAppearance] = useState(readCachedAppearance)
  const [preferences, setPreferences] = useState(readCachedNotePreferences)
  const [windowBehavior, setWindowBehavior] = useState(readCachedWindowBehavior)
  const [closing, setClosing] = useState(false)
  const [closePrompt, setClosePrompt] = useState(false)
  const [lastSaved, setLastSaved] = useState<NoteRecord | null>(null)
  const [conflict, setConflict] = useState<NoteConflictError | null>(null)
  const [deleted, setDeleted] = useState(false)
  const noteRef = useRef<NoteRecord | null>(null)
  const persistedRef = useRef<NoteRecord | null>(null)
  const dirtyRef = useRef(false)
  const preferencesRef = useRef(preferences)
  const windowBehaviorRef = useRef(windowBehavior)
  const creationPendingRef = useRef(createdFromNew)
  const closingRef = useRef(false)
  const disposeCloseRef = useRef<(() => void) | undefined>(undefined)
  useAppearanceRuntime(appearance)

  const [coordinator] = useState(() => new NoteSaveCoordinator({
      delay: 650,
      save: (pending) => saveNote(pending),
      onSaved: setLastSaved,
      onStateChange: (state: CoordinatedSaveState, error?: unknown) => {
        if (state === 'scheduled') setSaveState('等待保存…')
        if (state === 'saving') setSaveState('保存中…')
        if (state === 'saved') {
          setSaveState('已保存')
          setConflict(null)
        }
        if (state === 'conflict' && error instanceof NoteConflictError) {
          setConflict(error)
          setSaveState('检测到另一窗口的新版本')
        }
        if (state === 'failed') setSaveState('保存失败，草稿仍保留')
      },
    }))

  useEffect(() => { noteRef.current = note }, [note])
  useEffect(() => { preferencesRef.current = preferences }, [preferences])
  useEffect(() => { windowBehaviorRef.current = windowBehavior }, [windowBehavior])
  useEffect(() => {
    if (!lastSaved) return
    persistedRef.current = lastSaved
    creationPendingRef.current = false
    dirtyRef.current = !noteContentsEqual(noteRef.current, lastSaved)
    setNote((current) => {
      if (!current || current.id !== lastSaved.id) return current
      const next = { ...current, updatedAt: lastSaved.updatedAt }
      noteRef.current = next
      return next
    })
  }, [lastSaved])

  useEffect(() => {
    document.documentElement.classList.add('note-window-root')
    let cancelled = false
    const syncFromStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_STORAGE_KEY) setAppearance(readCachedAppearance())
      if (event.key === NOTE_PREFERENCES_STORAGE_KEY) setPreferences(readCachedNotePreferences())
      if (event.key === WINDOW_BEHAVIOR_STORAGE_KEY) setWindowBehavior(readCachedWindowBehavior())
    }
    window.addEventListener('storage', syncFromStorage)

    let unlisten: (() => void) | undefined
    if (isTauriRuntime()) {
      void loadSetting<unknown>('appearance')
        .then((saved) => { if (saved) setAppearance(normalizeAppearance(saved)) })
        .catch(() => setSaveState('外观设置读取失败，已使用安全默认值'))
      void loadSetting<unknown>('note-preferences')
        .then((saved) => { if (saved) setPreferences(normalizeNotePreferences(saved)) })
        .catch(() => setSaveState('便签关闭设置读取失败，已使用安全默认值'))
      void loadSetting<unknown>('window-behavior')
        .then((saved) => { if (saved) setWindowBehavior(normalizeWindowBehavior(saved)) })
        .catch(() => setSaveState('窗口行为设置读取失败，已使用兼容默认值'))
      void import('@tauri-apps/api/event')
        .then(async ({ listen }) => {
          const disposeAppearance = await listen<AppearanceSettings>('appearance-changed', (event) => {
            setAppearance(normalizeAppearance(event.payload))
          })
          const disposePreferences = await listen<NotePreferences>('note-preferences-changed', (event) => {
            setPreferences(normalizeNotePreferences(event.payload))
          })
          const disposeWindowBehavior = await listen<WindowBehaviorPreferences>('window-behavior-changed', (event) => {
            setWindowBehavior(normalizeWindowBehavior(event.payload))
          })
          return () => { disposeAppearance(); disposePreferences(); disposeWindowBehavior() }
        })
        .then((disposeAll) => {
          if (cancelled) disposeAll()
          else unlisten = disposeAll
        })
    }
    return () => {
      cancelled = true
      document.documentElement.classList.remove('note-window-root')
      window.removeEventListener('storage', syncFromStorage)
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    void getNote(noteId)
      .then(async (value) => {
        if (value) {
          const current = await getWindowActions()
          await current?.setAlwaysOnTop(value.alwaysOnTop)
          noteRef.current = value
          persistedRef.current = value
          dirtyRef.current = false
          coordinator.setBaseline(value)
        }
        setNote(value)
        setSaveState(value ? (createdFromNew ? '新便签尚未确认保存' : '已保存') : '便签不存在')
      })
      .catch(() => setSaveState('便签读取失败，请从主窗口重试'))
  }, [coordinator, createdFromNew, noteId])

  const closeWithoutSaving = useCallback(async () => {
    if (closingRef.current || deleted) return
    closingRef.current = true
    setClosing(true)
    setClosePrompt(false)
    coordinator.cancelPending()
    try {
      if (creationPendingRef.current && persistedRef.current) {
        const removed = await discardNewNote(persistedRef.current)
        if (!removed) throw new Error('新便签已在其它窗口中发生变化')
        creationPendingRef.current = false
      }
      await applyMainWindowCloseBehavior(windowBehaviorRef.current.note.close)
      const current = await getWindowActions()
      disposeCloseRef.current?.()
      coordinator.dispose()
      await current?.close()
    } catch {
      closingRef.current = false
      setClosing(false)
      setSaveState('关闭已取消：无法安全放弃这张新便签')
    }
  }, [coordinator, deleted])

  const saveNow = useCallback(async () => {
    if (closingRef.current || deleted || !noteRef.current) return
    setSaveState('保存中…')
    try {
      await coordinator.flush(noteRef.current)
      creationPendingRef.current = false
      setSaveState('已保存')
    } catch (error) {
      if (error instanceof NoteConflictError) {
        setConflict(error)
        setSaveState('保存失败：检测到并发编辑')
      } else {
        setSaveState('保存失败，草稿仍保留')
      }
    }
  }, [coordinator, deleted])

  useSaveShortcut(saveNow, !closing && !deleted)

  const saveAndClose = useCallback(async () => {
    if (closingRef.current || deleted) return
    closingRef.current = true
    setClosing(true)
    setClosePrompt(false)
    setSaveState('关闭前保存中…')
    try {
      const pending = noteRef.current
      if (pending) await coordinator.flush(pending)
      dirtyRef.current = false
      creationPendingRef.current = false
      await applyMainWindowCloseBehavior(windowBehaviorRef.current.note.close)
      const current = await getWindowActions()
      disposeCloseRef.current?.()
      coordinator.dispose()
      await current?.close()
    } catch (error) {
      closingRef.current = false
      setClosing(false)
      if (error instanceof NoteConflictError) {
        setConflict(error)
        setSaveState('关闭已取消：检测到并发编辑')
      } else {
        setSaveState('关闭已取消：保存失败，请复制内容后重试')
      }
    }
  }, [coordinator, deleted])

  const requestClose = useCallback(async () => {
    if (closingRef.current || deleted) return
    const action = resolveNoteCloseAction(
      preferencesRef.current.closeBehavior,
      dirtyRef.current || creationPendingRef.current,
    )
    if (action === 'ask') {
      setClosePrompt(true)
      return
    }
    if (action === 'save') await saveAndClose()
    else await closeWithoutSaving()
  }, [closeWithoutSaving, deleted, saveAndClose])

  useEffect(() => {
    let disposed = false
    void getWindowActions().then(async (current) => {
      if (!current || disposed) return
      const dispose = await current.onCloseRequested((event) => {
        event.preventDefault()
        void requestClose()
      })
      if (disposed) dispose()
      else disposeCloseRef.current = dispose
    })
    return () => {
      disposed = true
      disposeCloseRef.current?.()
    }
  }, [requestClose])

  useEffect(() => {
    let dispose: (() => void) | undefined
    let cancelled = false
    void subscribeNoteEvents(async (event) => {
      if (event.noteId !== noteId && !event.noteIds?.includes(noteId)) return
      if (closingRef.current && event.action === 'deleted') return
      if (event.action === 'deleted' || event.action === 'trash-cleared') {
        coordinator.cancelPending()
        setDeleted(true)
        setClosing(true)
        setSaveState('便签已永久删除，窗口正在关闭…')
        const current = await getWindowActions()
        disposeCloseRef.current?.()
        window.setTimeout(() => { void current?.close() }, 350)
        return
      }
      if (event.action === 'trashed') {
        coordinator.cancelPending()
        setDeleted(true)
        setSaveState('便签已移至回收站，此窗口为只读')
        return
      }
      if (coordinator.hasPendingSave() || dirtyRef.current) {
        const current = noteRef.current
        if (current) setConflict(new NoteConflictError(current, await getNote(noteId)))
        setSaveState('另一窗口已更新；本地草稿未被覆盖')
        return
      }
      const latest = await getNote(noteId)
      if (latest) {
        noteRef.current = latest
        persistedRef.current = latest
        dirtyRef.current = false
        setNote(latest)
        coordinator.setBaseline(latest)
      }
    }).then((unlisten) => {
      if (cancelled) unlisten()
      else dispose = unlisten
    })
    return () => {
      cancelled = true
      dispose?.()
    }
  }, [coordinator, noteId])

  function updateNote(next: NoteRecord) {
    if (closingRef.current || deleted) return
    noteRef.current = next
    setNote(next)
    dirtyRef.current = !noteContentsEqual(next, persistedRef.current)
    if (preferencesRef.current.closeBehavior === 'save') coordinator.schedule(next)
    else {
      coordinator.cancelPending()
      if (persistedRef.current) coordinator.setBaseline(persistedRef.current)
      setSaveState(dirtyRef.current ? '有未保存的更改' : '已保存')
    }
  }

  useEffect(() => {
    if (!dirtyRef.current || !noteRef.current) return
    if (preferences.closeBehavior === 'save') coordinator.schedule(noteRef.current)
    else {
      coordinator.cancelPending()
      if (persistedRef.current) coordinator.setBaseline(persistedRef.current)
      setSaveState('有未保存的更改')
    }
  }, [coordinator, preferences.closeBehavior])

  const act = useCallback(async (action: 'minimize' | 'startDragging') => {
    const current = await getWindowActions()
    if (!current) return
    await current[action]()
  }, [])

  async function togglePin() {
    const currentNote = noteRef.current
    if (!currentNote || closingRef.current || deleted) return
    const alwaysOnTop = !currentNote.alwaysOnTop
    try {
      const current = await getWindowActions()
      await current?.setAlwaysOnTop(alwaysOnTop)
      updateNote({ ...currentNote, alwaysOnTop })
      setSaveState(alwaysOnTop ? '已置顶，等待保存…' : '已取消置顶，等待保存…')
    } catch {
      setSaveState('置顶状态切换失败，原设置未改变')
    }
  }

  async function reloadSavedVersion() {
    const latest = conflict?.persisted ?? await getNote(noteId)
    if (!latest) {
      setDeleted(true)
      setSaveState('便签已被永久删除')
      return
    }
    coordinator.cancelPending()
    coordinator.setBaseline(latest)
    persistedRef.current = latest
    dirtyRef.current = false
    noteRef.current = latest
    setNote(latest)
    setConflict(null)
    setSaveState('已重新载入另一窗口版本')
  }

  async function keepDraftCopy() {
    const currentNote = noteRef.current
    if (!currentNote) return
    closingRef.current = true
    setClosing(true)
    try {
      const copy = await createConflictCopy(currentNote)
      await openNoteWindow(copy.id, copy.title)
      coordinator.cancelPending()
      const current = await getWindowActions()
      disposeCloseRef.current?.()
      await current?.close()
    } catch {
      closingRef.current = false
      setClosing(false)
      setSaveState('冲突副本创建失败，本地草稿仍保留')
    }
  }

  if (!note) return <main className="note-window-loading">{saveState}</main>

  const effectiveOpacity = appearance.accessibility.reduceTransparency ? 1 : note.style.backgroundOpacity
  const rgba = `${note.style.backgroundColor}${Math.round(effectiveOpacity * 255).toString(16).padStart(2, '0')}`
  return (
    <main className="note-window" data-closing={closing ? 'true' : 'false'} style={{ backgroundColor: rgba, color: note.style.textColor }}>
      <NoteWindowTitlebar
        title={note.title}
        disabled={closing || deleted || closePrompt}
        alwaysOnTop={note.alwaysOnTop}
        onTitleChange={(title) => updateNote({ ...note, title })}
        onTogglePin={() => { void togglePin() }}
        onMinimize={() => { void act('minimize') }}
        onRequestClose={() => { void requestClose() }}
        onStartDragging={() => { void act('startDragging') }}
      />
      {conflict && <div className="floating-conflict" role="alert"><AlertTriangle size={17} /><p>另一窗口已保存新版本。本地草稿没有被覆盖。</p><button disabled={closing} onClick={reloadSavedVersion}>重新载入</button><button disabled={closing} onClick={keepDraftCopy}><Copy size={14} />保留副本</button></div>}
      {closePrompt && <div className="note-close-dialog-backdrop"><div className="note-close-dialog" role="alertdialog" aria-modal="true" aria-labelledby="note-close-dialog-title"><strong id="note-close-dialog-title">保存对此便签的更改？</strong><p>未保存的修改会在关闭窗口后丢失。</p><div><button type="button" className="secondary-button" onClick={() => setClosePrompt(false)}>取消</button><button type="button" className="secondary-button" onClick={() => { void closeWithoutSaving() }}>不保存</button><button type="button" className="primary-button" onClick={() => { void saveAndClose() }}>保存</button></div></div></div>}
      <textarea
        className="floating-note-editor"
        disabled={closing || deleted || closePrompt}
        value={note.content}
        onChange={(event) => updateNote({ ...note, content: event.target.value })}
        placeholder="在这里记录…"
        spellCheck
        style={{
          color: note.style.textColor,
          fontFamily: note.style.usesDefaultFont ? 'var(--font-note)' : note.style.fontFamily,
          fontSize: note.style.fontSize,
          lineHeight: note.style.lineHeight,
        }}
        autoFocus
      />
      <footer className="note-window-footer">
        <span>{saveState}</span><span>{note.content.length} 字符</span>
      </footer>
    </main>
  )
}
