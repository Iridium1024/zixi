import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function LightDialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null)
  const titleId = useId()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const app = document.getElementById('root')
    const wasInert = app?.inert ?? false
    if (app) app.inert = true
    const focusable = () => [...panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')]
    const input = panel.current?.querySelector<HTMLElement>('[data-dialog-autofocus]')
    ;(input ?? focusable()[0])?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
      if (event.key !== 'Tab') return
      const items = focusable()
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown, true)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      if (app) app.inert = wasInert
      if (previous?.isConnected) previous.focus()
    }
  }, [onClose])
  return createPortal(<div className="light-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={panel} className="light-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header><strong id={titleId}>{title}</strong><button className="ghost-icon" aria-label="关闭弹窗" title="关闭" onClick={onClose}><X size={17} /></button></header>
      {children}
    </section>
  </div>, document.body)
}
