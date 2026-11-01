import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_READER_PREFERENCES } from './readerPreferences'
import type { ReaderBook } from './types'

const mocked = vi.hoisted(() => ({
  listBooks: vi.fn(),
  loadBook: vi.fn(),
  saveProgress: vi.fn(),
  emit: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}))
vi.mock('../../lib/platform', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/platform')>(),
  isTauriRuntime: () => true,
}))
vi.mock('./readerRepository', async (importOriginal) => ({
  ...await importOriginal<typeof import('./readerRepository')>(),
  listReaderBooks: mocked.listBooks,
  loadReaderBookContent: mocked.loadBook,
  saveReaderProgress: mocked.saveProgress,
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
    mocked.listeners.set(name, handler)
    return () => mocked.listeners.delete(name)
  },
  emit: mocked.emit,
}))

import { ReaderWorkspace } from './ReaderWorkspace'

function book(id: string, title: string, importedAt: string, lastOpenedAt: string | null, progress: number): ReaderBook {
  return { id, title, importedAt, lastOpenedAt, progress, sourceFileName: `${title}.txt`, storedPath: id, encoding: 'UTF-8', byteSize: 1, contentHash: id, updatedAt: importedAt, locatorJson: null }
}
const books = [
  book('a', '甲', '2026-01-01', '2026-01-05', 0.2),
  book('b', '乙', '2026-01-02', '2026-01-03', 0.8),
]

function cardTitles(container: HTMLElement) {
  return Array.from(container.querySelectorAll('.reader-library-card strong'), (element) => element.textContent)
}

beforeEach(() => {
  localStorage.clear()
  mocked.listBooks.mockReset().mockResolvedValue(books)
  mocked.loadBook.mockReset()
  mocked.saveProgress.mockReset().mockResolvedValue(undefined)
  mocked.emit.mockReset().mockResolvedValue(undefined)
  mocked.listeners.clear()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('reader library workspace', () => {
  it('keeps automatic recent opening independent of display sorting and responds to reader updates', async () => {
    localStorage.setItem('zixi.reader.library-sort.v1', 'progress')
    const open = vi.fn()
    const { container } = render(<ReaderWorkspace preferences={{ ...DEFAULT_READER_PREFERENCES, autoOpenRecent: true }} onPreferencesChange={vi.fn()} onStatusChange={vi.fn()} onOpenStandalone={open} />)
    await waitFor(() => expect(open).toHaveBeenCalledWith(books[0]))
    expect(cardTitles(container)).toEqual(['乙', '甲'])
    act(() => mocked.listeners.get('reader-progress-changed')?.({ payload: { bookId: 'a', progress: 0.95, locatorJson: '{}' } }))
    expect(cardTitles(container)).toEqual(['甲', '乙'])
    fireEvent.change(screen.getByLabelText('书架排序'), { target: { value: 'recent' } })
    act(() => mocked.listeners.get('reader-book-opened')?.({ payload: { bookId: 'b', lastOpenedAt: '2026-01-06' } }))
    expect(cardTitles(container)).toEqual(['乙', '甲'])
    expect(within(container.querySelector('.reader-library-toolbar') as HTMLElement).getByText('2 本')).toBeInTheDocument()
  })

  it('retains a reader update received while the initial book list is loading', async () => {
    let resolveBooks!: (value: ReaderBook[]) => void
    mocked.listBooks.mockReturnValue(new Promise<ReaderBook[]>((resolve) => { resolveBooks = resolve }))
    const open = vi.fn()
    render(<ReaderWorkspace preferences={{ ...DEFAULT_READER_PREFERENCES, autoOpenRecent: true }} onPreferencesChange={vi.fn()} onStatusChange={vi.fn()} onOpenStandalone={open} />)
    await waitFor(() => expect(mocked.listeners.has('reader-book-opened')).toBe(true))
    act(() => mocked.listeners.get('reader-book-opened')?.({ payload: { bookId: 'b', lastOpenedAt: '2026-01-06' } }))
    await act(async () => { resolveBooks(books) })
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', lastOpenedAt: '2026-01-06' }))
  })

  it('announces the actual last-opened time when a standalone reader loads a book', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    mocked.loadBook.mockResolvedValue({ book: { ...books[0], lastOpenedAt: '2026-01-09' }, content: '第一章\n测试正文' })
    render(<ReaderWorkspace standalone initialBookId="a" preferences={DEFAULT_READER_PREFERENCES} onPreferencesChange={vi.fn()} onStatusChange={vi.fn()} />)
    await waitFor(() => expect(mocked.emit).toHaveBeenCalledWith('reader-book-opened', { bookId: 'a', lastOpenedAt: '2026-01-09' }))
  })
})
