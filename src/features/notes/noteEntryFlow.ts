import type { NoteRecord } from './types'

export type NewNoteEntrySource = 'tray' | 'sidebar' | 'notes-page'

interface EntryDependencies {
  create(): Promise<NoteRecord>
  open(note: NoteRecord): Promise<unknown>
  hideMain(): Promise<void>
}

export async function executeNewNoteEntry(
  source: NewNoteEntrySource,
  dependencies: EntryDependencies,
): Promise<NoteRecord> {
  const note = await dependencies.create()
  if (source === 'notes-page') return note
  await dependencies.open(note)
  if (source === 'sidebar') await dependencies.hideMain()
  return note
}

export async function executeIndependentWindowEntry(
  saveSelected: () => Promise<NoteRecord>,
  dependencies: Pick<EntryDependencies, 'open' | 'hideMain'>,
): Promise<NoteRecord> {
  const saved = await saveSelected()
  await dependencies.open(saved)
  await dependencies.hideMain()
  return saved
}
