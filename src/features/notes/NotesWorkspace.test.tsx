import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APPEARANCE } from '../settings/appearance'
import { DEFAULT_WINDOW_BEHAVIOR } from '../settings/windowBehavior'
import { DEFAULT_NOTE_STYLE, type NoteRecord } from './types'

const mocked = vi.hoisted(() => ({ listNotes: vi.fn(), listRevisions: vi.fn(), saveNote: vi.fn(), createNote: vi.fn() }))
vi.mock('./noteRepository', async (importOriginal) => ({
  ...await importOriginal<typeof import('./noteRepository')>(),
  listNotes: mocked.listNotes,
  listRevisions: mocked.listRevisions,
  saveNote: mocked.saveNote,
  createNote: mocked.createNote,
}))
vi.mock('./noteEvents', () => ({ subscribeNoteEvents: vi.fn(async () => () => undefined) }))

import { NotesWorkspace } from './NotesWorkspace'

const note: NoteRecord = {
  id: 'test-note', title: '测试便签', content: '原有内容', style: DEFAULT_NOTE_STYLE,
  alwaysOnTop: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
}

beforeEach(() => {
  mocked.listNotes.mockReset().mockResolvedValue([note])
  mocked.listRevisions.mockReset().mockResolvedValue([])
  mocked.saveNote.mockReset()
  mocked.createNote.mockReset()
})
afterEach(cleanup)

describe('notes workspace navigation and panels', () => {
  it('keeps a failed draft editable and blocks navigation until saving succeeds', async () => {
    mocked.saveNote.mockRejectedValueOnce(new Error('disk busy')).mockImplementation(async (value: NoteRecord) => value)
    let beforeLeave: (() => Promise<boolean>) | null = null
    const register = (handler: (() => Promise<boolean>) | null) => { beforeLeave = handler }
    render(<NotesWorkspace appearance={DEFAULT_APPEARANCE} windowBehavior={DEFAULT_WINDOW_BEHAVIOR} onBeforeLeaveReady={register} />)
    const editor = await screen.findByPlaceholderText('记录灵感、待办或会议信息…')
    fireEvent.change(editor, { target: { value: '需要保留的草稿' } })

    let allowed = true
    await act(async () => { allowed = await beforeLeave!() })
    expect(allowed).toBe(false)
    expect(editor).toHaveValue('需要保留的草稿')
    expect(editor).not.toHaveAttribute('readonly')
    expect(screen.getByText('当前草稿尚未安全保存，请处理后再切换页面')).toBeInTheDocument()

    await act(async () => { allowed = await beforeLeave!() })
    expect(allowed).toBe(true)
    expect(mocked.saveNote).toHaveBeenLastCalledWith(expect.objectContaining({ content: '需要保留的草稿' }))
  })

  it('keeps the editor and draft when panels collapse and distinguishes unmatched search', async () => {
    const props = { appearance: DEFAULT_APPEARANCE, windowBehavior: DEFAULT_WINDOW_BEHAVIOR }
    const view = render(<NotesWorkspace {...props} listOpen settingsOpen />)
    const editor = await screen.findByPlaceholderText('记录灵感、待办或会议信息…')
    fireEvent.change(editor, { target: { value: '未完成的编辑' } })
    fireEvent.change(screen.getByPlaceholderText('搜索便签'), { target: { value: '不存在的内容' } })
    expect(screen.getByText('没有匹配的搜索结果')).toBeInTheDocument()
    view.rerender(<NotesWorkspace {...props} listOpen={false} settingsOpen={false} />)
    expect(screen.getByPlaceholderText('记录灵感、待办或会议信息…')).toBe(editor)
    expect(editor).toHaveValue('未完成的编辑')
    await waitFor(() => expect(document.getElementById('note-list-panel')).toHaveAttribute('hidden'))
  })

  it('does not replace an unsaved draft when creating a note fails to flush it', async () => {
    mocked.saveNote.mockRejectedValueOnce(new Error('disk busy'))
    render(<NotesWorkspace appearance={DEFAULT_APPEARANCE} windowBehavior={DEFAULT_WINDOW_BEHAVIOR} />)
    const editor = await screen.findByPlaceholderText('记录灵感、待办或会议信息…')
    fireEvent.change(editor, { target: { value: '仍需保存' } })
    fireEvent.click(screen.getByTitle('在主窗口新建便签'))
    expect(await screen.findByText('当前草稿尚未安全保存，请先处理后再新建便签')).toBeInTheDocument()
    expect(editor).toHaveValue('仍需保存')
    expect(mocked.createNote).not.toHaveBeenCalled()
  })
})
