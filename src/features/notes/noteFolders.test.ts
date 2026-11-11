import { beforeEach, describe, expect, it } from 'vitest'
import { mutateNoteFolder, readNoteFolders } from './noteFolders'
import { createNote, getNote, listRevisions, moveNoteToTrash, restoreNote, saveNote } from './noteRepository'

beforeEach(() => localStorage.clear())

describe('single-level note folders', () => {
  it('moves a selection atomically, and keeps manual order independent of text saves', async () => {
    const first = await createNote({ title: '第一张' })
    const second = await createNote({ title: '第二张' })
    await mutateNoteFolder({ action: 'create', id: 'f', name: '文件夹' })
    await expect(mutateNoteFolder({ action: 'moveMany', noteIds: [first.id, 'missing'], folderId: 'f' })).rejects.toThrow('不存在')
    expect((await readNoteFolders()).entries).toEqual({})
    await mutateNoteFolder({ action: 'moveMany', noteIds: [first.id, second.id], folderId: 'f' })
    await mutateNoteFolder({ action: 'reorder', kind: 'note', ids: [first.id, second.id] })
    await saveNote({ ...second, content: '编辑后仍保留手动顺序' })
    expect(await readNoteFolders()).toMatchObject({ entries: { [first.id]: 'f', [second.id]: 'f' }, orders: { note: [first.id, second.id] } })
  })
  it('persists membership independently of concurrent text saves, and deleting a folder preserves active and trashed notes', async () => {
    const note = await createNote({ content: '原文' })
    const trashed = await createNote({ content: '回收站内容' })
    await mutateNoteFolder({ action: 'create', id: 'project', name: ' 项目 ' })
    await mutateNoteFolder({ action: 'move', noteId: note.id, folderId: 'project' })
    await mutateNoteFolder({ action: 'move', noteId: trashed.id, folderId: 'project' })
    await moveNoteToTrash(trashed)
    const saved = await saveNote({ ...note, content: '来自浮窗的新内容' })
    expect((await readNoteFolders()).entries[note.id]).toBe('project')
    await mutateNoteFolder({ action: 'rename', id: 'project', name: '新项目' })
    expect((await readNoteFolders()).folders).toEqual([{ id: 'project', name: '新项目' }])
    const state = await mutateNoteFolder({ action: 'delete', id: 'project' })
    expect(state).toEqual({ folders: [], entries: {} })
    expect(await getNote(note.id)).toEqual(saved)
    expect(await listRevisions(note.id)).toHaveLength(1)
    const deleted = await getNote(trashed.id)
    expect(deleted?.content).toBe('回收站内容')
    await restoreNote(deleted!)
    expect((await readNoteFolders()).entries[trashed.id]).toBeUndefined()
  })

  it('rejects missing folders, invalid names and duplicates without changing stored state', async () => {
    const note = await createNote()
    await mutateNoteFolder({ action: 'create', id: 'one', name: '项目' })
    const before = await readNoteFolders()
    await expect(mutateNoteFolder({ action: 'rename', id: 'missing', name: '重命名' })).rejects.toThrow('删除')
    await expect(mutateNoteFolder({ action: 'create', id: 'two', name: '项目' })).rejects.toThrow('同名')
    await expect(mutateNoteFolder({ action: 'create', id: 'two', name: ' ' })).rejects.toThrow('1–80')
    await expect(mutateNoteFolder({ action: 'move', noteId: note.id, folderId: 'missing' })).rejects.toThrow('删除')
    expect(await readNoteFolders()).toEqual(before)
  })
})
