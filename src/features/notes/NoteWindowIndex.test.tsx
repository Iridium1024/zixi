import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_NOTE_STYLE, type NoteRecord } from './types'

const mocked = vi.hoisted(() => ({ getNote: vi.fn(), saveNote: vi.fn(), copyNoteIndex: vi.fn(), subscribeNoteEvents: vi.fn() }))
vi.mock('./noteRepository', async (importOriginal) => ({
  ...await importOriginal<typeof import('./noteRepository')>(),
  getNote: mocked.getNote,
  saveNote: mocked.saveNote,
}))
vi.mock('./noteIndex', () => ({ copyNoteIndex: mocked.copyNoteIndex }))
vi.mock('./noteEvents', () => ({ subscribeNoteEvents: mocked.subscribeNoteEvents }))
vi.mock('../settings/useAppearanceRuntime', () => ({ useAppearanceRuntime: () => ({ resolvedTheme: 'light', issues: [] }) }))

import { NoteWindow } from './NoteWindow'

const note: NoteRecord = {
  id: 'floating-note', title: '参考项目', content: '已保存内容', style: DEFAULT_NOTE_STYLE,
  alwaysOnTop: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
}

beforeEach(() => {
  localStorage.clear()
  mocked.getNote.mockReset().mockResolvedValue(note)
  mocked.saveNote.mockReset().mockImplementation(async (value: NoteRecord) => value)
  mocked.copyNoteIndex.mockReset().mockResolvedValue(undefined)
  mocked.subscribeNoteEvents.mockReset().mockResolvedValue(() => undefined)
})
afterEach(cleanup)

describe('floating note collaboration index', () => {
  it('copies an existing saved note index', async () => {
    render(<NoteWindow noteId={note.id} />)
    await screen.findByPlaceholderText('在这里记录…')
    fireEvent.click(screen.getByRole('button', { name: '复制便签副本路径' }))
    await waitFor(() => expect(mocked.copyNoteIndex).toHaveBeenCalledWith(note.id))
    expect(await screen.findByText('副本路径已复制')).toBeInTheDocument()
  })

  it('preserves an unsaved floating draft when copying its saved version', async () => {
    render(<NoteWindow noteId={note.id} />)
    const editor = await screen.findByPlaceholderText('在这里记录…')
    fireEvent.change(editor, { target: { value: '未保存草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '复制便签副本路径' }))
    fireEvent.click(screen.getByRole('button', { name: '复制已保存版本' }))
    await waitFor(() => expect(mocked.copyNoteIndex).toHaveBeenCalledWith(note.id))
    expect(mocked.saveNote).not.toHaveBeenCalled()
    expect(editor).toHaveValue('未保存草稿')
  })

  it('requires a new floating note to be confirmed before copying its index', async () => {
    render(<NoteWindow noteId={note.id} createdFromNew />)
    await screen.findByPlaceholderText('在这里记录…')
    fireEvent.click(screen.getByRole('button', { name: '复制便签副本路径' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('新便签需要先确认保存')
    expect(screen.queryByRole('button', { name: '复制已保存版本' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存并复制' }))
    await waitFor(() => expect(mocked.copyNoteIndex).toHaveBeenCalledWith(note.id))
  })

  it('saves an edited floating draft before copying when requested', async () => {
    render(<NoteWindow noteId={note.id} />)
    const editor = await screen.findByPlaceholderText('在这里记录…')
    fireEvent.change(editor, { target: { value: '需要保存的草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '复制便签副本路径' }))
    fireEvent.click(screen.getByRole('button', { name: '保存并复制' }))
    await waitFor(() => expect(mocked.copyNoteIndex).toHaveBeenCalledWith(note.id))
    expect(mocked.saveNote).toHaveBeenCalledWith(expect.objectContaining({ content: '需要保存的草稿' }))
    expect(mocked.saveNote.mock.invocationCallOrder[0]).toBeLessThan(mocked.copyNoteIndex.mock.invocationCallOrder[0])
  })

  it('shows clipboard failure without hiding the save state', async () => {
    mocked.copyNoteIndex.mockRejectedValueOnce(new Error('写入剪贴板失败，请重试'))
    render(<NoteWindow noteId={note.id} />)
    await screen.findByPlaceholderText('在这里记录…')
    fireEvent.click(screen.getByRole('button', { name: '复制便签副本路径' }))
    expect(await screen.findByText('写入剪贴板失败，请重试')).toBeInTheDocument()
    expect(screen.getByText('已保存')).toBeInTheDocument()
  })

  it('dismisses the index prompt if another window moves the note to trash', async () => {
    render(<NoteWindow noteId={note.id} />)
    const editor = await screen.findByPlaceholderText('在这里记录…')
    fireEvent.change(editor, { target: { value: '未保存草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '复制便签副本路径' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await waitFor(() => expect(mocked.subscribeNoteEvents).toHaveBeenCalled())
    const handleEvent = mocked.subscribeNoteEvents.mock.calls[0][0]
    await act(async () => { await handleEvent({ noteId: note.id, action: 'trashed' }) })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(editor).toBeDisabled()
    expect(mocked.copyNoteIndex).not.toHaveBeenCalled()
  })
})
