import { describe, expect, it } from 'vitest'
import { accumulateBoundaryWheel, adjacentChapterBlockIndex, EMPTY_WHEEL_ACCUMULATOR, keyboardReaderDirection } from './readerNavigation'
import type { ReaderBlock } from './types'

const block = (chapterId: string, blockIndex: number): ReaderBlock => ({ id: `${chapterId}-${blockIndex}`, chapterId, chapterTitle: chapterId, chapterIndex: 0, blockIndex, blockCount: 2, chapterOffset: 0, startOffset: 0, endOffset: 10, content: '', showHeading: false, startsMidParagraph: false })

describe('reader navigation', () => {
  it('maps common pagination keys without hijacking arrows in scroll mode', () => {
    expect(keyboardReaderDirection('PageDown', false, 'chapter-scroll')).toBe(1)
    expect(keyboardReaderDirection(' ', true, 'paged')).toBe(-1)
    expect(keyboardReaderDirection('ArrowDown', false, 'chapter-scroll')).toBe(1)
    expect(keyboardReaderDirection('ArrowRight', false, 'chapter-scroll')).toBeNull()
  })

  it('jumps to the first block of the adjacent chapter', () => {
    const blocks = [block('a', 0), block('a', 1), block('b', 0), block('b', 1), block('c', 0)]
    expect(adjacentChapterBlockIndex(blocks, 1, 1)).toBe(2)
    expect(adjacentChapterBlockIndex(blocks, 3, -1)).toBe(0)
  })

  it('requires deliberate same-direction wheel movement and then cools down', () => {
    const first = accumulateBoundaryWheel(EMPTY_WHEEL_ACCUMULATOR, 40, 1000)
    expect(first.trigger).toBeNull()
    const second = accumulateBoundaryWheel(first.state, 60, 1100)
    expect(second.trigger).toBe(1)
    expect(accumulateBoundaryWheel(second.state, 120, 1200).trigger).toBeNull()
  })
})
