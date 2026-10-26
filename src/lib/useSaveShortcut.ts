import { useEffect, useRef } from 'react'

export function isSaveShortcut(event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'repeat'>) {
  return (event.ctrlKey || event.metaKey)
    && !event.altKey
    && !event.repeat
    && event.key.toLowerCase() === 's'
}

export function useSaveShortcut(onSave: () => void | Promise<void>, enabled = true) {
  const onSaveRef = useRef(onSave)
  useEffect(() => { onSaveRef.current = onSave }, [onSave])

  useEffect(() => {
    if (!enabled) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isSaveShortcut(event)) return
      event.preventDefault()
      void onSaveRef.current()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [enabled])
}
