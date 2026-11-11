import { isTauriRuntime, makeId } from '../../lib/platform'
import { publishMindMapEvent } from './mindMapEvents'

export interface MindMapRecord {
  id: string
  title: string
  dataJson: string
  createdAt: string
  updatedAt: string
}

const LOCAL_KEY = 'zixi.mind-maps.v1'

export class MindMapConflictError extends Error {
  constructor() { super('导图已被修改或删除，当前草稿未覆盖原记录'); this.name = 'MindMapConflictError' }
}

async function announce(action: 'created' | 'saved' | 'deleted', map: MindMapRecord) {
  await publishMindMapEvent({ action, mapId: map.id, updatedAt: map.updatedAt }).catch((error) => {
    console.warn('导图已保存，但跨窗口通知失败', error)
  })
}

function readLocal(): MindMapRecord[] {
  const value = localStorage.getItem(LOCAL_KEY)
  if (!value) return []
  const maps: unknown = JSON.parse(value)
  if (!Array.isArray(maps)) throw new Error('导图数据格式错误')
  return maps as MindMapRecord[]
}

async function database() {
  if (!isTauriRuntime()) return null
  const { loadDatabase } = await import('../../lib/database')
  return loadDatabase()
}

function mapRow(row: Record<string, unknown>): MindMapRecord {
  return {
    id: String(row.id), title: String(row.title), dataJson: String(row.data_json),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }
}

function nextTimestamp(previous: string) {
  return new Date(Math.max(Date.now(), (Date.parse(previous) || 0) + 1)).toISOString()
}

export async function listMindMaps(): Promise<MindMapRecord[]> {
  const db = await database()
  if (db) {
    const rows = await db.select<Record<string, unknown>[]>('SELECT * FROM mind_maps ORDER BY updated_at DESC')
    return rows.map(mapRow)
  }
  return readLocal().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getMindMap(id: string): Promise<MindMapRecord | null> {
  const db = await database()
  if (db) {
    const rows = await db.select<Record<string, unknown>[]>('SELECT * FROM mind_maps WHERE id = $1 LIMIT 1', [id])
    return rows[0] ? mapRow(rows[0]) : null
  }
  return readLocal().find((item) => item.id === id) ?? null
}

export async function createMindMap(source?: Pick<MindMapRecord, 'title' | 'dataJson'>): Promise<MindMapRecord> {
  const now = new Date().toISOString()
  const map: MindMapRecord = {
    id: makeId('mindmap'), title: source?.title ?? '未命名导图',
    dataJson: source?.dataJson ?? JSON.stringify({ nodeData: { id: makeId('node'), topic: '中心主题', children: [] } }),
    createdAt: now, updatedAt: now,
  }
  const db = await database()
  if (db) {
    await db.execute('INSERT INTO mind_maps (id, title, data_json, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)',
      [map.id, map.title, map.dataJson, map.createdAt, map.updatedAt])
  } else {
    localStorage.setItem(LOCAL_KEY, JSON.stringify([map, ...readLocal()]))
  }
  await announce('created', map)
  return map
}

export async function saveMindMap(draft: MindMapRecord): Promise<MindMapRecord> {
  // Reject invalid JSON instead of replacing a previously readable map.
  const parsed: unknown = JSON.parse(draft.dataJson)
  if (!parsed || typeof parsed !== 'object' || !('nodeData' in parsed)) throw new Error('导图数据格式错误')
  const updated = { ...draft, updatedAt: nextTimestamp(draft.updatedAt) }
  const db = await database()
  if (db) {
    const result = await db.execute(
      'UPDATE mind_maps SET title = $1, data_json = $2, updated_at = $3 WHERE id = $4 AND updated_at = $5',
      [updated.title, updated.dataJson, updated.updatedAt, updated.id, draft.updatedAt],
    )
    if (result.rowsAffected !== 1) throw new MindMapConflictError()
  } else {
    const maps = readLocal()
    const index = maps.findIndex((map) => map.id === draft.id && map.updatedAt === draft.updatedAt)
    if (index < 0) throw new MindMapConflictError()
    maps[index] = updated
    localStorage.setItem(LOCAL_KEY, JSON.stringify(maps))
  }
  await announce('saved', updated)
  return updated
}

export async function deleteMindMap(map: MindMapRecord): Promise<void> {
  const db = await database()
  if (db) {
    const result = await db.execute('DELETE FROM mind_maps WHERE id = $1 AND updated_at = $2', [map.id, map.updatedAt])
    if (result.rowsAffected !== 1) throw new Error('导图已被修改或删除，请重新打开后再试')
  } else {
    const maps = readLocal()
    if (!maps.some((item) => item.id === map.id && item.updatedAt === map.updatedAt)) throw new Error('导图已被修改或删除，请重新打开后再试')
    localStorage.setItem(LOCAL_KEY, JSON.stringify(maps.filter((item) => item.id !== map.id)))
  }
  await announce('deleted', map)
}
