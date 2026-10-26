import type { ReaderBlock, ReaderPreferences } from './types'

export type ReaderDirection = -1 | 1

export function keyboardReaderDirection(
  key: string,
  shiftKey: boolean,
  _readingMode: ReaderPreferences['readingMode'],
): ReaderDirection | null {
  if (key === 'PageDown' || (key === ' ' && !shiftKey)) return 1
  if (key === 'PageUp' || (key === ' ' && shiftKey)) return -1
  if (key === 'ArrowDown') return 1
  if (key === 'ArrowUp') return -1
  return null
}

export function adjacentChapterBlockIndex(
  blocks: ReaderBlock[],
  currentIndex: number,
  direction: ReaderDirection,
): number | null {
  const current = blocks[currentIndex]
  if (!current) return null
  if (direction > 0) {
    const index = blocks.findIndex((block, candidate) => candidate > currentIndex && block.chapterId !== current.chapterId)
    return index >= 0 ? index : null
  }
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    if (blocks[index].chapterId !== current.chapterId) {
      const chapterId = blocks[index].chapterId
      while (index > 0 && blocks[index - 1].chapterId === chapterId) index -= 1
      return index
    }
  }
  return null
}

export function isScrollBoundary(
  direction: ReaderDirection,
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
) {
  return direction > 0
    ? scrollTop + clientHeight >= scrollHeight - 4
    : scrollTop <= 4
}

export interface WheelAccumulator { direction: ReaderDirection | 0; distance: number; lastAt: number; lockedUntil: number }

export const EMPTY_WHEEL_ACCUMULATOR: WheelAccumulator = { direction: 0, distance: 0, lastAt: 0, lockedUntil: 0 }

export function accumulateBoundaryWheel(
  state: WheelAccumulator,
  deltaY: number,
  now: number,
  threshold = 96,
): { state: WheelAccumulator; trigger: ReaderDirection | null } {
  if (Math.abs(deltaY) < 1 || now < state.lockedUntil) return { state, trigger: null }
  const direction: ReaderDirection = deltaY > 0 ? 1 : -1
  const expired = now - state.lastAt > 260
  const distance = expired || state.direction !== direction ? Math.abs(deltaY) : state.distance + Math.abs(deltaY)
  if (distance < threshold) return { state: { direction, distance, lastAt: now, lockedUntil: state.lockedUntil }, trigger: null }
  return {
    state: { direction: 0, distance: 0, lastAt: now, lockedUntil: now + 450 },
    trigger: direction,
  }
}
