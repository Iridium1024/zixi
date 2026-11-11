import { beforeEach, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({ invoke: vi.fn(), isTauriRuntime: vi.fn() }))
vi.mock('./platform', () => ({ isTauriRuntime: mocked.isTauriRuntime }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocked.invoke }))
import { pickMindMapCollaborationFile, writeCollaborationSnapshot } from './collaborationSnapshot'

beforeEach(() => { mocked.invoke.mockReset(); mocked.isTauriRuntime.mockReset().mockReturnValue(true) })

it('uses the desktop snapshot and user-selected import commands', async () => {
  mocked.invoke.mockResolvedValueOnce('C:\\snapshot.json').mockResolvedValueOnce('{"data":{}}')
  await expect(writeCollaborationSnapshot('mindmap', '树')).resolves.toBe('C:\\snapshot.json')
  expect(mocked.invoke).toHaveBeenNthCalledWith(1, 'write_collaboration_snapshot', { kind: 'mindmap', content: '树' })
  await expect(pickMindMapCollaborationFile()).resolves.toBe('{"data":{}}')
  expect(mocked.invoke).toHaveBeenNthCalledWith(2, 'pick_mind_map_collaboration_file')
})

it('does not invoke desktop file commands in browser preview', async () => {
  mocked.isTauriRuntime.mockReturnValue(false)
  await expect(writeCollaborationSnapshot('note', 'text')).rejects.toThrow('浏览器预览')
  expect(mocked.invoke).not.toHaveBeenCalled()
})
