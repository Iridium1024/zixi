import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteSaveCoordinator } from './saveCoordinator'
import { DEFAULT_NOTE_STYLE, type NoteRecord } from './types'

const base: NoteRecord = {
  id: 'note-1',
  title: '标题',
  content: '',
  style: DEFAULT_NOTE_STYLE,
  alwaysOnTop: true,
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
  deletedAt: null,
}

describe('NoteSaveCoordinator', () => {
  afterEach(() => vi.useRealTimers())

  it('debounces edits and persists only the latest draft', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async (note: NoteRecord) => ({ ...note, updatedAt: '2026-08-13T00:00:01.000Z' }))
    const coordinator = new NoteSaveCoordinator({ delay: 700, save })
    coordinator.setBaseline(base)
    coordinator.schedule({ ...base, content: '一' })
    coordinator.schedule({ ...base, content: '最终内容' })
    await vi.advanceTimersByTimeAsync(700)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].content).toBe('最终内容')
  })

  it('coalesces twenty repeated close flushes into one save', async () => {
    let resolveSave: ((note: NoteRecord) => void) | undefined
    const save = vi.fn((note: NoteRecord) => new Promise<NoteRecord>((resolve) => {
      resolveSave = () => resolve({ ...note, updatedAt: '2026-08-13T00:00:01.000Z' })
    }))
    const coordinator = new NoteSaveCoordinator({ save })
    coordinator.setBaseline(base)
    const latest = { ...base, content: '只保存一次' }
    coordinator.schedule(latest)
    const flushes = Array.from({ length: 20 }, () => coordinator.flush(latest))
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    resolveSave?.(latest)
    await Promise.all(flushes)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed draft pending so a later flush can retry', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('disk busy'))
      .mockImplementationOnce(async (note: NoteRecord) => ({ ...note, updatedAt: '2026-08-13T00:00:01.000Z' }))
    const coordinator = new NoteSaveCoordinator({ save })
    coordinator.setBaseline(base)
    const latest = { ...base, content: '不能丢' }
    coordinator.schedule(latest)

    await expect(coordinator.flush(latest)).rejects.toThrow('disk busy')
    expect(coordinator.hasPendingSave()).toBe(true)
    await expect(coordinator.flush(latest)).resolves.toMatchObject({ content: '不能丢' })
    expect(save).toHaveBeenCalledTimes(2)
  })
})
