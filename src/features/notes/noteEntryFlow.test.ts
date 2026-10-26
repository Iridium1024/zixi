import { describe, expect, it, vi } from 'vitest'
import { executeIndependentWindowEntry, executeNewNoteEntry } from './noteEntryFlow'
import { DEFAULT_NOTE_STYLE, type NoteRecord } from './types'

const note: NoteRecord = {
  id: 'note-entry', title: '入口', content: '', style: DEFAULT_NOTE_STYLE, alwaysOnTop: true,
  createdAt: '2026-08-13T00:00:00.000Z', updatedAt: '2026-08-13T00:00:00.000Z', deletedAt: null,
}

function dependencies() {
  return {
    create: vi.fn(async () => note),
    open: vi.fn(async () => ({ created: true })),
    afterOpen: vi.fn(async () => undefined),
  }
}

describe('note entry flow', () => {
  it('tray creates a float and applies the configured main-window behavior', async () => {
    const deps = dependencies()
    await executeNewNoteEntry('tray', deps)
    expect(deps.open).toHaveBeenCalledOnce()
    expect(deps.afterOpen).toHaveBeenCalledOnce()
  })

  it('sidebar hides main only after the floating window opens', async () => {
    const calls: string[] = []
    const deps = dependencies()
    deps.open.mockImplementation(async () => { calls.push('open'); return { created: true } })
    deps.afterOpen.mockImplementation(async () => { calls.push('after-open') })
    await executeNewNoteEntry('sidebar', deps)
    expect(calls).toEqual(['open', 'after-open'])
  })

  it('never hides main when opening a sidebar float fails', async () => {
    const deps = dependencies()
    deps.open.mockRejectedValue(new Error('window failed'))
    await expect(executeNewNoteEntry('sidebar', deps)).rejects.toThrow('window failed')
    expect(deps.afterOpen).not.toHaveBeenCalled()
  })

  it('notes page plus creates in main without opening a float', async () => {
    const deps = dependencies()
    await executeNewNoteEntry('notes-page', deps)
    expect(deps.open).not.toHaveBeenCalled()
    expect(deps.afterOpen).not.toHaveBeenCalled()
  })

  it('independent entry saves, opens, then hides in order', async () => {
    const calls: string[] = []
    await executeIndependentWindowEntry(
      async () => { calls.push('save'); return note },
      {
        open: async () => { calls.push('open') },
        afterOpen: async () => { calls.push('after-open') },
      },
    )
    expect(calls).toEqual(['save', 'open', 'after-open'])
  })
})
