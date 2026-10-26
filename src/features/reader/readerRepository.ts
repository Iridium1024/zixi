import { isTauriRuntime } from '../../lib/platform'
import type { ReaderBook, ReaderBookContent, ReaderLocator, TextBookCandidate } from './types'

const BOOKS_KEY = 'zixi.reader.books.v1'
const CONTENT_PREFIX = 'zixi.reader.content.'

function browserBooks(): ReaderBook[] {
  try {
    const value = JSON.parse(localStorage.getItem(BOOKS_KEY) ?? '[]')
    return Array.isArray(value) ? value.map((book) => ({ ...book, locatorJson: typeof book.locatorJson === 'string' ? book.locatorJson : null })) : []
  } catch { return [] }
}

function storeBrowserBooks(books: ReaderBook[]) {
  localStorage.setItem(BOOKS_KEY, JSON.stringify(books))
}

function encodingLabel(label: string): string {
  const normalized = label.toLowerCase().replaceAll('_', '-')
  if (normalized === 'utf-16le' || normalized === 'utf-16be' || normalized === 'big5' || normalized === 'shift-jis') return normalized
  if (normalized === 'gbk' || normalized === 'gb18030') return 'gb18030'
  return 'utf-8'
}

async function decodeBrowserFile(file: File, label: string, fatal: boolean): Promise<string> {
  const bytes = await file.arrayBuffer()
  return new TextDecoder(encodingLabel(label), { fatal }).decode(bytes)
}

async function sha256Prefix(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createBrowserCandidate(file: File): Promise<TextBookCandidate> {
  let detectedEncoding = 'UTF-8'
  let preview: string
  let hadDecodingErrors = false
  try {
    preview = await decodeBrowserFile(file, 'utf-8', true)
  } catch {
    detectedEncoding = 'GBK'
    try { preview = await decodeBrowserFile(file, 'gb18030', true) } catch {
      preview = await decodeBrowserFile(file, 'gb18030', false)
      hadDecodingErrors = true
    }
  }
  return {
    sourcePath: '',
    sourceFileName: file.name,
    title: file.name.replace(/\.txt$/i, '') || '未命名书籍',
    byteSize: file.size,
    detectedEncoding,
    preview: preview.slice(0, 4_000),
    hadDecodingErrors,
    browserFile: file,
  }
}

export async function pickTextBookCandidate(): Promise<TextBookCandidate | null> {
  if (!isTauriRuntime()) throw new Error('浏览器预览请使用文件输入框')
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<TextBookCandidate | null>('pick_text_book_candidate')
}

export async function refreshTextBookPreview(candidate: TextBookCandidate, encoding: string): Promise<TextBookCandidate> {
  if (!isTauriRuntime()) {
    if (!candidate.browserFile) throw new Error('预览文件已经失效，请重新选择')
    let preview: string
    let hadDecodingErrors = false
    try { preview = await decodeBrowserFile(candidate.browserFile, encoding, true) } catch {
      preview = await decodeBrowserFile(candidate.browserFile, encoding, false)
      hadDecodingErrors = true
    }
    return { ...candidate, detectedEncoding: encoding, preview: preview.slice(0, 4_000), hadDecodingErrors }
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<TextBookCandidate>('preview_text_book', { sourcePath: candidate.sourcePath, encoding })
}

export async function importTextBook(candidate: TextBookCandidate, encoding: string): Promise<ReaderBook> {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<ReaderBook>('import_text_book', { sourcePath: candidate.sourcePath, encoding })
  }
  if (!candidate.browserFile) throw new Error('导入文件已经失效，请重新选择')
  const content = (await decodeBrowserFile(candidate.browserFile, encoding, true)).replace(/\r\n?/g, '\n')
  const contentHash = await sha256Prefix(content)
  const id = `book-${contentHash}`
  const now = new Date().toISOString()
  const previous = browserBooks().find((book) => book.id === id)
  const book: ReaderBook = {
    id,
    title: candidate.title,
    sourceFileName: candidate.sourceFileName,
    storedPath: `browser://${id}`,
    encoding,
    byteSize: new TextEncoder().encode(content).byteLength,
    contentHash,
    importedAt: previous?.importedAt ?? now,
    updatedAt: now,
    lastOpenedAt: previous?.lastOpenedAt ?? null,
    progress: previous?.progress ?? 0,
    locatorJson: previous?.locatorJson ?? null,
  }
  localStorage.setItem(`${CONTENT_PREFIX}${id}`, content)
  storeBrowserBooks([book, ...browserBooks().filter((item) => item.id !== id)])
  return book
}

export async function listReaderBooks(): Promise<ReaderBook[]> {
  if (!isTauriRuntime()) return browserBooks()
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<ReaderBook[]>('list_reader_books')
}

export async function loadReaderBookContent(bookId: string): Promise<ReaderBookContent> {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<ReaderBookContent>('load_reader_book_content', { bookId })
  }
  const books = browserBooks()
  const book = books.find((item) => item.id === bookId)
  if (!book) throw new Error('书库中不存在这本书')
  const updated = { ...book, lastOpenedAt: new Date().toISOString() }
  storeBrowserBooks([updated, ...books.filter((item) => item.id !== bookId)])
  return { book: updated, content: localStorage.getItem(`${CONTENT_PREFIX}${bookId}`) ?? '' }
}

export async function saveReaderProgress(bookId: string, progress: number, locator: ReaderLocator): Promise<void> {
  const normalized = Math.min(1, Math.max(0, progress))
  const locatorJson = JSON.stringify(locator)
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('save_reader_progress', { bookId, progress: normalized, locatorJson })
    return
  }
  storeBrowserBooks(browserBooks().map((book) => book.id === bookId ? { ...book, progress: normalized, locatorJson } : book))
}

export async function deleteReaderBook(bookId: string): Promise<void> {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('delete_reader_book', { bookId })
    return
  }
  localStorage.removeItem(`${CONTENT_PREFIX}${bookId}`)
  storeBrowserBooks(browserBooks().filter((book) => book.id !== bookId))
}
