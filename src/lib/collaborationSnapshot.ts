import { isTauriRuntime } from './platform'

export async function writeCollaborationSnapshot(kind: 'note' | 'mindmap', content: string): Promise<string> {
  if (!isTauriRuntime()) throw new Error('浏览器预览无法创建桌面协作文件')
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('write_collaboration_snapshot', { kind, content })
}

export async function pickMindMapCollaborationFile(): Promise<string | null> {
  if (!isTauriRuntime()) throw new Error('浏览器预览无法选择桌面协作文件')
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string | null>('pick_mind_map_collaboration_file')
}
