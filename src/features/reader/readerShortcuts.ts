export const READER_ACTIONS = { previousPage: '上一页 / 向上滚动', nextPage: '下一页 / 向下滚动', previousChapter: '上一章', nextChapter: '下一章', panel: '唤出 / 收起控制面板', close: '关闭面板 / 窗口' } as const
export type ReaderAction = keyof typeof READER_ACTIONS
export type ReaderShortcuts = Record<ReaderAction, string>
export const DEFAULT_READER_SHORTCUTS: ReaderShortcuts = { previousPage: 'ArrowUp', nextPage: 'ArrowDown', previousChapter: 'ArrowLeft', nextChapter: 'ArrowRight', panel: 'B', close: 'Escape' }
export function shortcutFor(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>) {
  if (['Control', 'Alt', 'Shift', 'Meta', 'Dead', 'Unidentified'].includes(event.key)) return ''
  return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', event.key === ' ' ? 'Space' : event.key === '+' ? 'Plus' : event.key.length === 1 ? event.key.toUpperCase() : event.key].filter(Boolean).join('+')
}
export function normalizeShortcuts(input: unknown): ReaderShortcuts {
  const value = input && typeof input === 'object' ? input as Partial<ReaderShortcuts> : {}
  const result = { ...DEFAULT_READER_SHORTCUTS }
  for (const key of Object.keys(result) as ReaderAction[]) {
    if (typeof value[key] === 'string' && /^(?:(?:Ctrl|Alt|Shift|Meta)\+)*(?:[^\s+]|F(?:[1-9]|1[0-9]|2[0-4])|Arrow(?:Up|Down|Left|Right)|PageUp|PageDown|Home|End|Escape|Space|Enter|Backspace|Delete|Insert|Tab|Plus)$/.test(value[key]!)) result[key] = value[key]!
  }
  return new Set(Object.values(result)).size === Object.keys(result).length ? result : { ...DEFAULT_READER_SHORTCUTS }
}
export function readerAction(event: KeyboardEvent, shortcuts: ReaderShortcuts): ReaderAction | undefined {
  const key = shortcutFor(event)
  return (Object.keys(shortcuts) as ReaderAction[]).find(action => shortcuts[action] === key)
}
