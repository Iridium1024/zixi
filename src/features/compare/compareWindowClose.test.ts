import { describe, expect, it, vi } from 'vitest'
import { coordinateCompareWindowClose, type ComparisonSaveResult } from './compareWindowClose'

describe('coordinateCompareWindowClose', () => {
  it('destroys a clean window without saving', async () => {
    const save = vi.fn<() => Promise<ComparisonSaveResult>>()
    const destroy = vi.fn(async () => undefined)

    await expect(coordinateCompareWindowClose({ hasUnsavedChanges: () => false, save, destroy }))
      .resolves.toEqual({ status: 'clean' })
    expect(save).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('saves a dirty window before destroying it', async () => {
    let dirty = true
    const save = vi.fn(async (): Promise<ComparisonSaveResult> => {
      dirty = false
      return { status: 'saved' }
    })
    const destroy = vi.fn(async () => undefined)

    await expect(coordinateCompareWindowClose({ hasUnsavedChanges: () => dirty, save, destroy }))
      .resolves.toEqual({ status: 'saved' })
    expect(save).toHaveBeenCalledOnce()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('runs another pass when text changes during the first save', async () => {
    let pendingChanges = 2
    const save = vi.fn(async (): Promise<ComparisonSaveResult> => {
      pendingChanges -= 1
      return { status: 'saved' }
    })
    const destroy = vi.fn(async () => undefined)

    await expect(coordinateCompareWindowClose({ hasUnsavedChanges: () => pendingChanges > 0, save, destroy }))
      .resolves.toEqual({ status: 'saved' })
    expect(save).toHaveBeenCalledTimes(2)
    expect(destroy).toHaveBeenCalledOnce()
  })

  it.each(['conflict', 'failed'] as const)('keeps the window open after a %s save result', async (status) => {
    const save = vi.fn(async (): Promise<ComparisonSaveResult> => status === 'failed'
      ? { status, error: new Error('disk busy') }
      : { status })
    const destroy = vi.fn(async () => undefined)

    const result = await coordinateCompareWindowClose({ hasUnsavedChanges: () => true, save, destroy })
    expect(result.status).toBe(status)
    expect(destroy).not.toHaveBeenCalled()
  })

  it('reports a destroy failure without retrying the close event', async () => {
    const destroyError = new Error('window command rejected')
    const result = await coordinateCompareWindowClose({
      hasUnsavedChanges: () => false,
      save: async () => ({ status: 'clean' }),
      destroy: async () => { throw destroyError },
    })

    expect(result).toEqual({ status: 'failed', phase: 'destroy', error: destroyError })
  })
})
