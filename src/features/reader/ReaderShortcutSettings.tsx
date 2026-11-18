import { useState } from 'react'
import { DEFAULT_READER_SHORTCUTS, READER_ACTIONS, shortcutFor, type ReaderAction, type ReaderShortcuts } from './readerShortcuts'

export function ReaderShortcutSettings({ value, onChange, reservedShortcut }: { value: ReaderShortcuts; onChange(value: ReaderShortcuts): void; reservedShortcut?: string }) {
  const [error, setError] = useState('')
  return <section className="reader-shortcut-settings"><h3>快捷键</h3><small>点击输入框后按下组合键；清空或重复的按键不会保存。</small>
    {(Object.keys(READER_ACTIONS) as ReaderAction[]).map(action => <label key={action}>{READER_ACTIONS[action]}<input data-reader-shortcut readOnly aria-label={READER_ACTIONS[action] + '快捷键'} value={value[action]} onKeyDown={event => {
      if (event.key === 'Tab') return
      event.preventDefault(); event.stopPropagation()
      if (event.nativeEvent.isComposing || event.repeat) return
      const key = shortcutFor(event)
      if (!key) return
      if (key === reservedShortcut) { setError('该组合键用于全局唤出阅读窗口，请选择其它按键'); return }
      if ((Object.keys(value) as ReaderAction[]).some(other => other !== action && value[other] === key)) { setError('该按键已绑定其它功能，请更换组合键'); return }
      setError(''); onChange({ ...value, [action]: key })
    }} /></label>)}
    {error && <small role="alert">{error}</small>}
    <button className="secondary-button" onClick={() => { setError(''); onChange({ ...DEFAULT_READER_SHORTCUTS }) }}>恢复默认快捷键</button>
  </section>
}
