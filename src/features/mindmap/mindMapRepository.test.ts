import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMindMap, deleteMindMap, getMindMap, listMindMaps, saveMindMap } from './mindMapRepository'

vi.mock('../../lib/platform', () => ({
  isTauriRuntime: () => false,
  makeId: (() => { let id = 0; return (prefix: string) => `${prefix}-${++id}` })(),
}))

beforeEach(() => localStorage.clear())

describe('local mind maps', () => {
  it('saves and reopens a structured tree and rejects stale writes', async () => {
    const original = await createMindMap()
    const tree = JSON.stringify({ nodeData: { id: 'root', topic: '中心', children: [{ id: 'child', topic: '子节点' }] } })
    const saved = await saveMindMap({ ...original, title: '计划', dataJson: tree })
    expect(await getMindMap(saved.id)).toEqual(saved)
    expect((await listMindMaps())[0].dataJson).toBe(tree)
    await expect(saveMindMap({ ...original, title: '过期版本' })).rejects.toThrow('已被修改或删除')
    expect((await getMindMap(saved.id))?.title).toBe('计划')
    await expect(deleteMindMap(original)).rejects.toThrow('已被修改或删除')
    await deleteMindMap(saved)
    expect(await listMindMaps()).toEqual([])
  })

  it('does not overwrite an existing map with invalid data', async () => {
    const original = await createMindMap()
    await expect(saveMindMap({ ...original, dataJson: '{}' })).rejects.toThrow('数据格式错误')
    expect(await getMindMap(original.id)).toEqual(original)
  })
})
