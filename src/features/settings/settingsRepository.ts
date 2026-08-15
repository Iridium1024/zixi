import { isTauriRuntime } from '../../lib/platform'

export async function loadSetting<T>(key: string): Promise<T | null> {
  if (!isTauriRuntime()) return null
  const { default: Database } = await import('@tauri-apps/plugin-sql')
  const database = await Database.load('sqlite:zixi.db')
  const rows = await database.select<Array<{ value_json: string }>>(
    'SELECT value_json FROM settings WHERE key = $1 LIMIT 1',
    [key],
  )
  return rows[0] ? JSON.parse(rows[0].value_json) as T : null
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  if (!isTauriRuntime()) return
  const { default: Database } = await import('@tauri-apps/plugin-sql')
  const database = await Database.load('sqlite:zixi.db')
  await database.execute(
    `INSERT INTO settings (key, value_json, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
       updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), new Date().toISOString()],
  )
}
