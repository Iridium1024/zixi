import { getCurrentWindow } from '@tauri-apps/api/window'
import type { MouseEvent } from 'react'
import { isTauriRuntime } from '../lib/platform'

const EDGES = ['North', 'NorthEast', 'East', 'SouthEast', 'South', 'SouthWest', 'West', 'NorthWest'] as const

export function WindowResizeEdges({ onError }: { onError?: () => void }) {
  function startResize(event: MouseEvent, edge: typeof EDGES[number]) {
    if (event.button !== 0 || !isTauriRuntime()) return
    event.preventDefault()
    void getCurrentWindow().startResizeDragging(edge).catch(() => onError?.())
  }

  return <div className="window-resize-edges" aria-hidden="true">{EDGES.map((edge) => <div key={edge} className={`window-resize-edge resize-${edge.toLowerCase()}`} onMouseDown={(event) => startResize(event, edge)} />)}</div>
}
