import { describe, expect, it, vi } from 'vitest'
import {
  createBoundedLayoutScheduler,
  layoutEditorFromContainer,
  measuredEditorLayout,
} from './responsiveLayout'

describe('responsive Monaco layout helpers', () => {
  it('measures the actual host and refuses zero-sized boxes', () => {
    const host = document.createElement('div')
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 400.9, bottom: 240.8, width: 400.9, height: 240.8, toJSON: () => ({}),
    })
    expect(measuredEditorLayout(host)).toEqual({ width: 400, height: 240 })
    const editor = { layout: vi.fn() }
    expect(layoutEditorFromContainer(editor as never, host)).toBe(true)
    expect(editor.layout).toHaveBeenCalledWith({ width: 400, height: 240 }, true)

    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 20, width: 0, height: 20, toJSON: () => ({}),
    })
    expect(measuredEditorLayout(host)).toBeNull()
  })

  it('coalesces a resize into three bounded layout passes', () => {
    const queue: FrameRequestCallback[] = []
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      queue.push(callback)
      return queue.length
    })
    const run = vi.fn()
    const scheduler = createBoundedLayoutScheduler(run, requestFrame, vi.fn())
    scheduler.schedule()
    scheduler.schedule()
    expect(requestFrame).toHaveBeenCalledTimes(1)
    while (queue.length) queue.shift()!(0)
    expect(run).toHaveBeenCalledTimes(3)
  })
})
