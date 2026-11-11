import type { ComparePreferences } from './comparePreferences'

/** Preserve every number digit; use one compact lane for the change markers. */
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
