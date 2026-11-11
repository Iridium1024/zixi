import { isTauriRuntime } from '../../lib/platform'
import { copyText } from '../../lib/copyText'
import { writeCollaborationSnapshot } from '../../lib/collaborationSnapshot'
import { getNote } from './noteRepository'

export async function copyNoteIndex(noteId: string): Promise<void> {
  if (!isTauriRuntime()) throw new Error('浏览器预览无法生成桌面便签副本')
  const saved = await getNote(noteId)
  if (!saved || saved.deletedAt) throw new Error('未找到可读取的已保存便签')
  const path = await writeCollaborationSnapshot('note', saved.content)
  await copyText(path)
}
