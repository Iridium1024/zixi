import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useDiffWorker } from './useDiffWorker'
import { compareText } from './diffEngine'
import { PRESET_RULES } from './types'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('invalidates a result immediately after editing and rejects late worker replies', () => {
  vi.useFakeTimers()
  const requests: { requestId: number }[] = []
  let respond!: (event: { data: { requestId: number; result: ReturnType<typeof compareText> } }) => void
  vi.stubGlobal('Worker', class {
    set onmessage(handler: typeof respond) { respond = handler }
    postMessage(message: { requestId: number }) { requests.push(message) }
    terminate() {}
  })
  const { result, rerender } = renderHook(({ text, rule }) => useDiffWorker('原文', text, rule, 10), { initialProps: { text: '旧稿', rule: PRESET_RULES.review } })
  act(() => vi.advanceTimersByTime(10))
  const reply = compareText({ left: '原文', right: '旧稿', preset: 'review' })
  act(() => respond({ data: { requestId: requests[0].requestId, result: reply } }))
  expect(result.current.hasCurrentResult).toBe(true)
  rerender({ text: '新稿', rule: PRESET_RULES.review })
  expect(result.current.hasCurrentResult).toBe(false)
  expect(result.current.result.changes).toEqual([])
  act(() => vi.advanceTimersByTime(10))
  act(() => respond({ data: { requestId: requests[0].requestId, result: reply } }))
  expect(result.current.hasCurrentResult).toBe(false)
  act(() => respond({ data: { requestId: requests[1].requestId, result: reply } }))
  expect(result.current.hasCurrentResult).toBe(true)
  rerender({ text: '新稿', rule: PRESET_RULES.exact })
  expect(result.current.hasCurrentResult).toBe(false)
})
