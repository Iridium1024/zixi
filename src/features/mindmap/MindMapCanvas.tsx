import MindElixir, { type MindElixirData, type NodeObj, type Operation, type Topic } from 'mind-elixir'
import { zh_CN } from 'mind-elixir/i18n'
import 'mind-elixir/style'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

export interface MindMapCanvasHandle {
  commit(): void
  addChild(): void
  addSibling(): void
  edit(): void
  remove(): void
  undo(): void
  redo(): void
  center(): void
  fit(): void
}

interface Props {
  initialData: string
  theme: 'light' | 'dark'
  onChange(data: string): void
  onBackground(): void
}

function commitFocusedNode(host: HTMLElement | null) {
  const focused = document.activeElement
  if (focused instanceof HTMLElement && focused.isContentEditable && host?.contains(focused)) focused.blur()
}

const LIGHT_THEME = {
  ...MindElixir.THEME,
  palette: ['#a66d68', '#927b69', '#8f8566', '#718c7d', '#8b7995'],
  cssVar: { ...MindElixir.THEME.cssVar, '--bgcolor': '#f6f2ec', '--main-bgcolor': '#faf7f2', '--root-bgcolor': '#806e68', '--root-color': '#ffffff' },
}
const DARK_THEME = {
  ...MindElixir.DARK_THEME,
  palette: ['#d2a6a0', '#c6ad98', '#c4b993', '#9fb9a7', '#b6a4c1'],
  cssVar: { ...MindElixir.DARK_THEME.cssVar, '--bgcolor': '#292625', '--main-bgcolor': '#3b3431', '--root-bgcolor': '#c7b4a8', '--root-color': '#302824' },
}

