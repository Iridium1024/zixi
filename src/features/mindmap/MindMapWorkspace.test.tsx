import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MindMapRecord } from './mindMapRepository'

const mocked = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), save: vi.fn(), create: vi.fn(), remove: vi.fn(), copy: vi.fn(), subscribe: vi.fn(), pick: vi.fn(), apply: vi.fn() }))
vi.mock('./mindMapRepository', () => ({ listMindMaps: mocked.list, getMindMap: mocked.get, saveMindMap: mocked.save, createMindMap: mocked.create, deleteMindMap: mocked.remove, MindMapConflictError: class MindMapConflictError extends Error {} }))
vi.mock('./mindMapEvents', () => ({ subscribeMindMapEvents: mocked.subscribe }))
vi.mock('../../lib/collaborationSnapshot', () => ({ pickMindMapCollaborationFile: mocked.pick }))
vi.mock('./mindMapIndex', () => ({ copyMindMapIndex: mocked.copy, applyMindMapSnapshot: mocked.apply }))
vi.mock('./MindMapCanvas', async () => {
  const React = await import('react')
  return { MindMapCanvas: React.forwardRef(function MockCanvas({ onChange }: { onChange(data: string): void }, ref) {
    React.useImperativeHandle(ref, () => ({ commit() {}, addChild() {}, addSibling() {}, edit() {}, remove() {}, undo() {}, redo() {}, center() {}, fit() {} }))
    return <button onClick={() => onChange('{"nodeData":{"id":"root","topic":"修改"}}')}>模拟节点变更</button>
  }) }
})
import { MindMapWorkspace } from './MindMapWorkspace'

const first: MindMapRecord = { id: 'first', title: '第一张', dataJson: '{"nodeData":{"id":"root","topic":"原始"}}', createdAt: '2026-01-01', updatedAt: '2026-01-01' }
const second: MindMapRecord = { ...first, id: 'second', title: '第二张' }

beforeEach(() => {
  mocked.list.mockReset().mockResolvedValue([first, second])
  mocked.get.mockReset().mockResolvedValue(first)
  mocked.subscribe.mockReset().mockResolvedValue(() => undefined)
  mocked.pick.mockReset()
  mocked.apply.mockReset()
  mocked.save.mockReset().mockImplementation(async (map: MindMapRecord) => ({ ...map, updatedAt: '2026-01-02' }))
  mocked.copy.mockReset().mockResolvedValue(undefined)
  mocked.create.mockReset()
  mocked.remove.mockReset()
})
afterEach(cleanup)

