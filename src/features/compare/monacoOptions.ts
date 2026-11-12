import type { ComparePreferences } from './comparePreferences'

export const MANUSCRIPT_INSET = 16
export const MANUSCRIPT_SCROLLBAR = 7

/** Preserve every number digit at the compact width; content insets are added separately. */
export function compactGutterDecorationWidth(lineHeight: number, digitWidth: number, lineCount: number, lineNumbers: boolean, foldingWidth = 16) {
  if (!lineNumbers) return 8
  const numberWidth = Math.round(Math.max(3, String(Math.max(1, lineCount)).length) * digitWidth)
  return Math.max(4, Math.round((lineHeight + numberWidth + 10 + foldingWidth) * .75) - numberWidth - foldingWidth)
}

export function monacoWrappingOptions(preferences: ComparePreferences) {
  return {
    wordWrap: preferences.wordWrap === 'window' ? 'on' as const : preferences.wordWrap === 'column' ? 'wordWrapColumn' as const : 'off' as const,
    wordWrapColumn: preferences.wordWrapColumn,
    wrappingIndent: 'same' as const,
    wrappingStrategy: 'advanced' as const,
  }
}