export const MindMapCanvas = forwardRef<MindMapCanvasHandle, Props>(function MindMapCanvas({ initialData, theme, onChange, onBackground }, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mindRef = useRef<MindElixir | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const initialDataRef = useRef(initialData)
  const onChangeRef = useRef(onChange)
  const onBackgroundRef = useRef(onBackground)
  const [error, setError] = useState('')
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onBackgroundRef.current = onBackground }, [onBackground])

  useEffect(() => {
    if (!hostRef.current) return
    let mind: MindElixir | null = null
    try {
      const data = JSON.parse(initialDataRef.current) as MindElixirData
      if (!data?.nodeData?.id || typeof data.nodeData.topic !== 'string') throw new Error('invalid map')
      mind = new MindElixir({
        el: hostRef.current, direction: MindElixir.RIGHT, editable: true,
        contextMenu: { locale: zh_CN, link: false, focus: false }, toolBar: false,
        keypress: { k: () => undefined }, newTopicName: '新节点', overflowHidden: false,
      })
      const initError = mind.init({ ...data, direction: MindElixir.RIGHT })
      if (initError) throw initError
      // Keep the mask fixed while the map pans/zooms; menus remain unmasked siblings.
      const fadeViewport = document.createElement('div')
      fadeViewport.className = 'mind-map-fade-viewport'
      mind.container.insertBefore(fadeViewport, mind.map)
      fadeViewport.appendChild(mind.map)
      mindRef.current = mind
      const current = mind
      const changed = () => onChangeRef.current(current.getDataString())
      const onOperation = (operation: Operation) => { if (operation.name !== 'beginEdit') changed() }
      const onSelection = (nodes: Array<{ id: string }>) => {
        if (nodes.length) selectedIdRef.current = nodes[nodes.length - 1].id
      }
      current.bus.addListener('selectNodes', onSelection)
      current.bus.addListener('operation', onOperation)
      current.bus.addListener('expandNode', changed)
      let frame = 0
      const decorateNodes = () => {
        current.nodes.classList.toggle('zixi-root-folded', current.nodeData.expanded === false)
        current.nodes.querySelectorAll<Topic>('me-tpc').forEach((topic) => {
          const node = topic.nodeObj
          if (!node) return
          const folded = node.expanded === false
          topic.classList.toggle('zixi-node-folded', folded)
          topic.title = folded ? node.topic : ''
          let button = topic.querySelector<HTMLButtonElement>(':scope > .zixi-node-fold')
          if (!button) {
            button = document.createElement('button')
            button.type = 'button'
            button.className = 'zixi-node-fold'
            topic.appendChild(button)
          }
          button.dataset.nodeId = node.id
          button.textContent = folded ? '▸' : '▾'
          button.title = folded ? '展开此节点' : '折叠此节点'
          button.setAttribute('aria-label', `${button.title}：${node.topic}`)
          button.setAttribute('aria-expanded', String(!folded))
        })
        current.linkDiv()
      }
      const scheduleDecoration = () => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(decorateNodes)
      }
      const observer = new MutationObserver((mutations) => {
        if (mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) =>
          node instanceof Element && (node.matches('me-tpc') || Boolean(node.querySelector('me-tpc')))))) scheduleDecoration()
      })
      observer.observe(current.nodes, { childList: true, subtree: true })
      scheduleDecoration()
      const originalExpand = current.expandNode.bind(current)
      current.expandNode = (topic, expand) => {
        const node = topic.nodeObj
        if (!node.parent || !node.children?.length) {
          node.expanded = typeof expand === 'boolean' ? expand : node.expanded === false
          decorateNodes()
          changed()
          return
        }
        originalExpand(topic, expand)
      }
      current.expandNodeAll = (topic, expand) => current.expandNode(topic, expand)
      const onFoldPointer = (event: PointerEvent) => {
        if (event.target instanceof Element && event.target.closest('.zixi-node-fold')) event.stopPropagation()
      }
      const onFoldClick = (event: MouseEvent) => {
        const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.zixi-node-fold') : null
        if (!button?.dataset.nodeId) return
        event.preventDefault()
        event.stopPropagation()
        commitFocusedNode(hostRef.current)
        const data = current.getData()
        const stack: NodeObj[] = [data.nodeData]
        let target: NodeObj | undefined
        while (stack.length) {
          const node = stack.pop()!
          if (node.id === button.dataset.nodeId) { target = node; break }
          if (node.children) stack.push(...node.children)
        }
        if (!target) return
        target.expanded = target.expanded === false
        current.refresh(data)
        selectedIdRef.current = target.id
        try { current.selectNode(current.findEle(target.id)) } catch { /* The node may no longer be visible. */ }
        decorateNodes()
        changed()
      }
      current.container.addEventListener('pointerdown', onFoldPointer, true)
      current.container.addEventListener('click', onFoldClick, true)
      const saveOnBackground = () => {
        commitFocusedNode(hostRef.current)
        onBackgroundRef.current()
      }
      const saveWhenHidden = () => { if (document.visibilityState === 'hidden') saveOnBackground() }
      window.addEventListener('blur', saveOnBackground)
      document.addEventListener('visibilitychange', saveWhenHidden)
      // The library refreshes its data on undo/redo without emitting an operation.
      const originalUndo = current.undo.bind(current)
      const originalRedo = current.redo.bind(current)
      current.undo = () => { originalUndo(); changed() }
      current.redo = () => { originalRedo(); changed() }
      const root = current.findEle(data.nodeData.id)
      if (root) current.selectNode(root)
      return () => {
        current.bus.removeListener('operation', onOperation)
        current.bus.removeListener('expandNode', changed)
        current.bus.removeListener('selectNodes', onSelection)
        current.container.removeEventListener('pointerdown', onFoldPointer, true)
        current.container.removeEventListener('click', onFoldClick, true)
        observer.disconnect()
        cancelAnimationFrame(frame)
        window.removeEventListener('blur', saveOnBackground)
        document.removeEventListener('visibilitychange', saveWhenHidden)
        current.destroy()
        mindRef.current = null
      }
    } catch {
      mind?.destroy()
      setError('导图数据无法读取，原始记录未被修改。')
    }
  }, [])

  useEffect(() => {
    const mind = mindRef.current
    if (mind) {
      commitFocusedNode(hostRef.current)
      mind.changeTheme(theme === 'dark' ? DARK_THEME : LIGHT_THEME)
    }
  }, [theme])

  useImperativeHandle(ref, () => {
    function selectedNode() {
      const mind = mindRef.current
      if (!mind) return null
      if (selectedIdRef.current) {
        try { return mind.findEle(selectedIdRef.current) } catch { /* The node may have been collapsed or removed. */ }
      }
      if (mind.currentNode && mind.nodes.contains(mind.currentNode)) return mind.currentNode
      try { return mind.findEle(mind.nodeData.id) } catch { return null }
    }
    return {
    commit() { commitFocusedNode(hostRef.current) },
    addChild() {
      const selected = selectedNode()
      if (selected) void mindRef.current?.addChild(selected)
    },
    addSibling() {
      const mind = mindRef.current
      const selected = selectedNode()
      if (!mind || !selected) return
      if (!selected.nodeObj.parent) void mind.addChild(selected)
      else void mind.insertSibling('after', selected)
    },
    edit() {
      const selected = selectedNode()
      if (selected) void mindRef.current?.beginEdit(selected)
    },
    remove() {
      const mind = mindRef.current
      const selected = selectedNode()
      if (mind && selected?.nodeObj.parent) {
        selectedIdRef.current = selected.nodeObj.parent.id
        void mind.removeNodes([selected])
      }
    },
    undo() { mindRef.current?.undo() },
    redo() { mindRef.current?.redo() },
    center() { mindRef.current?.toCenter() },
    fit() {
      const mind = mindRef.current
      if (!mind) return
      mind.scaleFit()
      const bounds = Array.from(mind.nodes.querySelectorAll('me-tpc'))
        .map((node) => node.getBoundingClientRect())
        .filter((box) => box.width > 0 && box.height > 0)
      if (!bounds.length) return
      const viewport = mind.container.getBoundingClientRect()
      const left = Math.min(...bounds.map((box) => box.left))
      const right = Math.max(...bounds.map((box) => box.right))
      const top = Math.min(...bounds.map((box) => box.top))
      const bottom = Math.max(...bounds.map((box) => box.bottom))
      mind.move((viewport.left + viewport.right - left - right) / 2, (viewport.top + viewport.bottom - top - bottom) / 2)
    },
  } }, [])

  return <div className="mind-map-canvas-wrap">{error && <div className="mind-map-error" role="alert">{error}</div>}<div ref={hostRef} className="mind-map-canvas" aria-label="思维导图画布" /></div>
})
