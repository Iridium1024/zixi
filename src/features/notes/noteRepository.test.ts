import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyRevision,
  createNote,
  emptyTrash,
  getNote,
  listNotes,
  listRevisions,
  moveNoteToTrash,
  permanentlyDeleteNote,
  permanentlyDeleteNotes,
  restoreNote,
  restoreNotes,
  saveNote,
} from './noteRepository'
import { DEFAULT_NOTE_STYLE, type NoteRevision } from './types'

describe('note repository browser fallback', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-13T00:00:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('creates an automatic checkpoint only after a real content change and five minutes', async () => {
    let note = await createNote()
    note = await saveNote({ ...note, title: '周会要点', content: '版本 1' })
    expect(await listRevisions(note.id)).toHaveLength(1)

    vi.advanceTimersByTime(4 * 60 * 1000)
    note = await saveNote({ ...note, content: '版本 2' })
    expect(await listRevisions(note.id)).toHaveLength(1)

    vi.advanceTimersByTime(60 * 1000 + 1)
    note = await saveNote({ ...note, content: '版本 3' })
    const revisions = await listRevisions(note.id)
    expect(revisions).toHaveLength(2)
    expect(revisions[0]).toMatchObject({ content: '版本 2', kind: 'auto' })
  })

  it('does not version style, pin, trash, restore or no-op saves', async () => {
    let note = await createNote()
    const originalUpdatedAt = note.updatedAt
    note = await saveNote(note)
    expect(note.updatedAt).toBe(originalUpdatedAt)
    note = await saveNote({ ...note, alwaysOnTop: false, style: { ...note.style, fontSize: 20 } })
    const deleted = await moveNoteToTrash(note)
    await restoreNote(deleted)
    expect(await listRevisions(note.id)).toHaveLength(0)
  })

  it('creates a protection checkpoint before applying a revision', async () => {
    let note = await createNote({ title: '现在', content: '当前重要内容' })
    const old: NoteRevision = {
      id: 'old',
      noteId: note.id,
      title: '以前',
      content: '旧内容',
      kind: 'auto',
      createdAt: note.createdAt,
    }
    note = await applyRevision(note, old)
    expect(note.content).toBe('旧内容')
    expect((await listRevisions(note.id))[0]).toMatchObject({
      content: '当前重要内容',
      kind: 'protection',
    })
  })

  it('keeps only the latest 10 checkpoints per note', async () => {
    let note = await createNote()
    for (let index = 1; index <= 14; index += 1) {
      vi.advanceTimersByTime(5 * 60 * 1000 + 1)
      note = await saveNote({ ...note, content: `版本 ${index}` })
    }

    const revisions = await listRevisions(note.id)
    expect(revisions).toHaveLength(10)
    expect(revisions[0].content).toBe('版本 13')
    expect(revisions.at(-1)?.content).toBe('版本 4')
  })

  it('soft deletes and restores without losing content', async () => {
    const created = await createNote()
    const updated = await saveNote({ ...created, content: '不可丢失' })
    const deleted = await moveNoteToTrash(updated)

    expect(await listNotes()).toHaveLength(0)
    expect(await listNotes(true)).toHaveLength(1)
    await restoreNote(deleted)
    expect((await listNotes())[0].content).toBe('不可丢失')
  })

  it('permanently deletes notes and cascades local revisions', async () => {
    let note = await createNote({ content: '会被清理' })
    note = await saveNote({ ...note, content: '第二版' })
    await moveNoteToTrash(note)
    expect(await listRevisions(note.id)).toHaveLength(1)

    expect(await permanentlyDeleteNote(note.id)).toBe(true)
    expect(await getNote(note.id)).toBeNull()
    expect(await listRevisions(note.id)).toHaveLength(0)
  })

  it('empties only deleted notes and reports the exact count', async () => {
    const active = await createNote({ title: '保留' })
    const first = await createNote({ title: '删除一' })
    const second = await createNote({ title: '删除二' })
    await moveNoteToTrash(first)
    await moveNoteToTrash(second)
    const result = await emptyTrash()

    expect(result.count).toBe(2)
    expect(await getNote(active.id)).not.toBeNull()
    expect(await listNotes(true)).toHaveLength(1)
  })

  it('batch restores and permanently deletes only the requested trashed notes', async () => {
    const active = await createNote({ title: '保留' })
    const first = await moveNoteToTrash(await createNote({ title: '恢复' }))
    let second = await createNote({ title: '永久删除' })
    second = await saveNote({ ...second, content: '需要级联清理' })
    second = await moveNoteToTrash(second)

    const restored = await restoreNotes([first.id, first.id, active.id, 'missing-note'])
    expect(restored.noteIds).toEqual([first.id])
    expect((await getNote(first.id))?.deletedAt).toBeNull()
    expect((await getNote(active.id))?.deletedAt).toBeNull()

    const deleted = await permanentlyDeleteNotes([second.id, second.id, first.id, 'missing-note'])
    expect(deleted.noteIds).toEqual([second.id])
    expect(await getNote(second.id)).toBeNull()
    expect(await listRevisions(second.id)).toEqual([])
    expect((await getNote(first.id))?.deletedAt).toBeNull()
    expect(await permanentlyDeleteNotes([])).toEqual({ noteIds: [] })
  })

  it('migrates legacy browser notes that predate line-height settings', async () => {
    localStorage.setItem('zixi.notes.v1', JSON.stringify([{
      id: 'legacy-note',
      title: '旧便签',
      content: '仍可读取',
      style: {
        fontFamily: DEFAULT_NOTE_STYLE.fontFamily,
        fontSize: 16,
        textColor: '#111111',
        backgroundColor: '#ffffff',
        backgroundOpacity: 1,
      },
      alwaysOnTop: true,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
      deletedAt: null,
    }]))

    expect((await listNotes())[0].style.lineHeight).toBe(DEFAULT_NOTE_STYLE.lineHeight)
  })

  it('rejects a stale edit instead of overwriting another window', async () => {
    const original = await createNote()
    await saveNote({ ...original, content: '窗口 A 已保存' })

    await expect(saveNote({ ...original, content: '窗口 B 的陈旧编辑' }))
      .rejects.toMatchObject({ name: 'NoteConflictError' })
    expect((await getNote(original.id))?.content).toBe('窗口 A 已保存')
  })
})
