import { createTwoFilesPatch } from 'diff'
import { PRESET_DESCRIPTIONS, type ComparePreset, type DiffResult } from '../compare/types'
import type { NoteRecord } from '../notes/types'

export type ExportFormat = 'txt' | 'md' | 'json' | 'html' | 'diff'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function highlightedHtml(
  source: string,
  result: DiffResult,
  side: 'left' | 'right',
): string {
  const ranges = result.changes
    .flatMap((change) => {
      const range = side === 'left' ? change.leftRange : change.rightRange
      return range ? [{ ...range, kind: change.kind }] : []
    })
    .sort((a, b) => a.start - b.start)
  let cursor = 0
  let output = ''
  for (const range of ranges) {
    output += escapeHtml(source.slice(cursor, range.start))
    output += `<mark class="${range.kind}">${escapeHtml(source.slice(range.start, range.end))}</mark>`
    cursor = range.end
  }
  return output + escapeHtml(source.slice(cursor))
}

export function formatNote(note: NoteRecord, format: ExportFormat): string {
  if (format === 'json') return JSON.stringify(note, null, 2)
  if (format === 'html') {
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escapeHtml(note.title)}</title><body><h1>${escapeHtml(note.title)}</h1><pre>${escapeHtml(note.content)}</pre></body></html>`
  }
  if (format === 'md') return `# ${note.title}\n\n${note.content}\n`
  return `${note.title}\n${'='.repeat(note.title.length)}\n\n${note.content}\n`
}

export function formatComparison(
  left: string,
  right: string,
  result: DiffResult,
  format: ExportFormat,
  preset: ComparePreset = 'review',
): string {
  if (format === 'json') return JSON.stringify({ preset, presetDescription: PRESET_DESCRIPTIONS[preset], left, right, ...result }, null, 2)
  if (format === 'html') {
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>字隙比较结果</title><style>body{font:16px/1.7 system-ui;max-width:1100px;margin:40px auto;color:#202b3a}.cols{display:grid;grid-template-columns:1fr 1fr;gap:24px}pre{white-space:pre-wrap;border:1px solid #ccd3df;padding:20px}mark{color:inherit}.insert{background:#bdebd9;border-bottom:2px solid #35b989}.delete{background:#f7c9cf;text-decoration:line-through}.replace{background:#f4dfb7;border-bottom:2px solid #d29a3a}</style><body><h1>字隙比较结果</h1><p>比较规则：${escapeHtml(PRESET_DESCRIPTIONS[preset])}</p><p>共 ${result.stats.totalChanges} 处差异</p><div class="cols"><section><h2>修改前</h2><pre>${highlightedHtml(left, result, 'left')}</pre></section><section><h2>修改后</h2><pre>${highlightedHtml(right, result, 'right')}</pre></section></div></body></html>`
  }
  if (format === 'diff') {
    if (!result.changes.length) return '--- original.txt\n+++ revised.txt\n'
    return createTwoFilesPatch('original.txt', 'revised.txt', left, right)
  }
  if (format === 'md') {
    return `# 字隙比较结果\n\n- 比较规则：${PRESET_DESCRIPTIONS[preset]}\n- 差异：${result.stats.totalChanges}\n- 新增字符：${result.stats.insertedCharacters}\n- 删除字符：${result.stats.deletedCharacters}\n- 替换组：${result.stats.replacementGroups}\n\n## 修改前\n\n${left}\n\n## 修改后\n\n${right}\n`
  }
  return `字隙比较结果\n\n修改前：\n${left}\n\n修改后：\n${right}\n`
}
