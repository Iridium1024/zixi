import { AlertTriangle, Copy, Minus, Pin, PinOff, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
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
import { subscribeNoteEvents } from './noteEvents'
import {
  createConflictCopy,
  getNote,
  NoteConflictError,
  saveNote,
} from './noteRepository'
import { openNoteWindow } from './openNoteWindow'
import { NoteSaveCoordinator, type CoordinatedSaveState } from './saveCoordinator'
import type { NoteRecord } from './types'

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

export function NoteWindow({ noteId }: { noteId: string }) {
  const [note, setNote] = useState<NoteRecord | null>(null)
  const [saveState, setSaveState] = useState('读取中…')
  const [appearance, setAppearance] = useState(readCachedAppearance)
  const [closing, setClosing] = useState(false)
  const [conflict, setConflict] = useState<NoteConflictError | null>(null)
  const [deleted, setDeleted] = useState(false)
  const noteRef = useRef<NoteRecord | null>(null)
  const closingRef = useRef(false)
  const disposeCloseRef = useRef<(() => void) | undefined>(undefined)
  useAppearanceRuntime(appearance)

  const [coordinator] = useState(() => new NoteSaveCoordinator({
      delay: 650,
      save: (pending) => saveNote(pending),
      onSaved: (saved) => {
        setNote((current) => {
          if (!current || current.id !== saved.id) return current
          return { ...current, updatedAt: saved.updatedAt }
        })
      },
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

  useEffect(() => {
    document.documentElement.classList.add('note-window-root')
    let cancelled = false
    const syncFromStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_STORAGE_KEY) setAppearance(readCachedAppearance())
    }
    window.addEventListener('storage', syncFromStorage)

    let unlisten: (() => void) | undefined
    if (isTauriRuntime()) {
      void loadSetting<unknown>('appearance')
        .then((saved) => { if (saved) setAppearance(normalizeAppearance(saved)) })
        .catch(() => setSaveState('外观设置读取失败，已使用安全默认值'))
      void import('@tauri-apps/api/event')
        .then(({ listen }) => listen<AppearanceSettings>('appearance-changed', (event) => {
          setAppearance(normalizeAppearance(event.payload))
        }))
        .then((dispose) => {
          if (cancelled) dispose()
          else unlisten = dispose
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
          coordinator.setBaseline(value)
        }
        setNote(value)
        setSaveState(value ? '已保存' : '便签不存在')
      })
      .catch(() => setSaveState('便签读取失败，请从主窗口重试'))
  }, [coordinator, noteId])

  const requestClose = useCallback(async () => {
    if (closingRef.current || deleted) return
    closingRef.current = true
    setClosing(true)
    setSaveState('关闭前保存中…')
    try {
      const pending = noteRef.current
      if (pending) await coordinator.flush(pending)
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
      if (coordinator.hasPendingSave()) {
        const current = noteRef.current
        if (current) setConflict(new NoteConflictError(current, await getNote(noteId)))
        setSaveState('另一窗口已更新；本地草稿未被覆盖')
        return
      }
      const latest = await getNote(noteId)
      if (latest) {
        noteRef.current = latest
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
    coordinator.schedule(next)
  }

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
      <header className="note-window-titlebar" onDoubleClick={() => act('minimize')}>
        <div className="drag-region" onMouseDown={() => act('startDragging')} title="拖动窗口">
          <BrandMark />
          <input
            disabled={closing || deleted}
            value={note.title}
            onChange={(event) => updateNote({ ...note, title: event.target.value })}
            onMouseDown={(event) => event.stopPropagation()}
            aria-label="便签标题"
          />
        </div>
        <div>
          <button disabled={closing || deleted} onClick={togglePin} title={note.alwaysOnTop ? '取消置顶' : '置顶'}>
            {note.alwaysOnTop ? <Pin size={15} /> : <PinOff size={15} />}
          </button>
          <button disabled={closing} onClick={() => act('minimize')} title="最小化"><Minus size={15} /></button>
          <button disabled={closing || deleted} onClick={requestClose} title="保存并关闭"><X size={15} /></button>
        </div>
      </header>
      {conflict && <div className="floating-conflict" role="alert"><AlertTriangle size={17} /><p>另一窗口已保存新版本。本地草稿没有被覆盖。</p><button disabled={closing} onClick={reloadSavedVersion}>重新载入</button><button disabled={closing} onClick={keepDraftCopy}><Copy size={14} />保留副本</button></div>}
      <textarea
        className="floating-note-editor"
        disabled={closing || deleted}
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
