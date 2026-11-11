import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ThemeMode } from '../features/settings/appearance'

const OPTIONS = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '自动', icon: Monitor },
] as const

export function ThemeSwitcher({ value, collapsed, onChange }: {
  value: ThemeMode; collapsed: boolean; onChange(value: ThemeMode): void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const visible = !collapsed || open
  const Icon = OPTIONS.find((item) => item.value === value)?.icon ?? Monitor

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return <div ref={root} className={`theme-switcher ${collapsed ? 'compact' : ''} ${visible ? 'open' : ''}`}>
    {collapsed && <button ref={trigger} className="theme-trigger square-button" aria-label="主题切换" title="主题切换" aria-expanded={open} aria-controls="quick-theme-options" onClick={() => setOpen(!open)}><Icon size={18} /></button>}
    <div className="theme-reveal" aria-hidden={!visible} inert={!visible}>
      <div className="theme-reveal-inner"><div id="quick-theme-options" className="sidebar-theme" role="group" aria-label="快速主题切换" style={{ '--theme-index': Math.max(0, OPTIONS.findIndex((item) => item.value === value)) } as CSSProperties}>
        <span className="theme-selection-indicator" aria-hidden="true" />
        {OPTIONS.map(({ value: mode, label, icon: OptionIcon }) => <button key={mode} aria-pressed={value === mode} className={`theme-option ${value === mode ? 'active' : ''}`} title={mode === 'system' ? '跟随系统主题' : `切换为${label}主题`} onClick={() => { onChange(mode); setOpen(false); if (collapsed) trigger.current?.focus() }}><OptionIcon size={15} /><span>{label}</span></button>)}
      </div></div>
    </div>
  </div>
}
