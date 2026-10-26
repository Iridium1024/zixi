export interface ReaderLocator {
  version: 1
  offset: number
  blockId: string
}

export interface ReaderBook {
  id: string
  title: string
  sourceFileName: string
  storedPath: string
  encoding: string
  byteSize: number
  contentHash: string
  importedAt: string
  updatedAt: string
  lastOpenedAt: string | null
  progress: number
  locatorJson: string | null
}

export interface TextBookCandidate {
  sourcePath: string
  sourceFileName: string
  title: string
  byteSize: number
  detectedEncoding: string
  preview: string
  hadDecodingErrors: boolean
  browserFile?: File
}

export interface ReaderBookContent { book: ReaderBook; content: string }

export interface ReaderPreferences {
  fontSize: number
  lineHeight: number
  fontFamily: 'serif' | 'sans'
  contentWidth: 640 | 760 | 880
  readingMode: 'chapter-scroll' | 'paged'
  autoOpenRecent: boolean
  openAfterImport: boolean
  autoTurnChapterOnWheel: boolean
  standaloneAlwaysOnTop: boolean
  backgroundOpacity: number
  textColor: string
  textShadow: boolean
  firstLineIndent: number
  restoreShortcut: 'Control+Alt+B' | 'Control+Shift+B' | 'Alt+Shift+B'
}

export interface ReaderBlock {
  id: string
  chapterId: string
  chapterTitle: string
  chapterIndex: number
  blockIndex: number
  blockCount: number
  chapterOffset: number
  startOffset: number
  endOffset: number
  content: string
  showHeading: boolean
  startsMidParagraph: boolean
}

export interface ReaderTocEntry { id: string; title: string; offset: number; blockId: string }
export interface ReaderDocument { blocks: ReaderBlock[]; toc: ReaderTocEntry[]; length: number }
export interface ReaderLine { offset: number; text: string; shouldIndent: boolean }
