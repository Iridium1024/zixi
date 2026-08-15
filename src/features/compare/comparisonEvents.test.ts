import { describe, expect, it } from 'vitest'
import { acceptComparisonEvent, type ComparisonSessionEvent } from './comparisonEvents'

const event: ComparisonSessionEvent = {
  eventId: 'event-1', sourceWindow: 'main', sessionId: 'comparison-current', revision: 4, leftText: '原文', rightText: '修改稿',
}

describe('comparison session event policy', () => {
  it('skips its own event and accepts a remote event only once', () => {
    const seen = new Set<string>()
    expect(acceptComparisonEvent(seen, 'main', event)).toBe(false)
    expect(acceptComparisonEvent(seen, 'child', event)).toBe(true)
    expect(acceptComparisonEvent(seen, 'child', event)).toBe(false)
  })
})
