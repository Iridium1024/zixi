import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_NOTE_STYLE, type NoteRecord } from './types'

const mocked = vi.hoisted(() => ({ getNote: vi.fn(), isTauriRuntime: vi.fn(), copyText: vi.fn(), write: vi.fn() }))
vi.mock('../../lib/platform', () => ({ isTauriRuntime: mocked.isTauriRuntime }))
vi.mock('../../lib/copyText', () => ({ copyText: mocked.copyText }))
vi.mock('../../lib/collaborationSnapshot', () => ({ writeCollaborationSnapshot: mocked.write }))
vi.mock('./noteRepository', () => ({ getNote: mocked.getNote }))
import { copyNoteIndex } from './noteIndex'

const note: NoteRecord = {
  id: 'note-id', title: '参考项目', content: '已保存正文', style: DEFAULT_NOTE_STYLE,
  alwaysOnTop: false, createdAt: '2026-01-01', updatedAt: '2026-11-02', deletedAt: null,
}
beforeEach(() => {
  mocked.getNote.mockReset().mockResolvedValue(note)
  mocked.isTauriRuntime.mockReset().mockReturnValue(true)
  mocked.write.mockReset().mockResolvedValue('C:\\snapshots\\note.txt')
  mocked.copyText.mockReset().mockResolvedValue(undefined)
})

describe('note collaboration snapshot', () => {
  it('writes the saved text and copies only its file path', async () => {
    await copyNoteIndex(note.id)
    expect(mocked.write).toHaveBeenCalledWith('note', note.content)
    expect(mocked.copyText).toHaveBeenCalledWith('C:\\snapshots\\note.txt')
  })
  it('does not copy when the note is deleted or creating the file fails', async () => {
    mocked.getNote.mockResolvedValueOnce({ ...note, deletedAt: '2026-11-02' })
    await expect(copyNoteIndex(note.id)).rejects.toThrow('未找到')
    mocked.write.mockRejectedValueOnce(new Error('disk full'))
    await expect(copyNoteIndex(note.id)).rejects.toThrow('disk full')
    expect(mocked.copyText).not.toHaveBeenCalled()
  })
  it('rejects browser-only data', async () => {
    mocked.isTauriRuntime.mockReturnValue(false)
    await expect(copyNoteIndex(note.id)).rejects.toThrow('浏览器预览')
  })
})
