import { useEffect, useLayoutEffect, type RefObject } from 'react'

/** Mask the native scroll surface, preserving its scrollbar and any separate footer. */
export function useScrollEdgeFade(target: RefObject<HTMLElement | null>, revision?: unknown, overlayFooter?: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => { if (target.current) measureScrollEdgeFade(target.current, overlayFooter?.current) }, [target, revision, overlayFooter])
  useEffect(() => {
    const element = target.current
    if (!element) return
    const measure = () => measureScrollEdgeFade(element, overlayFooter?.current)
    element.addEventListener('scroll', measure, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    if (overlayFooter?.current) observer?.observe(overlayFooter.current)
    return () => { element.removeEventListener('scroll', measure); observer?.disconnect() }
  }, [target, overlayFooter, revision])
}

export function measureScrollEdgeFade(element: HTMLElement, footer?: HTMLElement | null) {
  const viewport = element.getBoundingClientRect()
  const footerBox = footer?.getBoundingClientRect()
  const overlap = footerBox && footerBox.right > viewport.left && footerBox.left < viewport.right && footerBox.bottom >= viewport.bottom
    ? Math.max(0, Math.min(viewport.height, viewport.bottom - footerBox.top)) : 0
  element.dataset.edgeTop = String(element.scrollTop > 1)
  element.dataset.edgeBottom = String(element.scrollHeight - element.clientHeight - element.scrollTop > 1)
  element.style.setProperty('--edge-scrollbar-gutter', `${Math.max(0, element.offsetWidth - element.clientWidth)}px`)
  // A footer in a separate grid row consumes no space inside this viewport.
  element.style.setProperty('--edge-bottom-reserve', `${overlap > 0 ? overlap + 16 : 0}px`)
}
