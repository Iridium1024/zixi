import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function FloatingMenu({ anchor, point, label, onClose, children }: {
  anchor: HTMLElement; point?: { x: number; y: number }; label: string; onClose(): void; children: ReactNode
}) {
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = menu.current!
    const position = () => {
      if (!anchor.isConnected) { onClose(); return }
      const rect = anchor.getBoundingClientRect()
      element.style.left = `${Math.max(8, Math.min(point?.x ?? rect.left, window.innerWidth - element.offsetWidth - 8))}px`
      element.style.top = `${Math.max(8, Math.min(point?.y ?? rect.bottom + 4, window.innerHeight - element.offsetHeight - 8))}px`
    }
    position()
    const items = () => [...element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    ;(element.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? items()[0])?.focus()
    const outside = (event: PointerEvent) => {
      if (!element.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose()
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); anchor.focus(); onClose() }
      if (event.key === 'Tab') { anchor.focus(); onClose(); return }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const buttons = items(), index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next]?.focus()
    }
    document.addEventListener('pointerdown', outside)
    element.addEventListener('keydown', keydown)
    window.addEventListener('resize', position)
    document.addEventListener('scroll', position, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      element.removeEventListener('keydown', keydown)
      window.removeEventListener('resize', position)
      document.removeEventListener('scroll', position, true)
    }
  }, [anchor, point, onClose])
  return createPortal(<div ref={menu} className="floating-action-menu" role="menu" aria-label={label}>{children}</div>, document.body)
}
