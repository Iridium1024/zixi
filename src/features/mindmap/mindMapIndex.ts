import { writeCollaborationSnapshot } from '../../lib/collaborationSnapshot'
import { copyText } from '../../lib/copyText'
import { isTauriRuntime } from '../../lib/platform'
import { getMindMap, type MindMapRecord } from './mindMapRepository'

type Node = { id: string; topic: string; children?: Node[]; expanded?: boolean; [key: string]: unknown }
type Tree = { nodeData: Node; [key: string]: unknown }

function validateTree(value: unknown): Tree {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('协作文件缺少导图数据')
  const tree = value as Tree
  const stack: unknown[] = [tree.nodeData]
  const ids = new Set<string>()
  const nodes = new Map<string, Node>()
  while (stack.length) {
    const value = stack.pop()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('节点格式无效')
    const node = value as Node
    if (typeof node.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(node.id) || typeof node.topic !== 'string') throw new Error('节点必须包含有效的唯一 id 和文字 topic')
    if (ids.has(node.id)) throw new Error('协作文件包含重复节点 ID')
    if ('dangerouslySetInnerHTML' in node) throw new Error('协作文件不能包含自定义 HTML')
    if (Object.hasOwn(node, 'parent') || Object.hasOwn(node, '__proto__')) throw new Error('节点包含不支持的内部字段')
    if (node.expanded !== undefined && typeof node.expanded !== 'boolean') throw new Error('节点折叠状态无效')
    if (node.children !== undefined && !Array.isArray(node.children)) throw new Error('节点 children 必须是数组')
    ids.add(node.id)
    nodes.set(node.id, node)
    if (node.children) stack.push(...node.children)
  }
  if (tree.arrows !== undefined) {
    if (!Array.isArray(tree.arrows)) throw new Error('导图关联线格式无效')
    for (const value of tree.arrows) {
      if (!value || typeof value !== 'object' || typeof value.id !== 'string' || typeof value.label !== 'string'
        || typeof value.from !== 'string' || !ids.has(value.from) || typeof value.to !== 'string' || !ids.has(value.to)) throw new Error('导图关联线引用无效')
    }
  }
  if (tree.summaries !== undefined) {
    if (!Array.isArray(tree.summaries)) throw new Error('导图概要格式无效')
    for (const value of tree.summaries) {
      if (!value || typeof value !== 'object' || typeof value.id !== 'string' || typeof value.label !== 'string'
        || typeof value.parent !== 'string' || !nodes.has(value.parent) || !Number.isInteger(value.start)
        || !Number.isInteger(value.end) || value.start < 0 || value.end < value.start
        || value.end >= (nodes.get(value.parent)?.children?.length ?? 0)) throw new Error('导图概要引用无效')
    }
  }
  return tree
}

export function formatMindMapSnapshot(map: MindMapRecord): string {
  const data = validateTree(JSON.parse(map.dataJson))
  return JSON.stringify({
    format: 'zixi.mind-map-collaboration', version: 1,
    mapId: map.id, baseUpdatedAt: map.updatedAt, title: map.title,
    instructions: '保留已有节点 ID；如需删除节点，请将所有被删除节点的 ID 写入 removedNodeIds。新增节点须使用唯一 ID。',
    removedNodeIds: [], data,
  }, null, 2)
}

export function applyMindMapSnapshot(text: string, saved: MindMapRecord): MindMapRecord {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error('协作文件不是有效的 JSON') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('协作文件格式无效')
  const snapshot = parsed as Record<string, unknown>
  if (snapshot.format !== 'zixi.mind-map-collaboration' || snapshot.version !== 1) throw new Error('这不是支持的导图协作文件')
  if (snapshot.mapId !== saved.id) throw new Error('协作文件属于另一张导图')
  if (snapshot.baseUpdatedAt !== saved.updatedAt) throw new Error('导图在生成副本后已修改；请保留副本并处理版本冲突')
  if (typeof snapshot.title !== 'string') throw new Error('协作文件中的标题无效')
  const original = validateTree(JSON.parse(saved.dataJson))
  const incoming = validateTree(snapshot.data)
  if (incoming.nodeData.id !== original.nodeData.id) throw new Error('协作文件不能更改根节点 ID')

  // Existing nodes retain their local fold state when external content is applied.
  const existing = new Map<string, Node>()
  const oldStack = [original.nodeData]
  while (oldStack.length) {
    const node = oldStack.pop()!
    existing.set(node.id, node)
    if (node.children) oldStack.push(...node.children)
  }
  const stack = [incoming.nodeData]
  while (stack.length) {
    const node = stack.pop()!
    const before = existing.get(node.id)
    if (before) {
      if (before.expanded === undefined) delete node.expanded
      else node.expanded = before.expanded
    }
    if (node.children) stack.push(...node.children)
  }
  const incomingIds = idsInTree(incoming.nodeData)
  const removed = snapshot.removedNodeIds ?? []
  if (!Array.isArray(removed) || removed.some((id) => typeof id !== 'string') || new Set(removed).size !== removed.length) throw new Error('removedNodeIds 格式无效')
  const removedIds = new Set<string>(removed)
  for (const id of removed) {
    if (id === original.nodeData.id || !existing.has(id) || incomingIds.has(id)) throw new Error('removedNodeIds 与导图节点不一致')
  }
  for (const id of existing.keys()) {
    if (!incomingIds.has(id) && !removedIds.has(id)) throw new Error('协作文件缺少已有节点 ID；请保留原节点或在 removedNodeIds 中明确删除')
  }
  return { ...saved, title: snapshot.title, dataJson: JSON.stringify(incoming) }
}

function idsInTree(root: Node): Set<string> {
  const ids = new Set<string>()
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()!
    ids.add(node.id)
    if (node.children) stack.push(...node.children)
  }
  return ids
}

export async function copyMindMapIndex(id: string): Promise<void> {
  if (!isTauriRuntime()) throw new Error('浏览器预览无法生成桌面导图副本')
  const saved = await getMindMap(id)
  if (!saved) throw new Error('未找到可读取的已保存导图')
  const path = await writeCollaborationSnapshot('mindmap', formatMindMapSnapshot(saved))
  await copyText(path)
}
