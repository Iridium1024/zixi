import { isTauriRuntime } from '../../lib/platform'
import type { ExportFormat } from './formatters'

const MIME: Record<ExportFormat, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  html: 'text/html',
  diff: 'text/x-diff',
}

export function safeExportBaseName(value: string): string {
  const controlSafe = Array.from(value, (character) =>
    (character.codePointAt(0) ?? 0) < 32 ? '_' : character,
  ).join('')
  const cleaned = controlSafe
    .replace(/[<>:"/\\|?*]/gu, '_')
    .replace(/[. ]+$/gu, '')
    .trim()
  const shortened = Array.from(cleaned).slice(0, 80).join('') || '字隙导出'
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(shortened)
    ? `_${shortened}`
    : shortened
}

export async function saveExport(
  suggestedName: string,
  format: ExportFormat,
  content: string,
) {
  const safeName = safeExportBaseName(suggestedName)
  if (isTauriRuntime()) {
    const [{ save }, { writeTextFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ])
    const path = await save({
      defaultPath: `${safeName}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    })
    if (!path) return false
    await writeTextFile(path, content)
    return true
  }

  const blob = new Blob([content], { type: `${MIME[format]};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safeName}.${format}`
  anchor.click()
  URL.revokeObjectURL(url)
  return true
}
