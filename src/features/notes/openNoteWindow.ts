import { isTauriRuntime } from '../../lib/platform'

export interface OpenNoteWindowResult { created: boolean }

export async function openNoteWindow(noteId: string, title: string, createdFromNew = false): Promise<OpenNoteWindowResult> {
  if (!isTauriRuntime()) return { created: false }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<OpenNoteWindowResult>('open_note_window', { noteId, title, createdFromNew })
}
