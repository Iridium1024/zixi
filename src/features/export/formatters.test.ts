import { describe, expect, it } from 'vitest'
import type { DiffResult } from '../compare/types'
import { DEFAULT_NOTE_STYLE, type NoteRecord } from '../notes/types'
import { formatComparison, formatNote } from './formatters'
import { safeExportBaseName } from './saveExport'

const result: DiffResult = {
  changes: [{
    id: 'change-0',
    kind: 'replace',
    leftRange: { start: 0, end: 1 },
    rightRange: { start: 0, end: 1 },
    leftText: '旧',
    rightText: '新',
  }],
  stats: {
    insertedCharacters: 1,
    deletedCharacters: 1,
    replacementGroups: 1,
    totalChanges: 1,
  },
  degraded: false,
  durationMs: 1,
}

const note: NoteRecord = {
  id: 'note-1',
  title: '<会议 & 记录>',
  content: '第一行\n<script>alert(1)</script>',
  style: DEFAULT_NOTE_STYLE,
  alwaysOnTop: true,
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
  deletedAt: null,
}

describe('export formatters', () => {
  it('produces a readable Unified Diff', () => {
    const output = formatComparison('旧', '新', result, 'diff')
    expect(output).toContain('--- original.txt\n+++ revised.txt')
    expect(output).toContain('@@ -1,1 +1,1 @@')
    expect(output).toContain('\n-旧\n')
    expect(output).toContain('\n+新\n')
  })

  it('uses standard zero-length hunk coordinates for an empty original', () => {
    const output = formatComparison('', '新增', result, 'diff')
    expect(output).toContain('@@ -0,0 +1,1 @@')
  })

  it('highlights changed comparison ranges in safe HTML', () => {
    const output = formatComparison('<旧>', '<新>', {
      ...result,
      changes: [{
        ...result.changes[0],
        leftRange: { start: 1, end: 2 },
        rightRange: { start: 1, end: 2 },
      }],
    }, 'html')
    expect(output).toContain('&lt;<mark class="replace">旧</mark>&gt;')
    expect(output).toContain('&lt;<mark class="replace">新</mark>&gt;')
    expect(output).not.toContain('<旧>')
  })

  it('escapes note HTML instead of injecting markup', () => {
    const output = formatNote(note, 'html')
    expect(output).toContain('&lt;会议 &amp; 记录&gt;')
    expect(output).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(output).not.toContain('<script>alert(1)</script>')
  })

  it('keeps note metadata in JSON exports', () => {
    expect(JSON.parse(formatNote(note, 'json'))).toMatchObject({
      id: 'note-1',
      alwaysOnTop: true,
    })
  })

  it('keeps the selected comparison preset in structured reports', () => {
    expect(JSON.parse(formatComparison('旧', '新', result, 'json', 'exact'))).toMatchObject({
      preset: 'exact',
      left: '旧',
      right: '新',
    })
  })

  it('sanitizes cross-platform export file names', () => {
    expect(safeExportBaseName('季度:总结/最终*版?')).toBe('季度_总结_最终_版_')
    expect(safeExportBaseName('CON')).toBe('_CON')
    expect(safeExportBaseName('...')).toBe('字隙导出')
  })
})
