import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({ isTauriRuntime: vi.fn(), writeText: vi.fn() }))
vi.mock('./platform', () => ({ isTauriRuntime: mocked.isTauriRuntime }))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ writeText: mocked.writeText }))
import { copyText } from './copyText'

beforeEach(() => {
  mocked.isTauriRuntime.mockReset().mockReturnValue(true)
  mocked.writeText.mockReset().mockResolvedValue(undefined)
})

describe('desktop clipboard', () => {
  it('uses the Tauri clipboard writer after asynchronous data reads', async () => {
    await copyText('索引')
    expect(mocked.writeText).toHaveBeenCalledWith('索引')
  })
  it('reports clipboard errors', async () => {
    mocked.writeText.mockRejectedValueOnce(new Error('clipboard busy'))
    await expect(copyText('索引')).rejects.toThrow('写入剪贴板失败')
  })
})
