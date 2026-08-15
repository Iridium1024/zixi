/** Small, deterministic helpers for the explicit trash selection mode. */
export function normalizedTrashIds(ids: Iterable<string>): string[] {
  const selected = new Set<string>()
  for (const id of ids) {
    if (typeof id === 'string' && id.length > 0) selected.add(id)
  }
  return [...selected]
}

export function toggleTrashSelection(selectedIds: ReadonlySet<string>, noteId: string): Set<string> {
  const next = new Set(selectedIds)
  if (next.has(noteId)) next.delete(noteId)
  else next.add(noteId)
  return next
}

/** "Select all" deliberately replaces, rather than expands, the current selection. */
export function selectFilteredTrashIds(filteredIds: Iterable<string>): Set<string> {
  return new Set(normalizedTrashIds(filteredIds))
}

export function retainExistingTrashSelection(
  selectedIds: ReadonlySet<string>,
  existingIds: Iterable<string>,
): Set<string> {
  const existing = new Set(existingIds)
  return new Set([...selectedIds].filter((id) => existing.has(id)))
}
