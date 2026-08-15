import { describe, expect, it } from 'vitest'
import { compareText } from './diffEngine'

function firstChange(
  left: string,
  right: string,
  preset: 'exact' | 'review' | 'relaxed' = 'review',
) {
  return compareText({ left, right, preset }).changes[0]
}

describe('compareText', () => {
  it('finds an inserted Chinese word and preserves source offsets', () => {
    const result = compareText({
      left: '请在今天提交报告',
      right: '请务必在今天提交报告',
      preset: 'review',
    })

    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]).toMatchObject({
      kind: 'insert',
      rightText: '务必',
      rightRange: { start: 1, end: 3 },
    })
  })

  it('represents changed punctuation as a replacement', () => {
    const change = firstChange('方案完成。', '方案完成！')
    expect(change.kind).toBe('replace')
    expect(change.leftText).toBe('。')
    expect(change.rightText).toBe('！')
  })

  it('respects case in review mode and ignores it in relaxed mode', () => {
    expect(firstChange('Report', 'report', 'review').kind).toBe('replace')
    expect(
      compareText({ left: 'Report', right: 'report', preset: 'relaxed' })
        .changes,
    ).toHaveLength(0)
  })

  it('keeps whitespace exact but applies review and relaxed rules', () => {
    expect(
      compareText({ left: 'a ', right: 'a', preset: 'exact' }).changes,
    ).toHaveLength(1)
    expect(
      compareText({ left: 'a ', right: 'a', preset: 'review' }).changes,
    ).toHaveLength(0)
    expect(
      compareText({ left: 'a  b', right: 'a b', preset: 'relaxed' }).changes,
    ).toHaveLength(0)
  })

  it('normalizes CRLF only outside exact mode', () => {
    expect(
      compareText({ left: 'a\r\nb', right: 'a\nb', preset: 'exact' }).changes
        .length,
    ).toBeGreaterThan(0)
    expect(
      compareText({ left: 'a\r\nb', right: 'a\nb', preset: 'review' }).changes,
    ).toHaveLength(0)
  })

  it('handles empty sides and boundaries', () => {
    expect(firstChange('', '开头', 'review')).toMatchObject({
      kind: 'insert',
      rightRange: { start: 0, end: 2 },
    })
    expect(firstChange('末尾', '', 'review')).toMatchObject({
      kind: 'delete',
      leftRange: { start: 0, end: 2 },
    })
  })

  it('does not split emoji grapheme clusters', () => {
    const change = firstChange('收到👍🏽', '收到👍🏻')
    expect(change.kind).toBe('replace')
    expect(change.leftText).toBe('👍🏽')
    expect(change.rightText).toBe('👍🏻')
    expect(change.leftRange).toEqual({ start: 2, end: 6 })
  })

  it('treats canonically equivalent combining forms as equal in review mode', () => {
    expect(
      compareText({ left: 'e\u0301', right: 'é', preset: 'review' }).changes,
    ).toHaveLength(0)
  })

  it('honors every custom normalization rule without changing preset rules', () => {
    const result = compareText({
      left: 'Ａ  Report',
      right: 'a report',
      preset: { preset: 'custom', caseSensitive: false, whitespace: 'collapse', unicode: 'nfkc' },
    })
    expect(result.changes).toHaveLength(0)
    expect(firstChange('Report', 'report', 'review').kind).toBe('replace')
  })

  it('reports moved duplicate paragraphs deterministically', () => {
    const result = compareText({
      left: '第一段\n第二段\n第一段',
      right: '第二段\n第一段\n第一段',
      preset: 'review',
    })
    expect(result.changes.length).toBeGreaterThan(0)
    expect(result.changes.some((change) => change.kind === 'delete')).toBe(true)
    expect(result.changes.some((change) => change.kind === 'insert')).toBe(true)
  })

  it('falls back safely for completely different content under a tiny limit', () => {
    const result = compareText(
      {
        left: '甲'.repeat(200),
        right: '乙'.repeat(200),
        preset: 'review',
      },
      { timeoutMs: 1, maxEditLength: 1 },
    )
    expect(result.degraded).toBe(true)
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0].kind).toBe('replace')
  })

  it('uses a controlled line-level path for one hundred thousand characters', () => {
    const left = ('项目进度正常。\n').repeat(8_000)
    const right = left.replace('项目进度正常。', '项目进度已更新。')
    const result = compareText({ left, right, preset: 'review' })
    expect(result.degraded).toBe(true)
    expect(result.message).toContain('行级比较')
    expect(result.durationMs).toBeLessThan(2_000)
  })
})