describe('mind map workspace saving', () => {
  it('offers to save before copying an index and saves the changed tree first', async () => {
    render(<MindMapWorkspace theme="light" />)
    await screen.findByDisplayValue('第一张')
    fireEvent.click(screen.getByText('模拟节点变更'))
    fireEvent.click(screen.getByRole('button', { name: '复制导图副本路径' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('已保存')
    fireEvent.click(screen.getByRole('button', { name: '保存并复制' }))
    await waitFor(() => expect(mocked.copy).toHaveBeenCalledWith('first'))
    expect(mocked.save).toHaveBeenCalledWith(expect.objectContaining({ dataJson: expect.stringContaining('修改') }))
    expect(mocked.save.mock.invocationCallOrder[0]).toBeLessThan(mocked.copy.mock.invocationCallOrder[0])
  })

  it('keeps a failed draft visible when switching maps', async () => {
    mocked.save.mockRejectedValue(new Error('数据库不可用'))
    render(<MindMapWorkspace theme="light" />)
    const title = await screen.findByDisplayValue('第一张')
    fireEvent.change(title, { target: { value: '尚未保存' } })
    fireEvent.click(screen.getByRole('button', { name: '第二张' }))
    expect(await screen.findByText(/保存失败，草稿仍保留/)).toBeInTheDocument()
    expect(title).toHaveValue('尚未保存')
  })

  it('does not copy an index if the requested save fails', async () => {
    mocked.save.mockRejectedValue(new Error('database unavailable'))
    render(<MindMapWorkspace theme="light" />)
    const title = await screen.findByDisplayValue('第一张')
    fireEvent.change(title, { target: { value: '未保存草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '复制导图副本路径' }))
    fireEvent.click(screen.getByRole('button', { name: '保存并复制' }))
    expect(await screen.findByText('保存失败，未复制路径；草稿仍保留')).toBeInTheDocument()
    expect(mocked.copy).not.toHaveBeenCalled()
    expect(title).toHaveValue('未保存草稿')
  })

  it('serializes edits made while a save is in flight', async () => {
    let resolveFirst!: (value: MindMapRecord) => void
    mocked.save.mockImplementationOnce(() => new Promise<MindMapRecord>((resolve) => { resolveFirst = resolve }))
      .mockImplementationOnce(async (map: MindMapRecord) => ({ ...map, updatedAt: '2026-01-03' }))
    render(<MindMapWorkspace theme="light" />)
    const title = await screen.findByDisplayValue('第一张')
    fireEvent.change(title, { target: { value: '第一次' } })
    fireEvent.click(screen.getByTitle('保存 (Ctrl+S)'))
    await waitFor(() => expect(mocked.save).toHaveBeenCalledTimes(1))
    fireEvent.change(title, { target: { value: '第二次' } })
    fireEvent.click(screen.getByTitle('保存 (Ctrl+S)'))
    await act(async () => { resolveFirst({ ...first, title: '第一次', updatedAt: '2026-01-02' }) })
    await waitFor(() => expect(mocked.save).toHaveBeenCalledTimes(2))
    expect(mocked.save.mock.calls[1][0]).toMatchObject({ title: '第二次', updatedAt: '2026-01-02' })
    expect(title).toHaveValue('第二次')
  })

  it('keeps a local draft on another window update and can save it as a separate map', async () => {
    const newer = { ...first, title: '另一窗口的版本', updatedAt: '2026-01-02' }
    mocked.get.mockResolvedValue(newer)
    mocked.create.mockResolvedValue({ ...first, id: 'copy', title: '本地草稿（草稿副本）' })
    render(<MindMapWorkspace theme="light" />)
    const title = await screen.findByDisplayValue('第一张')
    fireEvent.change(title, { target: { value: '本地草稿' } })
    mocked.list.mockResolvedValue([newer, second])
    const onEvent = mocked.subscribe.mock.calls[0][0]
    await act(async () => { onEvent({ mapId: 'first', action: 'saved', updatedAt: newer.updatedAt }) })
    expect(await screen.findByRole('alert')).toHaveTextContent('本地草稿仍保留')
    expect(title).toHaveValue('本地草稿')
    fireEvent.click(screen.getByRole('button', { name: '草稿另存为新导图' }))
    await waitFor(() => expect(mocked.create).toHaveBeenCalledWith(expect.objectContaining({ title: '本地草稿（草稿副本）' })))
    expect(await screen.findByDisplayValue('另一窗口的版本')).toBeInTheDocument()
  })

  it('applies a selected collaboration file only after loading the current saved version', async () => {
    const incoming = { ...first, title: '外部修改' }
    mocked.pick.mockResolvedValue('external json')
    mocked.apply.mockReturnValue(incoming)
    render(<MindMapWorkspace theme="light" />)
    await screen.findByDisplayValue('第一张')
    fireEvent.click(screen.getByRole('button', { name: '应用外部修改' }))
    await waitFor(() => expect(mocked.apply).toHaveBeenCalledWith('external json', first))
    expect(mocked.save).toHaveBeenCalledWith(incoming)
    expect(await screen.findByDisplayValue('外部修改')).toBeInTheDocument()
  })

  it('does not apply a file if the saved map changed while it was selected', async () => {
    mocked.pick.mockResolvedValue('external json')
    mocked.get.mockResolvedValue({ ...first, updatedAt: '2026-01-02' })
    render(<MindMapWorkspace theme="light" />)
    await screen.findByDisplayValue('第一张')
    fireEvent.click(screen.getByRole('button', { name: '应用外部修改' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('本地草稿仍保留')
    expect(mocked.apply).not.toHaveBeenCalled()
    expect(mocked.save).not.toHaveBeenCalled()
  })
})
