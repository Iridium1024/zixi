export type ComparePreset = 'exact' | 'review' | 'relaxed'

export type WhitespaceMode = 'all' | 'trim-trailing' | 'collapse'
export type UnicodeMode = 'none' | 'nfc' | 'nfkc'

export interface ComparisonRule {
  preset: ComparePreset | 'custom'
  caseSensitive: boolean
  whitespace: WhitespaceMode
  unicode: UnicodeMode
}

export const PRESET_RULES: Record<ComparePreset, ComparisonRule> = {
  exact: { preset: 'exact', caseSensitive: true, whitespace: 'all', unicode: 'none' },
  review: { preset: 'review', caseSensitive: true, whitespace: 'trim-trailing', unicode: 'nfc' },
  relaxed: { preset: 'relaxed', caseSensitive: false, whitespace: 'collapse', unicode: 'nfkc' },
}

export type ChangeKind = 'insert' | 'delete' | 'replace'

export interface SourceRange {
  start: number
  end: number
}

export interface DiffChange {
  id: string
  kind: ChangeKind
  leftRange?: SourceRange
  rightRange?: SourceRange
  leftText: string
  rightText: string
}

export interface DiffStats {
  insertedCharacters: number
  deletedCharacters: number
  replacementGroups: number
  totalChanges: number
}

export interface DiffResult {
  changes: DiffChange[]
  stats: DiffStats
  degraded: boolean
  message?: string
  durationMs: number
}

export interface CompareRequest {
  left: string
  right: string
  preset: ComparePreset | ComparisonRule
}

export interface SourceToken {
  text: string
  key: string
  start: number
  end: number
}

export const PRESET_DESCRIPTIONS: Record<ComparePreset, string> = {
  exact: '逐个可见字符比较，空格、换行、大小写与标点全部参与。',
  review: '统一 Unicode NFC 与换行格式，并忽略行尾空格。',
  relaxed: '在审阅规则上进一步忽略大小写、连续空白与全角半角形式。',
}
