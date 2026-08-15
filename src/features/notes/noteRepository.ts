import { makeId, isTauriRuntime } from '../../lib/platform'
import { publishNoteEvent, type NoteDomainAction } from './noteEvents'
import {
  DEFAULT_NOTE_STYLE,
  type NoteRecord,
  type NoteRevision,
  type NoteStyle,
} from './types'

const NOTES_KEY = 'zixi.notes.v1'
const REVISIONS_KEY = 'zixi.revisions.v1'
const REVISION_LIMIT = 10
const AUTO_REVISION_INTERVAL_MS = 5 * 60 * 1000

interface SqlExecuteResult {
  rowsAffected: number
  lastInsertId?: number
}

interface SqlDatabase {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>
  execute(query: string, bindValues?: unknown[]): Promise<SqlExecuteResult>
}

interface AtomicNoteSaveResult {
  status: 'updated' | 'unchanged' | 'conflict' | 'missing'
  updatedAt: string | null
  previousDeletedAt: string | null
}

export interface BatchTrashMutationResult {
  noteIds: string[]
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

export type RevisionMode = 'auto' | 'protection' | 'none'
export interface SaveNoteOptions {
  revisionMode?: RevisionMode
  emitEvent?: boolean
}

export class NoteConflictError extends Error {
  readonly persisted: NoteRecord | null
  readonly draft: NoteRecord

  constructor(draft: NoteRecord, persisted: NoteRecord | null) {
    super('NOTE_CONFLICT: 便签已在另一个窗口更新，当前编辑未覆盖已保存内容')
    this.name = 'NoteConflictError'
    this.draft = draft
    this.persisted = persisted
  }
}

let databasePromise: Promise<SqlDatabase | null> | undefined

async function getDatabase(): Promise<SqlDatabase | null> {
  if (!isTauriRuntime()) return null
  if (!databasePromise) {
    databasePromise = import('@tauri-apps/plugin-sql')
      .then(async ({ default: Database }) => {
        const database = await Database.load('sqlite:zixi.db') as SqlDatabase
        await database.execute('PRAGMA journal_mode = WAL')
        await database.execute('PRAGMA foreign_keys = ON')
        return database
      })
      .catch((error) => {
        console.error('无法打开本地数据库', error)
        throw error
      })
  }
  return databasePromise
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') as T
  } catch {
    return fallback
  }
}

