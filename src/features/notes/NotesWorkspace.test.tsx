import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APPEARANCE } from '../settings/appearance'
import { DEFAULT_WINDOW_BEHAVIOR } from '../settings/windowBehavior'
import { DEFAULT_NOTE_STYLE, type NoteRecord } from './types'

const mocked = vi.hoisted(() => ({ listNotes: vi.fn(), listRevisions: vi.fn(), saveNote: vi.fn(), createNote: vi.fn(), copyNoteIndex: vi.fn(), subscribeNoteEvents: vi.fn() }))
vi.mock('./noteRepository', async (importOriginal) => ({
  ...await importOriginal<typeof import('./noteRepository')>(),
  listNotes: mocked.listNotes,
  listRevisions: mocked.listRevisions,
  saveNote: mocked.saveNote,
  createNote: mocked.createNote,
}))
vi.mock('./noteEvents', () => ({ subscribeNoteEvents: mocked.subscribeNoteEvents }))
vi.mock('./noteIndex', () => ({ copyNoteIndex: mocked.copyNoteIndex }))

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
  mocked.copyNoteIndex.mockReset().mockResolvedValue(undefined)
  mocked.subscribeNoteEvents.mockReset().mockResolvedValue(() => undefined)
})
afterEach(cleanup)

describe('notes workspace navigation and panels', () => {
  it('keeps database errors visible inside an empty workspace', async () => {
    mocked.listNotes.mockRejectedValue(new Error('database unavailable'))
    render(<NotesWorkspace appearance={DEFAULT_APPEARANCE} windowBehavior={DEFAULT_WINDOW_BEHAVIOR} />)
    expect(await screen.findByText('读取失败，请检查本地数据库')).toBeInTheDocument()
  })

  it('copies the saved note index and reports success', async () => {
    render(<NotesWorkspace appearance={DEFAULT_APPEARANCE} windowBehavior={DEFAULT_WINDOW_BEHAVIOR} />)
    await screen.findByPlaceholderText('记录灵感、待办或会议信息…')
    fireEvent.click(screen.getByRole('button', { name: '复制便签副本路径' }))
    await waitFor(() => expect(mocked.copyNoteIndex).toHaveBeenCalledWith('test-note'))
    expect(await screen.findByText('副本路径已复制')).toBeInTheDocument()
  })

  it('offers a saved-version index without discarding an unsaved workspace draft', async () => {
    mocked.saveNote.mockImplementation(async (value: NoteRecord) => value)
    render(<NotesWorkspace appearance={DEFAULT_APPEARANCE} windowBehavior={DEFAULT_WINDOW_BEHAVIOR} />)
    const editor = await screen.findByPlaceholderText('记录灵感、待办或会议信息…')
    fireEvent.change(editor, { target: { value: '尚未保存的内容' } })
    fireEvent.click(screen.getByRole('button', { name: '复制便签副本路径' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('已保存版本')
    fireEvent.click(screen.getByRole('button', { name: '复制已保存版本' }))
    await waitFor(() => expect(mocked.copyNoteIndex).toHaveBeenCalledWith('test-note'))
    expect(editor).toHaveValue('尚未保存的内容')
  })

  it('saves the workspace draft before copying when requested', async () => {
    mocked.saveNote.mockImplementation(async (value: NoteRecord) => value)
    render(<NotesWorkspace appearance={DEFAULT_APPEARANCE} windowBehavior={DEFAULT_WINDOW_BEHAVIOR} />)
    const editor = await screen.findByPlaceholderText('记录灵感、待办或会议信息…')
    fireEvent.change(editor, { target: { value: '需要先保存的内容' } })
    fireEvent.click(screen.getByRole('button', { name: '复制便签副本路径' }))
    fireEvent.click(screen.getByRole('button', { name: '保存并复制' }))
    await waitFor(() => expect(mocked.copyNoteIndex).toHaveBeenCalledWith('test-note'))
    expect(mocked.saveNote).toHaveBeenCalledWith(expect.objectContaining({ content: '需要先保存的内容' }))
    expect(mocked.saveNote.mock.invocationCallOrder[0]).toBeLessThan(mocked.copyNoteIndex.mock.invocationCallOrder[0])
  })

  it('requires a newly created note to be saved before its edited index is copied', async () => {
    const created = { ...note, id: 'new-note', title: '新便签', content: '' }
    mocked.createNote.mockResolvedValue(created)
    render(<NotesWorkspace appearance={DEFAULT_APPEARANCE} windowBehavior={DEFAULT_WINDOW_BEHAVIOR} />)
    await screen.findByPlaceholderText('记录灵感、待办或会议信息…')
    fireEvent.click(screen.getByTitle('在主窗口新建便签'))
    await screen.findByDisplayValue('新便签')
    fireEvent.change(screen.getByPlaceholderText('记录灵感、待办或会议信息…'), { target: { value: '尚未保存' } })
    fireEvent.click(screen.getByRole('button', { name: '复制便签副本路径' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('新便签需要先确认保存')
    expect(screen.queryByRole('button', { name: '复制已保存版本' })).not.toBeInTheDocument()
  })

  it('does not copy the index when saving the workspace draft fails', async () => {
    mocked.saveNote.mockRejectedValue(new Error('disk busy'))
    render(<NotesWorkspace appearance={DEFAULT_APPEARANCE} windowBehavior={DEFAULT_WINDOW_BEHAVIOR} />)
    const editor = await screen.findByPlaceholderText('记录灵感、待办或会议信息…')
    fireEvent.change(editor, { target: { value: '待保存内容' } })
    fireEvent.click(screen.getByRole('button', { name: '复制便签副本路径' }))
    fireEvent.click(screen.getByRole('button', { name: '保存并复制' }))
    expect(await screen.findByText('保存失败，未复制路径')).toBeInTheDocument()
    expect(mocked.copyNoteIndex).not.toHaveBeenCalled()
    expect(editor).toHaveValue('待保存内容')
  })

  it('closes the index prompt if another window removes the current note', async () => {
    mocked.saveNote.mockImplementation(async (value: NoteRecord) => value)
    render(<NotesWorkspace appearance={DEFAULT_APPEARANCE} windowBehavior={DEFAULT_WINDOW_BEHAVIOR} />)
    const editor = await screen.findByPlaceholderText('记录灵感、待办或会议信息…')
    fireEvent.change(editor, { target: { value: '未保存草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '复制便签副本路径' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await waitFor(() => expect(mocked.subscribeNoteEvents).toHaveBeenCalled())
    mocked.listNotes.mockResolvedValue([])
    const handleEvent = mocked.subscribeNoteEvents.mock.calls[0][0]
    await act(async () => { await handleEvent({ noteId: note.id, action: 'deleted' }) })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocked.copyNoteIndex).not.toHaveBeenCalled()
    expect(screen.getByTitle('在主窗口新建便签')).toBeEnabled()
  })

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
    fireEvent.click(screen.getByRole('button', { name: '搜索便签' }))
    fireEvent.change(screen.getByPlaceholderText('搜索便签'), { target: { value: '不存在的内容' } })
    expect(screen.getByText('没有匹配的搜索结果')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }))
    view.rerender(<NotesWorkspace {...props} listOpen={false} settingsOpen={false} />)
    expect(screen.getByPlaceholderText('记录灵感、待办或会议信息…')).toBe(editor)
    expect(editor).toHaveValue('未完成的编辑')
    await waitFor(() => expect(document.getElementById('note-list-panel')).toHaveAttribute('hidden'))
    expect(document.getElementById('note-settings-panel')).toHaveAttribute('inert')
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
