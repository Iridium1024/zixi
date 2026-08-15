import type { editor } from 'monaco-editor'

export type MonacoEditor = editor.IStandaloneCodeEditor

export interface EditorLayoutSize {
  width: number
  height: number
}

export function measuredEditorLayout(container: HTMLElement): EditorLayoutSize | null {
  const { width, height } = container.getBoundingClientRect()
  const roundedWidth = Math.floor(width)
  const roundedHeight = Math.floor(height)
  return roundedWidth > 0 && roundedHeight > 0
    ? { width: roundedWidth, height: roundedHeight }
    : null
}

/**
 * Explicitly lays out a mounted Monaco instance from its own host box.
 * This deliberately avoids deriving a width from the window or page grid.
 */
export function layoutEditorFromContainer(
  editorInstance: MonacoEditor | null,
  container: HTMLElement | null,
) {
  if (!editorInstance || !container) return false
  const size = measuredEditorLayout(container)
  if (!size) return false
  editorInstance.layout(size, true)
  return true
}

export interface LayoutScheduler {
  schedule(): void
  dispose(): void
}

/**
 * WebView2 can dispatch a resize while its final client box is still settling.
 * A bounded animation-frame sequence covers maximize/restore without polling.
 */
export function createBoundedLayoutScheduler(
  run: () => void,
  requestFrame: typeof requestAnimationFrame = requestAnimationFrame,
  cancelFrame: typeof cancelAnimationFrame = cancelAnimationFrame,
): LayoutScheduler {
  let scheduled = false
  let frameIds: number[] = []

  const flush = () => {
    frameIds = []
    scheduled = false
    run()
  }

  return {
    schedule() {
      if (scheduled) return
      scheduled = true
      frameIds.push(requestFrame(() => {
        run()
        frameIds.push(requestFrame(() => {
          run()
          frameIds.push(requestFrame(flush))
        }))
      }))
    },
    dispose() {
      frameIds.forEach(cancelFrame)
      frameIds = []
      scheduled = false
    },
  }
}
