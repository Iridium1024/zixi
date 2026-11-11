import { PRESET_RULES, type ComparisonRule, type ComparePreset, type SourceToken } from './types'

const horizontalWhitespace = /^[\t \u00a0]+$/u
const anyWhitespace = /^\s+$/u

function createSegmenter(granularity: 'grapheme' | 'word') {
  return new Intl.Segmenter('zh-CN', { granularity })
}

function normalizeRule(rule: ComparisonRule | ComparePreset): ComparisonRule {
  return typeof rule === 'string' ? PRESET_RULES[rule] : rule
}

function normalizeKey(text: string, rule: ComparisonRule): string {
  if (rule.whitespace === 'all' && rule.unicode === 'none' && rule.caseSensitive) return text
  const normalizedNewlines = text.replace(/\r\n?|\n/gu, '\n')
  if (rule.whitespace === 'collapse' && anyWhitespace.test(normalizedNewlines)) return ' '
  const unicode = rule.unicode === 'none'
    ? normalizedNewlines
    : normalizedNewlines.normalize(rule.unicode === 'nfkc' ? 'NFKC' : 'NFC')
  return rule.caseSensitive ? unicode : unicode.toLocaleLowerCase('zh-CN')
}

function isTrailingHorizontalWhitespace(source: string, token: SourceToken): boolean {
  if (!horizontalWhitespace.test(token.text)) return false
  let end = token.end
  while (end < source.length && /[\t \u00a0]/u.test(source[end])) end += 1
  return end >= source.length || source[end] === '\r' || source[end] === '\n'
}

/** Whole-input equality must have the same meaning at every document size. */
export function comparisonKey(source: string, rule: ComparisonRule): string {
  if (rule.whitespace === 'all' && rule.unicode === 'none' && rule.caseSensitive) return source
  let key = source.replace(/\r\n?|\n/gu, '\n')
  if (rule.whitespace === 'trim-trailing') key = key.replace(/[\t \u00a0]+(?=\n|$)/gu, '')
  if (rule.unicode !== 'none') key = key.normalize(rule.unicode === 'nfkc' ? 'NFKC' : 'NFC')
  if (!rule.caseSensitive) key = key.toLocaleLowerCase('zh-CN')
  return rule.whitespace === 'collapse' ? key.replace(/\s+/gu, ' ') : key
}

function mergeCollapsedWhitespace(tokens: SourceToken[]): SourceToken[] {
  const merged: SourceToken[] = []
  for (const token of tokens) {
    const previous = merged.at(-1)
    if (token.key === ' ' && previous?.key === ' ') {
      previous.text += token.text
      previous.end = token.end
    } else {
      merged.push({ ...token })
    }
  }
  return merged
}

export function tokenizeSource(
  source: string,
  requestedRule: ComparisonRule | ComparePreset,
  granularity?: 'grapheme' | 'word',
  baseOffset = 0,
  preserveWhitespace = false,
): SourceToken[] {
  if (!source) return []
  const rule = normalizeRule(requestedRule)
  const segmenter = createSegmenter(granularity ?? (rule.preset === 'exact' ? 'grapheme' : 'word'))
  const tokens: SourceToken[] = []
  for (const segment of segmenter.segment(source)) {
    const start = baseOffset + segment.index
    const token: SourceToken = {
      text: segment.segment,
      key: normalizeKey(segment.segment, rule),
      start,
      end: start + segment.segment.length,
    }
    if (!preserveWhitespace && rule.whitespace === 'trim-trailing' && isTrailingHorizontalWhitespace(source, {
      ...token,
      start: segment.index,
      end: segment.index + segment.segment.length,
    })) continue
    tokens.push(token)
  }
  return rule.whitespace === 'collapse' ? mergeCollapsedWhitespace(tokens) : tokens
}

export function refineTokensToGraphemes(tokens: SourceToken[], rule: ComparisonRule, source: string): SourceToken[] {
  // Trailing whitespace was already removed using the complete source.
  return tokens.flatMap((token) => tokenizeSource(token.text, rule, 'grapheme', token.start, true))
    .filter((token) => rule.whitespace !== 'trim-trailing' || !isTrailingHorizontalWhitespace(source, token))
}

export function countGraphemes(value: string): number {
  return value ? Array.from(createSegmenter('grapheme').segment(value)).length : 0
}
