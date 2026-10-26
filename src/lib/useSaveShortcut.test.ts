import { describe, expect, it } from 'vitest'
import { isSaveShortcut } from './useSaveShortcut'

describe('isSaveShortcut', () => {
  it('recognizes Ctrl+S and Command+S', () => {
    expect(isSaveShortcut({ ctrlKey: true, metaKey: false, altKey: false, repeat: false, key: 's' })).toBe(true)
    expect(isSaveShortcut({ ctrlKey: false, metaKey: true, altKey: false, repeat: false, key: 'S' })).toBe(true)
  })

  it('ignores repeats, Alt combinations, and other keys', () => {
    expect(isSaveShortcut({ ctrlKey: true, metaKey: false, altKey: false, repeat: true, key: 's' })).toBe(false)
    expect(isSaveShortcut({ ctrlKey: true, metaKey: false, altKey: true, repeat: false, key: 's' })).toBe(false)
    expect(isSaveShortcut({ ctrlKey: true, metaKey: false, altKey: false, repeat: false, key: 'x' })).toBe(false)
  })
})
