import type { NoteRecord } from './types'

export type NewNoteEntrySource = 'tray' | 'sidebar' | 'notes-page'

interface EntryDependencies {
  create(): Promise<NoteRecord>
  open(note: NoteRecord): Promise<unknown>
  afterOpen(): Promise<void>
}

export async function executeNewNoteEntry(
  source: NewNoteEntrySource,
  dependencies: EntryDependencies,
): Promise<NoteRecord> {
  const note = await dependencies.create()
  if (source === 'notes-page') return note
  await dependencies.open(note)
  await dependencies.afterOpen()
  return note
}

export async function executeIndependentWindowEntry(
  saveSelected: () => Promise<NoteRecord>,
  dependencies: Pick<EntryDependencies, 'open' | 'afterOpen'>,
): Promise<NoteRecord> {
  const saved = await saveSelected()
  await dependencies.open(saved)
  await dependencies.afterOpen()
  return saved
}
