import { describe, expect, it } from 'vitest'
import { ComparisonConflictError, comparisonDraftFromTransport, comparisonSaveTransport, loadComparison, saveComparison } from './comparisonRepository'

describe('comparison repository browser fallback', () => {
  it('uses a revision token so a stale writer cannot silently overwrite current text', async () => {
    localStorage.clear()
    const first = await saveComparison({ leftText: '窗口 A', rightText: '修改 A', preset: 'review', stats: { insertedCharacters: 0, deletedCharacters: 0, replacementGroups: 0, totalChanges: 0 } }, null)
    await expect(saveComparison({ leftText: '窗口 B', rightText: '修改 B', preset: 'review', stats: first.stats }, 0)).rejects.toBeInstanceOf(ComparisonConflictError)
    expect((await loadComparison())?.leftText).toBe('窗口 A')
  })

  it('maps the Tauri JSON-column transport without losing comparison statistics', () => {
    const transport = comparisonSaveTransport({
      leftText: '原文', rightText: '修改稿', preset: 'review',
      stats: { insertedCharacters: 2, deletedCharacters: 1, replacementGroups: 1, totalChanges: 3 },
    }, 7)
    expect(transport.statsJson).toContain('insertedCharacters')
    expect(comparisonDraftFromTransport({ ...transport, revision: 8 })).toMatchObject({
      leftText: '原文', rightText: '修改稿', revision: 8,
      stats: { insertedCharacters: 2, deletedCharacters: 1, replacementGroups: 1, totalChanges: 3 },
    })
  })
})
