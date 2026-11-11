import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageSettingsPanel } from './StorageSettingsPanel'

const { invoke, reveal } = vi.hoisted(() => ({ invoke: vi.fn(), reveal: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: reveal }))
vi.mock('../../lib/platform', () => ({ isTauriRuntime: () => true }))

beforeEach(() => {
  invoke.mockReset(); reveal.mockReset()
  invoke.mockImplementation(async (command: string) => {
    if (command === 'get_storage_info') return { dataPath: 'C:\\资料', defaultPath: 'C:\\资料', previousPath: null, pendingPath: null, notice: null }
    if (command === 'pick_storage_directory') return { targetPath: 'D:\\新位置\\ZixiData', fileCount: 6, byteSize: 1048576 }
  })
})
afterEach(cleanup)

async function openPlan(beforeRestart = vi.fn().mockResolvedValue(undefined)) {
  render(<StorageSettingsPanel beforeRestart={beforeRestart} onStatusChange={vi.fn()} />)
  await screen.findByText('C:\\资料')
  fireEvent.click(screen.getByRole('button', { name: '更改存储位置' }))
  await screen.findByRole('dialog', { name: '迁移资料并重启' })
  return beforeRestart
}

describe('storage location settings', () => {
  it('shows the exact destination and permits cancellation without restarting', async () => {
    const beforeRestart = await openPlan()
    expect(screen.getByText('D:\\新位置\\ZixiData')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(beforeRestart).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalledWith('migrate_storage_and_restart', expect.anything())
  })

  it('awaits settings persistence before requesting migration and restart', async () => {
    let finishSave!: () => void
    const beforeRestart = await openPlan(vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve })))
    fireEvent.click(screen.getByRole('button', { name: '迁移并重启' }))
    expect(beforeRestart).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalledWith('migrate_storage_and_restart', expect.anything())
    finishSave()
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('migrate_storage_and_restart', { targetPath: 'D:\\新位置\\ZixiData' }))
  })

  it('keeps the confirmation open after a save failure and does not restart', async () => {
    await openPlan(vi.fn().mockRejectedValue(new Error('设置写入失败')))
    fireEvent.click(screen.getByRole('button', { name: '迁移并重启' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('设置写入失败')
    expect(screen.getByRole('button', { name: '迁移并重启' })).toBeEnabled()
    expect(invoke).not.toHaveBeenCalledWith('migrate_storage_and_restart', expect.anything())
  })
})
