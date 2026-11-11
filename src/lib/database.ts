import Database from '@tauri-apps/plugin-sql'
import { invoke } from '@tauri-apps/api/core'

// Each webview shares one connection URL for the lifetime of this process.
// Storage changes apply only on restart, so Rust and the SQL plugin never diverge.
let databasePromise: Promise<Database> | undefined

export function loadDatabase(): Promise<Database> {
  if (!databasePromise) {
    databasePromise = invoke<{ databaseUrl: string }>('get_storage_info')
      .then(({ databaseUrl }) => Database.load(databaseUrl))
      .catch((error: unknown) => { databasePromise = undefined; throw error })
  }
  return databasePromise
}
