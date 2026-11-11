import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke, load } = vi.hoisted(() => ({ invoke: vi.fn(), load: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load } }))
beforeEach(() => { vi.resetModules(); invoke.mockReset(); load.mockReset() })

describe('shared desktop database', () => {
  it('uses the configured native path and shares concurrent connection requests', async () => {
    const database = { execute: vi.fn(), select: vi.fn() }
    invoke.mockResolvedValue({ databaseUrl: 'sqlite:D:/资料/ZixiData/zixi.db' })
    load.mockResolvedValue(database)
    const { loadDatabase } = await import('./database')
    const [first, second] = await Promise.all([loadDatabase(), loadDatabase()])
    expect(first).toBe(database); expect(second).toBe(database)
    expect(invoke).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledExactlyOnceWith('sqlite:D:/资料/ZixiData/zixi.db')
  })
  it('retries a failed connection without falling back to the old default directory', async () => {
    invoke.mockRejectedValueOnce(new Error('资料目录不可用')).mockResolvedValue({ databaseUrl: 'sqlite:D:/ZixiData/zixi.db' })
    load.mockResolvedValue({})
    const { loadDatabase } = await import('./database')
    await expect(loadDatabase()).rejects.toThrow('资料目录不可用')
    await loadDatabase()
    expect(load).toHaveBeenCalledExactlyOnceWith('sqlite:D:/ZixiData/zixi.db')
  })
})
