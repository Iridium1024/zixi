import type { ReaderBlock, ReaderDocument, ReaderLine, ReaderLocator } from './types'

const CHAPTER_HEADING = /^(?:第[0-9零〇一二两三四五六七八九十百千万]+[章节卷部篇回](?:\s|[：:、.．-])?.{0,48}|(?:chapter|part)\s+[0-9ivxlcdm]+\b.{0,48}|序章|楔子|引子|前言|后记|尾声|终章|番外(?:\s|[：:、.．-])?.{0,48})$/i
export const DEFAULT_BLOCK_CHARACTER_LIMIT = 24_000
export const DEFAULT_BLOCK_LINE_LIMIT = 500

interface ChapterRange { id: string; title: string; chapterOffset: number; bodyStart: number; end: number; inToc: boolean }

export function isBasicChapterHeading(line: string): boolean {
  const normalized = line.trim()
  return normalized.length > 0 && normalized.length <= 72 && CHAPTER_HEADING.test(normalized)
}

function chapterRanges(content: string): ChapterRange[] {
  const headings: Array<{ title: string; offset: number; bodyStart: number }> = []
  let offset = 0
  while (offset <= content.length) {
    const newline = content.indexOf('\n', offset)
    const lineEnd = newline === -1 ? content.length : newline
    const line = content.slice(offset, lineEnd)
    if (isBasicChapterHeading(line)) headings.push({ title: line.trim(), offset, bodyStart: newline === -1 ? lineEnd : lineEnd + 1 })
    if (newline === -1) break
    offset = newline + 1
  }
  if (headings.length === 0) return [{ id: 'chapter-body', title: '正文', chapterOffset: 0, bodyStart: 0, end: content.length, inToc: false }]
  const chapters: ChapterRange[] = []
  if (headings[0].offset > 0) chapters.push({ id: 'chapter-front', title: '正文之前', chapterOffset: 0, bodyStart: 0, end: headings[0].offset, inToc: false })
  headings.forEach((heading, index) => chapters.push({
    id: `chapter-${index}`,
    title: heading.title,
    chapterOffset: heading.offset,
    bodyStart: heading.bodyStart,
    end: headings[index + 1]?.offset ?? content.length,
    inToc: true,
  }))
  return chapters
}

function splitRange(content: string, start: number, end: number, characterLimit: number, lineLimit: number) {
  if (start >= end) return [{ start, end, startsMidParagraph: false }]
  const ranges: Array<{ start: number; end: number; startsMidParagraph: boolean }> = []
  let blockStart = start
  let cursor = start
  let lines = 0
  while (cursor < end) {
    let next = content.indexOf('\n', cursor)
    next = next === -1 || next >= end ? end : next + 1
    while (next - cursor > characterLimit) {
      if (cursor > blockStart) ranges.push({ start: blockStart, end: cursor, startsMidParagraph: blockStart > start && content[blockStart - 1] !== '\n' })
      const rawEnd = Math.min(end, cursor + characterLimit)
      ranges.push({ start: cursor, end: rawEnd, startsMidParagraph: cursor > start && content[cursor - 1] !== '\n' })
      cursor = rawEnd
      blockStart = cursor
      lines = 0
    }
    if (cursor >= next) continue
    if (cursor > blockStart && (next - blockStart > characterLimit || lines >= lineLimit)) {
      ranges.push({ start: blockStart, end: cursor, startsMidParagraph: blockStart > start && content[blockStart - 1] !== '\n' })
      blockStart = cursor
      lines = 0
    }
    cursor = next
    lines += 1
  }
  if (blockStart < end || ranges.length === 0) ranges.push({ start: blockStart, end, startsMidParagraph: blockStart > start && content[blockStart - 1] !== '\n' })
  return ranges
}

export function buildReaderDocument(content: string, characterLimit = DEFAULT_BLOCK_CHARACTER_LIMIT, lineLimit = DEFAULT_BLOCK_LINE_LIMIT): ReaderDocument {
  if (!content) return { blocks: [], toc: [], length: 0 }
  const blocks: ReaderBlock[] = []
  const toc: ReaderDocument['toc'] = []
  chapterRanges(content).forEach((chapter, chapterIndex) => {
    const ranges = splitRange(content, chapter.bodyStart, chapter.end, characterLimit, lineLimit)
    ranges.forEach((range, blockIndex) => {
      const id = `${chapter.id}-block-${blockIndex}`
      blocks.push({
        id, chapterId: chapter.id, chapterTitle: chapter.title, chapterIndex, blockIndex,
        blockCount: ranges.length, chapterOffset: chapter.chapterOffset,
        startOffset: range.start, endOffset: range.end, content: content.slice(range.start, range.end),
        showHeading: chapter.inToc && blockIndex === 0,
        startsMidParagraph: range.startsMidParagraph,
      })
      if (chapter.inToc && blockIndex === 0) toc.push({ id: chapter.id, title: chapter.title, offset: chapter.chapterOffset, blockId: id })
    })
  })
  return { blocks, toc, length: content.length }
}

export function linesForBlock(block: ReaderBlock): ReaderLine[] {
  const lines: ReaderLine[] = []
  let localOffset = 0
  while (localOffset <= block.content.length) {
    const newline = block.content.indexOf('\n', localOffset)
    const lineEnd = newline === -1 ? block.content.length : newline
    const text = block.content.slice(localOffset, lineEnd)
    lines.push({
      offset: block.startOffset + localOffset,
      text,
      shouldIndent: text.trim().length > 0 && !/^[\s\u3000]/.test(text) && !(localOffset === 0 && block.startsMidParagraph),
    })
    if (newline === -1) break
    localOffset = newline + 1
  }
  return lines
}

export function parseReaderLocator(value: string | null, contentLength: number, fallbackProgress: number): ReaderLocator {
  try {
    const parsed = JSON.parse(value ?? '') as Partial<ReaderLocator>
    if (parsed.version === 1 && typeof parsed.offset === 'number' && Number.isFinite(parsed.offset)) {
      return { version: 1, offset: Math.min(contentLength, Math.max(0, Math.round(parsed.offset))), blockId: typeof parsed.blockId === 'string' ? parsed.blockId : '' }
    }
  } catch { /* Legacy records intentionally fall back to whole-book percentage. */ }
  return { version: 1, offset: Math.round(Math.min(1, Math.max(0, fallbackProgress)) * contentLength), blockId: '' }
}

export function blockIndexForOffset(blocks: ReaderBlock[], offset: number): number {
  if (blocks.length === 0) return -1
  const match = blocks.findIndex((block) => offset < block.endOffset || (block.startOffset === block.endOffset && offset === block.startOffset))
  return match === -1 ? blocks.length - 1 : match
}

export function progressForOffset(offset: number, contentLength: number): number {
  return contentLength <= 0 ? 0 : Math.min(1, Math.max(0, offset / contentLength))
}
