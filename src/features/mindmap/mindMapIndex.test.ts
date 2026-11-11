import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MindMapRecord } from './mindMapRepository'

const mocked = vi.hoisted(() => ({ getMindMap: vi.fn(), copyText: vi.fn(), write: vi.fn(), isTauriRuntime: vi.fn() }))
vi.mock('./mindMapRepository', () => ({ getMindMap: mocked.getMindMap }))
vi.mock('../../lib/copyText', () => ({ copyText: mocked.copyText }))
vi.mock('../../lib/collaborationSnapshot', () => ({ writeCollaborationSnapshot: mocked.write }))
vi.mock('../../lib/platform', () => ({ isTauriRuntime: mocked.isTauriRuntime }))
import { applyMindMapSnapshot, copyMindMapIndex, formatMindMapSnapshot } from './mindMapIndex'

const map: MindMapRecord = {
  id: 'map-id', title: '计划', createdAt: '2026-01-01', updatedAt: '2026-02-01',
  dataJson: JSON.stringify({ nodeData: { id: 'root', topic: '中心', children: [{ id: 'child', topic: '原文', expanded: false }] } }),
}
beforeEach(() => {
  mocked.getMindMap.mockReset().mockResolvedValue(map)
  mocked.copyText.mockReset().mockResolvedValue(undefined)
  mocked.write.mockReset().mockResolvedValue('C:\\snapshots\\map.json')
  mocked.isTauriRuntime.mockReset().mockReturnValue(true)
})

describe('mind map collaboration snapshot', () => {
  it('writes structured data and copies only the path', async () => {
    await copyMindMapIndex(map.id)
    expect(mocked.write).toHaveBeenCalledWith('mindmap', formatMindMapSnapshot(map))
    expect(mocked.copyText).toHaveBeenCalledWith('C:\\snapshots\\map.json')
  })
  it('applies external text while preserving existing fold states', () => {
    const snapshot = JSON.parse(formatMindMapSnapshot(map))
    snapshot.data.nodeData.children[0].topic = '外部修改'
    snapshot.data.nodeData.children[0].expanded = true
    snapshot.data.nodeData.children.push({ id: 'new', topic: '新节点' })
    const updated = applyMindMapSnapshot(JSON.stringify(snapshot), map)
    const nodes = JSON.parse(updated.dataJson).nodeData.children
    expect(nodes[0]).toMatchObject({ id: 'child', topic: '外部修改', expanded: false })
    expect(nodes[1].topic).toBe('新节点')
  })
  it('rejects stale, foreign and structurally invalid files', () => {
    const snapshot = JSON.parse(formatMindMapSnapshot(map))
    expect(() => applyMindMapSnapshot(JSON.stringify(snapshot), { ...map, updatedAt: 'later' })).toThrow('版本冲突')
    expect(() => applyMindMapSnapshot(JSON.stringify(snapshot), { ...map, id: 'another' })).toThrow('另一张导图')
    snapshot.data.nodeData.children.push({ id: 'child', topic: '重复' })
    expect(() => applyMindMapSnapshot(JSON.stringify(snapshot), map)).toThrow('重复节点')
    snapshot.data.nodeData.children.pop()
    snapshot.data.nodeData.children[0].dangerouslySetInnerHTML = '<script>x</script>'
    expect(() => applyMindMapSnapshot(JSON.stringify(snapshot), map)).toThrow('自定义 HTML')
    delete snapshot.data.nodeData.children[0].dangerouslySetInnerHTML
    snapshot.data.nodeData.children = []
    expect(() => applyMindMapSnapshot(JSON.stringify(snapshot), map)).toThrow('缺少已有节点 ID')
    snapshot.data.nodeData.children = [{ id: 'child', topic: '原文' }]
    snapshot.data.arrows = [{ id: 'arrow', label: '', from: 'root', to: 'missing' }]
    expect(() => applyMindMapSnapshot(JSON.stringify(snapshot), map)).toThrow('关联线引用无效')
  })
  it('allows a deliberate node deletion when its ID is explicitly listed', () => {
    const snapshot = JSON.parse(formatMindMapSnapshot(map))
    snapshot.data.nodeData.children = []
    snapshot.removedNodeIds = ['child']
    expect(JSON.parse(applyMindMapSnapshot(JSON.stringify(snapshot), map).dataJson).nodeData.children).toEqual([])
    snapshot.removedNodeIds = ['root']
    expect(() => applyMindMapSnapshot(JSON.stringify(snapshot), map)).toThrow('不一致')
  })
  it('does not copy a missing record or a failed snapshot', async () => {
    mocked.getMindMap.mockResolvedValueOnce(null)
    await expect(copyMindMapIndex(map.id)).rejects.toThrow('未找到')
    mocked.write.mockRejectedValueOnce(new Error('disk full'))
    await expect(copyMindMapIndex(map.id)).rejects.toThrow('disk full')
    expect(mocked.copyText).not.toHaveBeenCalled()
  })
})
