import { describe, expect, it } from 'vitest'
import {
  normalizedTrashIds,
  retainExistingTrashSelection,
  selectFilteredTrashIds,
  toggleTrashSelection,
} from './trashSelection'

describe('trash selection helpers', () => {
  it('keeps an explicit set and toggles only the clicked record', () => {
    let selected = new Set(['note-a'])
    selected = toggleTrashSelection(selected, 'note-b')
    selected = toggleTrashSelection(selected, 'note-a')

    expect([...selected]).toEqual(['note-b'])
  })

  it('selects only the current filtered result instead of hidden records', () => {
    const selected = selectFilteredTrashIds(['note-b', 'note-c', 'note-b'])

    expect([...selected]).toEqual(['note-b', 'note-c'])
    expect(selected.has('note-a')).toBe(false)
  })

  it('drops records removed by a completed batch and rejects empty identifiers', () => {
    expect(normalizedTrashIds(['note-a', '', 'note-a', 'note-b'])).toEqual(['note-a', 'note-b'])
    expect([...retainExistingTrashSelection(new Set(['note-a', 'note-b']), ['note-b'])]).toEqual(['note-b'])
  })
})
