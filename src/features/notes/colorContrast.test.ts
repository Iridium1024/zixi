import { describe, expect, it } from 'vitest'
import { contrastRatio } from './colorContrast'

describe('contrastRatio', () => {
  it('returns the WCAG maximum for black and white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
  })

  it('detects low-contrast colors', () => {
    expect(contrastRatio('#777777', '#888888')).toBeLessThan(4.5)
  })
})
