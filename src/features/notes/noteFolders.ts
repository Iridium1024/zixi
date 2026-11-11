import { isTauriRuntime, makeId } from '../../lib/platform'
import { getDatabase, getNote } from './noteRepository'
import { publishNoteEvent } from './noteEvents'

export interface NoteFolder { id: string; name: string }
export interface NoteFolderState { folders: NoteFolder[]; entries: Record<string, string>; orders?: Record<string, string[]> }
export type FolderMutation =
  | { action: 'create' | 'rename'; id: string; name: string }
  | { action: 'delete'; id: string }
  | { action: 'move'; noteId: string; folderId: string | null }
  | { action: 'moveMany'; noteIds: string[]; folderId: string | null }
  | { action: 'reorder'; kind: 'note' | 'folder' | 'trash' | 'mindmap' | 'book'; ids: string[] }
const KEY = 'zixi.note-folders.v1'

export async function readNoteFolders(): Promise<NoteFolderState> {
  if (isTauriRuntime()) {
    await getDatabase()
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke('note_folders_state')
  }
  return JSON.parse(localStorage.getItem(KEY) ?? '{"folders":[],"entries":{}}') as NoteFolderState
}

export async function mutateNoteFolder(input: FolderMutation): Promise<NoteFolderState> {
  let state: NoteFolderState
  if (isTauriRuntime()) {
    await getDatabase()
    const { invoke } = await import('@tauri-apps/api/core')
    state = await invoke('mutate_note_folder', { input })
  } else {
    state = await readNoteFolders()
    if (input.action === 'create' || input.action === 'rename') {
      const name = input.name.trim()
      if (!name || name.length > 80) throw new Error('文件夹名称应为 1–80 个字符')
      if (state.folders.some((folder) => folder.id !== input.id && folder.name === name)) throw new Error('已存在同名文件夹')
      if (input.action === 'create') {
        if (state.folders.some((folder) => folder.id === input.id)) throw new Error('文件夹已存在')
        state.folders.push({ id: input.id, name })
      } else {
        const folder = state.folders.find((folder) => folder.id === input.id)
        if (!folder) throw new Error('文件夹已被删除')
        folder.name = name
      }
    } else if (input.action === 'delete') {
      state.folders = state.folders.filter((folder) => folder.id !== input.id)
      state.entries = Object.fromEntries(Object.entries(state.entries).filter(([, id]) => id !== input.id))
    } else if (input.action === 'move' || input.action === 'moveMany') {
      const ids = input.action === 'move' ? [input.noteId] : [...new Set(input.noteIds)]
      for (const id of ids) { const note = await getNote(id); if (!note || note.deletedAt) throw new Error('便签不存在或已移至回收站') }
      if (input.folderId && !state.folders.some((folder) => folder.id === input.folderId)) throw new Error('文件夹已被删除，请重新选择')
      for (const id of ids) { if (input.folderId) state.entries[id] = input.folderId; else delete state.entries[id] }
    } else if (input.action === 'reorder') {
      state.orders = { ...state.orders, [input.kind]: [...new Set(input.ids)] }
    }
    localStorage.setItem(KEY, JSON.stringify(state))
  }
  await publishNoteEvent({ action: 'folders-changed', noteId: null, updatedAt: new Date().toISOString() })
    .catch((error) => console.warn('文件夹已保存，但跨窗口通知失败', error))
  return state
}

export function newFolderId() { return makeId('folder') }
