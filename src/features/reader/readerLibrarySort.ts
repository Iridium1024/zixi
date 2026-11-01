import type { ReaderBook } from './types'

export type ReaderLibrarySort = 'recent' | 'imported' | 'title' | 'progress'
const titleCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

export function isReaderLibrarySort(value: unknown): value is ReaderLibrarySort {
  return value === 'recent' || value === 'imported' || value === 'title' || value === 'progress'
}

function recentTime(book: ReaderBook) {
  return book.lastOpenedAt ?? book.importedAt
}

export function sortReaderBooks(books: readonly ReaderBook[], sort: ReaderLibrarySort): ReaderBook[] {
  return [...books].sort((left, right) => {
    const byRecent = recentTime(right).localeCompare(recentTime(left))
    const byImported = right.importedAt.localeCompare(left.importedAt)
    const byTitle = titleCollator.compare(left.title, right.title)
    const primary = sort === 'recent' ? byRecent
      : sort === 'imported' ? byImported
        : sort === 'title' ? byTitle
          : right.progress - left.progress
    return primary || byRecent || byImported || byTitle || left.id.localeCompare(right.id)
  })
}
