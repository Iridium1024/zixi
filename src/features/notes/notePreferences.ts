import type { NoteRecord } from './types'

export const NOTE_PREFERENCES_STORAGE_KEY = 'zixi.note-preferences.v1'

export type NoteCloseBehavior = 'save' | 'discard' | 'ask'

export interface NotePreferences {
  version: 1
  closeBehavior: NoteCloseBehavior
}

export const DEFAULT_NOTE_PREFERENCES: NotePreferences = {
  version: 1,
  closeBehavior: 'ask',
}

export function normalizeNotePreferences(value: unknown): NotePreferences {
  if (!value || typeof value !== 'object') return DEFAULT_NOTE_PREFERENCES
  const closeBehavior = (value as { closeBehavior?: unknown }).closeBehavior
  if (closeBehavior !== 'save' && closeBehavior !== 'discard' && closeBehavior !== 'ask') {
    return DEFAULT_NOTE_PREFERENCES
  }
  return { version: 1, closeBehavior }
}

export function readCachedNotePreferences(): NotePreferences {
  try {
    const saved = localStorage.getItem(NOTE_PREFERENCES_STORAGE_KEY)
    return saved ? normalizeNotePreferences(JSON.parse(saved)) : DEFAULT_NOTE_PREFERENCES
  } catch {
    return DEFAULT_NOTE_PREFERENCES
  }
}

export function cacheNotePreferences(value: NotePreferences) {
  localStorage.setItem(NOTE_PREFERENCES_STORAGE_KEY, JSON.stringify(value))
}

export function noteContentsEqual(left: NoteRecord | null, right: NoteRecord | null) {
  if (!left || !right) return left === right
  return left.id === right.id
    && left.title === right.title
    && left.content === right.content
    && left.alwaysOnTop === right.alwaysOnTop
    && left.deletedAt === right.deletedAt
    && JSON.stringify(left.style) === JSON.stringify(right.style)
}

export type NoteCloseAction = 'close' | 'save' | 'ask'

export function resolveNoteCloseAction(behavior: NoteCloseBehavior, hasUnsavedChanges: boolean): NoteCloseAction {
  if (!hasUnsavedChanges) return 'close'
  if (behavior === 'save') return 'save'
  if (behavior === 'discard') return 'close'
  return 'ask'
}
