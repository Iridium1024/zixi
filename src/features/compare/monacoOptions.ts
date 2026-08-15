import type { ComparePreferences } from './comparePreferences'

export function monacoWrappingOptions(preferences: ComparePreferences) {
  return {
    wordWrap: preferences.wordWrap === 'window' ? 'on' as const : preferences.wordWrap === 'column' ? 'wordWrapColumn' as const : 'off' as const,
    wordWrapColumn: preferences.wordWrapColumn,
    wrappingIndent: 'same' as const,
    wrappingStrategy: 'advanced' as const,
  }
}
