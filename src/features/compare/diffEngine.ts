import { diffArrays, type ChangeObject } from 'diff'
import { countGraphemes, refineTokensToGraphemes, tokenizeSource } from './tokenize'
import { PRESET_RULES, type ComparisonRule, type CompareRequest, type DiffChange, type DiffResult, type SourceRange, type SourceToken } from './types'

const DEFAULT_TIMEOUT_MS = 450
const DEFAULT_MAX_EDIT_LENGTH = 30_000
const LARGE_TEXT_THRESHOLD = 100_000

interface EngineOptions { timeoutMs?: number; maxEditLength?: number }

function rangeOf(tokens: SourceToken[]): SourceRange | undefined {
  const first = tokens[0]; const last = tokens.at(-1)
  return first && last ? { start: first.start, end: last.end } : undefined
}

function textOf(tokens: SourceToken[]) { return tokens.map((token) => token.text).join('') }

function buildChange(index: number, kind: DiffChange['kind'], leftTokens: SourceToken[], rightTokens: SourceToken[]): DiffChange {
  const leftRange = rangeOf(leftTokens); const rightRange = rangeOf(rightTokens)
  return { id: `change-${index}-${leftRange?.start ?? 'x'}-${rightRange?.start ?? 'x'}`, kind, leftRange, rightRange, leftText: textOf(leftTokens), rightText: textOf(rightTokens) }
}

function calculateComponents(leftTokens: SourceToken[], rightTokens: SourceToken[], options: Required<EngineOptions>) {
  return diffArrays(leftTokens, rightTokens, { comparator: (left, right) => left.key === right.key, timeout: options.timeoutMs, maxEditLength: options.maxEditLength })
}

function componentsToChanges(components: ChangeObject<SourceToken[]>[], rule: ComparisonRule, options: Required<EngineOptions>, allowRefinement: boolean): DiffChange[] {
  const result: DiffChange[] = []
  for (let index = 0; index < components.length; index += 1) {
    const current = components[index]
    if (!current.added && !current.removed) continue
    const next = components[index + 1]
    const isPair = next && ((current.removed && next.added) || (current.added && next.removed))
    if (isPair) {
      const leftTokens = current.removed ? current.value : next.value
      const rightTokens = current.added ? current.value : next.value
      if (allowRefinement) {
        const refined = calculateComponents(refineTokensToGraphemes(leftTokens, rule), refineTokensToGraphemes(rightTokens, rule), options)
        if (refined) {
          const refinedChanges = componentsToChanges(refined, rule, options, false)
          if (refinedChanges.length) { result.push(...refinedChanges); index += 1; continue }
        }
      }
      result.push(buildChange(result.length, 'replace', leftTokens, rightTokens)); index += 1; continue
    }
    result.push(current.removed
      ? buildChange(result.length, 'delete', current.value, [])
      : buildChange(result.length, 'insert', [], current.value))
  }
  return result.map((change, index) => ({ ...change, id: `change-${index}` }))
}

function ruleFor(request: CompareRequest): ComparisonRule {
  return typeof request.preset === 'string' ? PRESET_RULES[request.preset] : request.preset
}

function lineTokens(source: string, rule: ComparisonRule): SourceToken[] {
  const tokens: SourceToken[] = []
  const linePattern = /.*?(?:\r\n|\r|\n|$)/gu
  let match: RegExpExecArray | null
  while ((match = linePattern.exec(source)) !== null) {
    if (!match[0]) break
    const text = match[0]
    let key = rule.whitespace === 'all' && rule.unicode === 'none' && rule.caseSensitive
      ? text
      : text.replace(/\r\n?|\n/gu, '\n')
    if (rule.whitespace === 'trim-trailing') key = key.replace(/[\t \u00a0]+(?=\n|$)/gu, '')
    if (rule.whitespace === 'collapse') key = key.replace(/\s+/gu, ' ')
    if (rule.unicode !== 'none') key = key.normalize(rule.unicode === 'nfkc' ? 'NFKC' : 'NFC')
    if (!rule.caseSensitive) key = key.toLocaleLowerCase('zh-CN')
    tokens.push({ text, key, start: match.index, end: match.index + text.length })
  }
  return tokens
}

function summarize(changes: DiffChange[]) {
  let insertedCharacters = 0; let deletedCharacters = 0; let replacementGroups = 0
  for (const change of changes) {
    if (change.kind === 'insert') insertedCharacters += countGraphemes(change.rightText)
    else if (change.kind === 'delete') deletedCharacters += countGraphemes(change.leftText)
    else { replacementGroups += 1; insertedCharacters += countGraphemes(change.rightText); deletedCharacters += countGraphemes(change.leftText) }
  }
  return { insertedCharacters, deletedCharacters, replacementGroups, totalChanges: changes.length }
}

function wholeDocumentFallback(request: CompareRequest): DiffChange[] {
  if (request.left === request.right) return []
  if (!request.left) return [buildChange(0, 'insert', [], tokenizeSource(request.right, PRESET_RULES.exact, 'grapheme'))]
  if (!request.right) return [buildChange(0, 'delete', tokenizeSource(request.left, PRESET_RULES.exact, 'grapheme'), [])]
  return [buildChange(0, 'replace', tokenizeSource(request.left, PRESET_RULES.exact, 'grapheme'), tokenizeSource(request.right, PRESET_RULES.exact, 'grapheme'))]
}

export function compareText(request: CompareRequest, engineOptions: EngineOptions = {}): DiffResult {
  const startedAt = performance.now()
  const options: Required<EngineOptions> = { timeoutMs: engineOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxEditLength: engineOptions.maxEditLength ?? DEFAULT_MAX_EDIT_LENGTH }
  const rule = ruleFor(request)
  const shouldStartWithLines = request.left.length + request.right.length >= LARGE_TEXT_THRESHOLD
  const leftTokens = shouldStartWithLines ? lineTokens(request.left, rule) : tokenizeSource(request.left, rule)
  const rightTokens = shouldStartWithLines ? lineTokens(request.right, rule) : tokenizeSource(request.right, rule)
  let components = calculateComponents(leftTokens, rightTokens, options)
  let degraded = shouldStartWithLines
  let message = shouldStartWithLines ? '文本较长，已使用行级比较以保持输入流畅。' : undefined
  if (!components && !shouldStartWithLines) {
    degraded = true; message = '细粒度比较超过计算上限，已退化为行级比较。'
    components = calculateComponents(lineTokens(request.left, rule), lineTokens(request.right, rule), { timeoutMs: Math.max(options.timeoutMs, 700), maxEditLength: Math.max(options.maxEditLength, 100_000) })
  }
  const changes = components ? componentsToChanges(components, rule, options, !degraded) : wholeDocumentFallback(request)
  if (!components) { degraded = true; message = '差异过大，已将全文作为一个替换区间显示。' }
  return { changes, stats: summarize(changes), degraded, message, durationMs: performance.now() - startedAt }
}