function writeLocal(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

function mapNote(row: Record<string, unknown>): NoteRecord {
  const storedStyle = JSON.parse(String(row.style_json)) as Partial<NoteStyle>
  return {
    id: String(row.id),
    title: String(row.title),
    content: String(row.content),
    style: {
      ...DEFAULT_NOTE_STYLE,
      ...storedStyle,
      usesDefaultFont: Object.hasOwn(storedStyle, 'usesDefaultFont')
        ? Boolean(storedStyle.usesDefaultFont)
        : false,
    },
    alwaysOnTop: Boolean(row.always_on_top),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
  }
}

function mapRevision(row: Record<string, unknown>): NoteRevision {
  return {
    id: String(row.id),
    noteId: String(row.note_id),
    title: String(row.title),
    content: String(row.content),
    kind: row.kind === 'protection' ? 'protection' : 'auto',
    createdAt: String(row.created_at),
  }
}

function normalizeLocalNote(note: NoteRecord): NoteRecord {
  const storedStyle = note.style as Partial<NoteStyle>
  return {
    ...note,
    style: {
      ...DEFAULT_NOTE_STYLE,
      ...storedStyle,
      usesDefaultFont: Object.hasOwn(storedStyle, 'usesDefaultFont')
        ? Boolean(storedStyle.usesDefaultFont)
        : false,
    },
  }
}

function normalizeLocalRevision(revision: NoteRevision): NoteRevision {
  return { ...revision, kind: revision.kind === 'protection' ? 'protection' : 'auto' }
}

function samePersistedNote(left: NoteRecord, right: NoteRecord): boolean {
  return left.title === right.title
    && left.content === right.content
    && left.alwaysOnTop === right.alwaysOnTop
    && left.deletedAt === right.deletedAt
    && JSON.stringify(left.style) === JSON.stringify(right.style)
}

function contentChanged(left: NoteRecord, right: NoteRecord) {
  return left.title !== right.title || left.content !== right.content
}

function shouldCreateRevision(
  previous: NoteRecord,
  updated: NoteRecord,
  latestRevision: NoteRevision | null,
  revisionMode: RevisionMode,
) {
  if (revisionMode === 'none' || !contentChanged(previous, updated)) return false
  if (revisionMode === 'protection') return true
  if (!latestRevision) return true
  return Date.parse(updated.updatedAt) - Date.parse(latestRevision.createdAt) >= AUTO_REVISION_INTERVAL_MS
}

function nextUpdatedAt(previous?: string): string {
  const previousTime = previous ? Date.parse(previous) : Number.NaN
  return new Date(Math.max(Date.now(), Number.isNaN(previousTime) ? 0 : previousTime + 1)).toISOString()
}

function actionForSave(previous: NoteRecord, updated: NoteRecord): NoteDomainAction {
  if (!previous.deletedAt && updated.deletedAt) return 'trashed'
  if (previous.deletedAt && !updated.deletedAt) return 'restored'
  return 'updated'
}

async function emitMutation(action: NoteDomainAction, note: NoteRecord) {
  await publishNoteEvent({ noteId: note.id, action, updatedAt: note.updatedAt }).catch((error) => {
    console.warn('便签已保存，但跨窗口通知发送失败', error)
  })
}

export async function listNotes(includeDeleted = false): Promise<NoteRecord[]> {
  const database = await getDatabase()
  if (database) {
    const where = includeDeleted ? '' : 'WHERE deleted_at IS NULL'
    const rows = await database.select<Record<string, unknown>[]>(
      `SELECT * FROM notes ${where} ORDER BY updated_at DESC`,
    )
    return rows.map(mapNote)
  }
  return readLocal<NoteRecord[]>(NOTES_KEY, [])
    .map(normalizeLocalNote)
    .filter((note) => includeDeleted || !note.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getNote(id: string): Promise<NoteRecord | null> {
  const database = await getDatabase()
  if (database) {
    const rows = await database.select<Record<string, unknown>[]>(
      'SELECT * FROM notes WHERE id = $1 LIMIT 1',
      [id],
    )
    return rows[0] ? mapNote(rows[0]) : null
  }
  const note = readLocal<NoteRecord[]>(NOTES_KEY, []).find((item) => item.id === id)
  return note ? normalizeLocalNote(note) : null
}

export async function createNote(
  initial: Partial<Pick<NoteRecord, 'title' | 'content' | 'style' | 'alwaysOnTop'>> = {},
): Promise<NoteRecord> {
  const now = new Date().toISOString()
  const note: NoteRecord = {
    id: makeId('note'),
    title: initial.title ?? '未命名便签',
    content: initial.content ?? '',
    style: { ...DEFAULT_NOTE_STYLE, ...initial.style },
    alwaysOnTop: initial.alwaysOnTop ?? true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
  const database = await getDatabase()
  if (database) {
    await database.execute(
      `INSERT INTO notes
        (id, title, content, style_json, always_on_top, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)`,
      [note.id, note.title, note.content, JSON.stringify(note.style), note.alwaysOnTop ? 1 : 0, now, now],
    )
  } else {
    writeLocal(NOTES_KEY, [note, ...readLocal<NoteRecord[]>(NOTES_KEY, [])])
  }
  await emitMutation('created', note)
  return note
}

async function saveSqlite(
  draft: NoteRecord,
  revisionMode: RevisionMode,
): Promise<{ previous: NoteRecord; updated: NoteRecord } | null> {
  const candidateUpdatedAt = nextUpdatedAt(draft.updatedAt)
  const result = await invokeTauri<AtomicNoteSaveResult>('save_note_atomic', {
    input: {
      id: draft.id,
      title: draft.title,
      content: draft.content,
      styleJson: JSON.stringify(draft.style),
      alwaysOnTop: draft.alwaysOnTop,
      expectedUpdatedAt: draft.updatedAt,
      updatedAt: candidateUpdatedAt,
      deletedAt: draft.deletedAt,
      revisionId: makeId('revision'),
      revisionMode,
    },
  })
  if (result.status === 'conflict' || result.status === 'missing') {
    throw new NoteConflictError(draft, await getNote(draft.id))
  }
  if (result.status === 'unchanged') return null
  const updated = { ...draft, updatedAt: result.updatedAt ?? candidateUpdatedAt }
  const previous = { ...draft, deletedAt: result.previousDeletedAt }
  return { previous, updated }
}

function saveLocal(
  draft: NoteRecord,
  revisionMode: RevisionMode,
): { previous: NoteRecord; updated: NoteRecord } | null {
  const notes = readLocal<NoteRecord[]>(NOTES_KEY, [])
  const previousRaw = notes.find((item) => item.id === draft.id)
  const previous = previousRaw ? normalizeLocalNote(previousRaw) : null
  if (!previous || previous.updatedAt !== draft.updatedAt) {
    if (previous && samePersistedNote(previous, draft)) return null
    throw new NoteConflictError(draft, previous)
  }
  if (samePersistedNote(previous, draft)) return null
  const updated = { ...draft, updatedAt: nextUpdatedAt(previous.updatedAt) }
  const allRevisions = readLocal<NoteRevision[]>(REVISIONS_KEY, []).map(normalizeLocalRevision)
  const noteRevisions = allRevisions.filter((item) => item.noteId === draft.id)
  if (shouldCreateRevision(previous, updated, noteRevisions[0] ?? null, revisionMode)) {
    noteRevisions.unshift({
      id: makeId('revision'),
      noteId: previous.id,
      title: previous.title,
      content: previous.content,
      kind: revisionMode === 'protection' ? 'protection' : 'auto',
      createdAt: updated.updatedAt,
    })
  }
  writeLocal(REVISIONS_KEY, [
    ...noteRevisions.slice(0, REVISION_LIMIT),
    ...allRevisions.filter((item) => item.noteId !== draft.id),
  ])
  writeLocal(NOTES_KEY, notes.map((item) => item.id === updated.id ? updated : item))
  return { previous, updated }
}

export async function saveNote(
  note: NoteRecord,
  options: SaveNoteOptions = {},
): Promise<NoteRecord> {
  const revisionMode = options.revisionMode ?? 'auto'
  const database = await getDatabase()
  const mutation = database
    ? await saveSqlite(note, revisionMode)
    : saveLocal(note, revisionMode)
  if (!mutation) return (await getNote(note.id)) ?? note
  if (options.emitEvent !== false) await emitMutation(actionForSave(mutation.previous, mutation.updated), mutation.updated)
  return mutation.updated
}

export async function moveNoteToTrash(note: NoteRecord) {
  return saveNote({ ...note, deletedAt: new Date().toISOString() }, { revisionMode: 'none' })
}

export async function restoreNote(note: NoteRecord) {
  return saveNote({ ...note, deletedAt: null }, { revisionMode: 'none' })
}

function normalizeBatchIds(ids: Iterable<string>) {
  const normalized = new Set<string>()
  for (const id of ids) {
    if (typeof id === 'string' && id.length > 0) normalized.add(id)
  }
  return [...normalized]
}

export async function restoreNotes(ids: Iterable<string>): Promise<BatchTrashMutationResult> {
  const noteIds = normalizeBatchIds(ids)
  if (!noteIds.length) return { noteIds: [] }
  const database = await getDatabase()
  let restoredIds: string[]
  if (database) {
    const result = await invokeTauri<BatchTrashMutationResult>('restore_notes_atomic', {
      noteIds,
      updatedAt: new Date().toISOString(),
    })
    restoredIds = result.noteIds
  } else {
    const requested = new Set(noteIds)
    const notes = readLocal<NoteRecord[]>(NOTES_KEY, []).map(normalizeLocalNote)
    restoredIds = notes
      .filter((note) => requested.has(note.id) && Boolean(note.deletedAt))
      .map((note) => note.id)
      .sort()
    const restored = new Set(restoredIds)
    writeLocal(NOTES_KEY, notes.map((note) => restored.has(note.id)
      ? { ...note, deletedAt: null, updatedAt: nextUpdatedAt(note.updatedAt) }
      : note))
  }
  if (restoredIds.length) {
    await publishNoteEvent({ noteId: null, noteIds: restoredIds, action: 'restored', updatedAt: new Date().toISOString() })
      .catch((error) => console.warn('便签已批量恢复，但跨窗口通知发送失败', error))
  }
  return { noteIds: restoredIds }
}

export async function permanentlyDeleteNote(id: string): Promise<boolean> {
  const database = await getDatabase()
  let deleted: boolean
  if (database) {
    deleted = await invokeTauri<boolean>('permanently_delete_note_atomic', { noteId: id })
  } else {
    const notes = readLocal<NoteRecord[]>(NOTES_KEY, [])
    deleted = notes.some((note) => note.id === id && Boolean(note.deletedAt))
    if (deleted) {
      writeLocal(NOTES_KEY, notes.filter((note) => note.id !== id))
      writeLocal(REVISIONS_KEY, readLocal<NoteRevision[]>(REVISIONS_KEY, []).filter((revision) => revision.noteId !== id))
    }
  }
  if (deleted) {
    await publishNoteEvent({ noteId: id, action: 'deleted', updatedAt: new Date().toISOString() })
      .catch((error) => console.warn('便签已永久删除，但跨窗口通知发送失败', error))
  }
  return deleted
}

export async function permanentlyDeleteNotes(ids: Iterable<string>): Promise<BatchTrashMutationResult> {
  const noteIds = normalizeBatchIds(ids)
  if (!noteIds.length) return { noteIds: [] }
  const database = await getDatabase()
  let deletedIds: string[]
  if (database) {
    const result = await invokeTauri<BatchTrashMutationResult>('permanently_delete_notes_atomic', { noteIds })
    deletedIds = result.noteIds
  } else {
    const requested = new Set(noteIds)
    const notes = readLocal<NoteRecord[]>(NOTES_KEY, [])
    deletedIds = notes
      .filter((note) => requested.has(note.id) && Boolean(note.deletedAt))
      .map((note) => note.id)
      .sort()
    const deleted = new Set(deletedIds)
    writeLocal(NOTES_KEY, notes.filter((note) => !deleted.has(note.id)))
    writeLocal(REVISIONS_KEY, readLocal<NoteRevision[]>(REVISIONS_KEY, []).filter((revision) => !deleted.has(revision.noteId)))
  }
  if (deletedIds.length) {
    await publishNoteEvent({ noteId: null, noteIds: deletedIds, action: 'deleted', updatedAt: new Date().toISOString() })
      .catch((error) => console.warn('便签已批量永久删除，但跨窗口通知发送失败', error))
  }
  return { noteIds: deletedIds }
}

export async function emptyTrash(): Promise<{ count: number; noteIds: string[] }> {
  const database = await getDatabase()
  let noteIds: string[]
  if (database) {
    const result = await invokeTauri<{ noteIds: string[] }>('empty_trash_atomic')
    noteIds = result.noteIds
  } else {
    const notes = readLocal<NoteRecord[]>(NOTES_KEY, [])
    noteIds = notes.filter((note) => note.deletedAt).map((note) => note.id)
    const ids = new Set(noteIds)
    writeLocal(NOTES_KEY, notes.filter((note) => !ids.has(note.id)))
    writeLocal(REVISIONS_KEY, readLocal<NoteRevision[]>(REVISIONS_KEY, []).filter((revision) => !ids.has(revision.noteId)))
  }
  if (noteIds.length) {
    await publishNoteEvent({ noteId: null, noteIds, action: 'trash-cleared', updatedAt: new Date().toISOString() })
      .catch((error) => console.warn('回收站已清空，但跨窗口通知发送失败', error))
  }
  return { count: noteIds.length, noteIds }
}

export async function listRevisions(noteId: string): Promise<NoteRevision[]> {
  const database = await getDatabase()
  if (database) {
    const rows = await database.select<Record<string, unknown>[]>(
      'SELECT * FROM note_revisions WHERE note_id = $1 ORDER BY created_at DESC LIMIT $2',
      [noteId, REVISION_LIMIT],
    )
    return rows.map(mapRevision)
  }
  return readLocal<NoteRevision[]>(REVISIONS_KEY, [])
    .map(normalizeLocalRevision)
    .filter((revision) => revision.noteId === noteId)
    .slice(0, REVISION_LIMIT)
}

export async function applyRevision(note: NoteRecord, revision: NoteRevision) {
  return saveNote(
    { ...note, title: revision.title, content: revision.content },
    { revisionMode: 'protection' },
  )
}

export async function createConflictCopy(note: NoteRecord): Promise<NoteRecord> {
  return createNote({
    title: `${note.title || '未命名便签'}（冲突副本）`,
    content: note.content,
    style: note.style,
    alwaysOnTop: note.alwaysOnTop,
  })
}

export async function resetNotesUsingFont(internalFamily: string): Promise<number> {
  const notes = await listNotes(true)
  const affected = notes.filter((note) => note.style.fontFamily.includes(internalFamily))
  for (const note of affected) {
    await saveNote({
      ...note,
      style: { ...note.style, fontFamily: DEFAULT_NOTE_STYLE.fontFamily, usesDefaultFont: true },
    }, { revisionMode: 'none' })
  }
  return affected.length
}

export const NOTE_REVISION_POLICY = {
  limit: REVISION_LIMIT,
  autoIntervalMs: AUTO_REVISION_INTERVAL_MS,
} as const
