import { describe, expect, it } from 'vitest'
import { sortReaderBooks } from './readerLibrarySort'
import type { ReaderBook } from './types'

function book(id: string, title: string, importedAt: string, lastOpenedAt: string | null, progress: number): ReaderBook {
  return { id, title, importedAt, lastOpenedAt, progress, sourceFileName: `${title}.txt`, storedPath: id, encoding: 'UTF-8', byteSize: 1, contentHash: id, updatedAt: importedAt, locatorJson: null }
}

const books = [
  book('a', '故事 10', '2026-01-03', '2026-01-04', 0.2),
  book('b', '故事 2', '2026-01-02', '2026-01-05', 0.8),
  book('c', '故事 1', '2026-01-06', null, 0.5),
]

describe('reader library sorting', () => {
  it('sorts by recent usage, import time, natural title and progress without mutating the source', () => {
    expect(sortReaderBooks(books, 'recent').map((item) => item.id)).toEqual(['c', 'b', 'a'])
    expect(sortReaderBooks(books, 'imported').map((item) => item.id)).toEqual(['c', 'a', 'b'])
    expect(sortReaderBooks(books, 'title').map((item) => item.id)).toEqual(['c', 'b', 'a'])
    expect(sortReaderBooks(books, 'progress').map((item) => item.id)).toEqual(['b', 'c', 'a'])
    expect(books.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })
})
