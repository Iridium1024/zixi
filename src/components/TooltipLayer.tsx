import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Delegate titles so dynamic lists and third-party controls share the same tooltip.
// Keep the text in a data attribute and suppress the native, unstyleable browser box.
export function TooltipLayer() {
  const [hint, setHint] = useState<{ target: HTMLElement; text: string } | null>(null)
  const popup = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    let timer: number | undefined
    let target: HTMLElement | null = null
    const prepare = (element: HTMLElement) => {
      const text = element.getAttribute('title')
      if (text === null) return
      if (text.trim()) {
        const oldText = element.dataset.uiTooltip
        element.dataset.uiTooltip = text
        if ((!element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.textContent?.trim()) || (element.dataset.uiTooltipOwnLabel === 'true' && element.getAttribute('aria-label') === oldText)) {
          element.setAttribute('aria-label', text)
          element.dataset.uiTooltipOwnLabel = 'true'
        }
      } else delete element.dataset.uiTooltip
      element.removeAttribute('title')
    }
    const scan = (root: ParentNode) => {
      if (root instanceof HTMLElement && root.hasAttribute('title')) prepare(root)
      root.querySelectorAll<HTMLElement>('[title]').forEach(prepare)
    }
    const hide = () => { window.clearTimeout(timer); target = null; setHint(null) }
    const show = (event: Event) => {
      if (!(event.target instanceof Element)) return
      const next = event.target.closest<HTMLElement>('[title], [data-ui-tooltip], [data-tooltip]')
      if (next?.hasAttribute('title')) prepare(next)
      if (!next || next.closest('[inert]') || (next instanceof HTMLButtonElement && next.disabled)) { hide(); return }
      const text = next.dataset.tooltip || next.dataset.uiTooltip
      if (!text) { hide(); return }
      const visibleLabel = next.matches('strong, span') ? next : next.querySelector<HTMLElement>('strong, span') ?? next
      const overflowOnly = next.hasAttribute('data-tooltip-overflow')
      const expandedNav = next.closest('.app-sidebar nav') && next.querySelector('span')?.getBoundingClientRect().width
      if (expandedNav || (overflowOnly && (!visibleLabel || visibleLabel.scrollWidth <= visibleLabel.clientWidth))) { hide(); return }
      if (target === next) return
      window.clearTimeout(timer)
      target = next
      setHint(null)
      timer = window.setTimeout(() => {
        const latest = next.dataset.tooltip || next.dataset.uiTooltip
        if (next.isConnected && latest) setHint({ target: next, text: latest })
      }, event.type === 'focusin' ? 120 : 360)
    }
    const leave = (event: MouseEvent | FocusEvent) => {
      if (target?.contains(event.relatedTarget as Node | null)) return
      hide()
    }
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') hide() }
    scan(document.body)
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof HTMLElement) prepare(record.target)
        for (const node of record.addedNodes) if (node instanceof HTMLElement) scan(node)
      }
      if (target && !target.isConnected) hide()
      else if (target) {
        const text = target.dataset.tooltip || target.dataset.uiTooltip
        if (!text) hide()
        else setHint((current) => current?.target === target && current.text !== text ? { target: current.target, text } : current)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title', 'data-tooltip'] })
    document.addEventListener('mouseover', show)
    document.addEventListener('mouseout', leave)
    document.addEventListener('focusin', show)
    document.addEventListener('focusout', leave)
    document.addEventListener('pointerdown', hide)
    document.addEventListener('scroll', hide, true)
    document.addEventListener('keydown', keydown)
    window.addEventListener('resize', hide)
    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
      document.removeEventListener('mouseover', show)
      document.removeEventListener('mouseout', leave)
      document.removeEventListener('focusin', show)
      document.removeEventListener('focusout', leave)
      document.removeEventListener('pointerdown', hide)
      document.removeEventListener('scroll', hide, true)
      document.removeEventListener('keydown', keydown)
      window.removeEventListener('resize', hide)
      document.querySelectorAll<HTMLElement>('[data-ui-tooltip]').forEach((element) => {
        element.title = element.dataset.uiTooltip!
        if (element.dataset.uiTooltipOwnLabel === 'true' && element.getAttribute('aria-label') === element.dataset.uiTooltip) element.removeAttribute('aria-label')
        delete element.dataset.uiTooltip
        delete element.dataset.uiTooltipOwnLabel
      })
    }
  }, [])

  useLayoutEffect(() => {
    if (!hint || !popup.current) return
    const element = popup.current
    const rect = hint.target.getBoundingClientRect()
    const width = element.offsetWidth, height = element.offsetHeight
    element.style.left = `${Math.max(8, Math.min(rect.left + (rect.width - width) / 2, window.innerWidth - width - 8))}px`
    element.style.top = `${Math.max(8, rect.bottom + height + 8 < window.innerHeight ? rect.bottom + 7 : rect.top - height - 7)}px`
    const previous = hint.target.getAttribute('aria-describedby')
    hint.target.setAttribute('aria-describedby', [previous, id].filter(Boolean).join(' '))
    return () => {
      if (previous) hint.target.setAttribute('aria-describedby', previous)
      else hint.target.removeAttribute('aria-describedby')
    }
  }, [hint, id])

  return hint ? createPortal(<div ref={popup} id={id} role="tooltip" className="ui-tooltip">{hint.text}</div>, document.body) : null
}
