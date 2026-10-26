import { describe, expect, it } from 'vitest'
import { blockIndexForOffset, buildReaderDocument, isBasicChapterHeading, linesForBlock, parseReaderLocator, progressForOffset } from './readerLogic'

describe('TXT reader indexing and bounded rendering', () => {
  it('recognizes common chapter headings', () => {
    expect(isBasicChapterHeading('第一章 初见')).toBe(true)
    expect(isBasicChapterHeading('Chapter 12 Return')).toBe(true)
    expect(isBasicChapterHeading('这是一段普通正文。')).toBe(false)
  })

  it('keeps front matter and real chapter titles in the toc', () => {
    const document = buildReaderDocument('书名\n作者\n\n第一章 开始\n第一段\n第二章 继续\n第二段')
    expect(document.toc.map((entry) => entry.title)).toEqual(['第一章 开始', '第二章 继续'])
    expect(document.blocks[0].chapterTitle).toBe('正文之前')
    expect(document.blocks.map((block) => block.content).join('')).toContain('第一段\n')
  })

  it('splits heading-free and oversized chapters without losing text', () => {
    const source = Array.from({ length: 17 }, (_, index) => `第 ${index} 行内容`).join('\n')
    const document = buildReaderDocument(source, 34, 4)
    expect(document.blocks.length).toBeGreaterThan(3)
    expect(document.blocks.map((block) => block.content).join('')).toBe(source)
    expect(document.toc).toEqual([])
  })

  it('keeps internal blocks out of the real chapter toc', () => {
    const document = buildReaderDocument(`第一章 超长\n${'正文一行\n'.repeat(20)}`, 30, 3)
    expect(document.blocks.length).toBeGreaterThan(2)
    expect(document.toc).toHaveLength(1)
    expect(document.blocks.filter((block) => block.showHeading)).toHaveLength(1)
  })

  it('migrates old percentage progress and resolves its block', () => {
    const document = buildReaderDocument('a\n'.repeat(100), 40, 10)
    const locator = parseReaderLocator(null, document.length, 0.5)
    expect(locator.offset).toBe(document.length / 2)
    expect(blockIndexForOffset(document.blocks, locator.offset)).toBeGreaterThan(0)
    expect(progressForOffset(locator.offset, document.length)).toBe(0.5)
  })

  it('exposes stable line offsets for restoration', () => {
    const block = buildReaderDocument('第一行\n第二行\n第三行', 100, 100).blocks[0]
    expect(linesForBlock(block)).toEqual([
      { offset: 0, text: '第一行', shouldIndent: true },
      { offset: 4, text: '第二行', shouldIndent: true },
      { offset: 8, text: '第三行', shouldIndent: true },
    ])
  })

  it('avoids adding display indentation to blank and already-indented lines', () => {
    const block = buildReaderDocument('普通段落\n　已有缩进\n\n\t制表符缩进', 100, 100).blocks[0]
    expect(linesForBlock(block).map((line) => line.shouldIndent)).toEqual([true, false, false, false])
  })
})
