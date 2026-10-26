import { describe, expect, it } from 'vitest'
import { buildReaderDocument } from './readerLogic'

function measure(name: string, content: string) {
  const started = performance.now()
  const document = buildReaderDocument(content)
  const elapsedMs = performance.now() - started
  return {
    name,
    bytes: new TextEncoder().encode(content).byteLength,
    characters: content.length,
    blocks: document.blocks.length,
    chapters: document.toc.length,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    document,
  }
}

describe('reader representative samples', () => {
  it('records environment, size and parsing time without imposing a synthetic timing target', () => {
    const paragraph = '这是一段用于阅读器分块验证的正文，包含中文、标点与稳定换行。'.repeat(12)
    const normalNovel = Array.from({ length: 80 }, (_, index) => `第${index + 1}章 示例\n${paragraph.repeat(3)}\n`).join('')
    const manyChapters = Array.from({ length: 1_200 }, (_, index) => `Chapter ${index + 1}\n短章节 ${index}\n`).join('')
    const noHeading = Array.from({ length: 4_000 }, (_, index) => `普通正文行 ${index} ${paragraph}`).join('\n')
    const hugeSingleChapter = `第一章 超长章节\n${Array.from({ length: 4_000 }, (_, index) => `长章节正文 ${index} ${paragraph}`).join('\n')}`
    const samples = [
      measure('normal-novel', normalNovel),
      measure('many-chapters', manyChapters),
      measure('no-heading-long-text', noHeading),
      measure('huge-single-chapter', hugeSingleChapter),
    ]

    console.info('reader-sample-environment', { node: process.version, platform: process.platform, arch: process.arch })
    console.table(samples.map(({ document: _document, ...row }) => row))
    expect(samples[0].document.toc).toHaveLength(80)
    expect(samples[1].document.toc).toHaveLength(1_200)
    expect(samples[2].document.blocks.map((block) => block.content).join('')).toBe(noHeading)
    expect(samples[2].document.blocks.length).toBeGreaterThan(1)
    expect(samples[3].document.blocks.length).toBeGreaterThan(1)
  })
})
