import MindElixir, { type MindElixirData, type Operation, type Topic } from 'mind-elixir'
import { zh_CN } from 'mind-elixir/i18n'
import 'mind-elixir/style'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { MindMapTemplate } from '../settings/appearance'
import { alignMindMapBranches, drawMindMapBranches } from './mindMapBranches'
import { createMindMapSearch, findMindMapTopic, type MindMapSearchPosition } from './mindMapSearch'
import { decorateMindMapTopics } from './mindMapTopics'

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
  openSearch(): void
}

interface Props {
  initialData: string
  theme: 'light' | 'dark'
  template: MindMapTemplate
  searchEnabled: boolean
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

export const MindMapCanvas = forwardRef<MindMapCanvasHandle, Props>(function MindMapCanvas({ initialData, theme, template, searchEnabled, onChange, onBackground }, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mindRef = useRef<MindElixir | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const initialDataRef = useRef(initialData)
  const onChangeRef = useRef(onChange)
  const onBackgroundRef = useRef(onBackground)
  const searchRef = useRef<ReturnType<typeof createMindMapSearch> | null>(null)
  const redrawRef = useRef<(() => void) | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchPanelRef = useRef<HTMLDivElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchPosition, setSearchPosition] = useState<MindMapSearchPosition>({ index: 0, count: 0 })
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
      const search = createMindMapSearch(current, refreshView, setSearchPosition)
      searchRef.current = search
      const changed = () => onChangeRef.current(current.getDataString())
      let frame = 0
      let searchNeedsUpdate = false
      const decorateNodes = () => {
        decorateMindMapTopics(current, search.isFolded)
        search.paintMatch()
        current.linkDiv()
      }
      redrawRef.current = decorateNodes
      function refreshView() {
        const selectedIds = current.currentNodes.map((topic) => topic.nodeObj.id)
        current.refresh()
        decorateNodes()
        const selection = selectedIds.flatMap((id) => findMindMapTopic(current, id) ?? [])
        if (selection.length) current.selectNodes(selection)
      }
      const scheduleDecoration = () => {
        if (frame) return
        frame = requestAnimationFrame(() => {
          frame = 0
          decorateNodes()
          if (searchNeedsUpdate && !current.nodes.querySelector('#input-box')) {
            searchNeedsUpdate = false
            search.update()
          }
        })
      }
      const linkDiv = current.linkDiv.bind(current)
      current.linkDiv = (wrapper) => {
        const useCurrentTemplate = current.el.dataset.template !== 'classic'
        if (useCurrentTemplate) alignMindMapBranches(current)
        linkDiv(wrapper)
        if (useCurrentTemplate) drawMindMapBranches(current)
      }
      const onOperation = (operation: Operation) => {
        if (operation.name === 'beginEdit') return
        changed()
        searchNeedsUpdate = true
        scheduleDecoration()
      }
      const onExpand = () => { changed(); scheduleDecoration() }
      const onSelection = (nodes: Array<{ id: string }>) => {
        if (nodes.length) selectedIdRef.current = nodes[nodes.length - 1].id
      }
      current.bus.addListener('selectNodes', onSelection)
      current.bus.addListener('operation', onOperation)
      current.bus.addListener('expandNode', onExpand)
      const observer = new MutationObserver((mutations) => {
        if (mutations.some((mutation) => [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
          node instanceof Element && (node.matches('me-tpc, #input-box') || Boolean(node.querySelector('me-tpc')))))) scheduleDecoration()
      })
      observer.observe(current.nodes, { childList: true, subtree: true })
      const resizeObserver = new ResizeObserver(scheduleDecoration)
      resizeObserver.observe(current.nodes)
      document.fonts.addEventListener('loadingdone', scheduleDecoration)
      decorateNodes()
      current.toCenter()
      const originalExpand = current.expandNode.bind(current)
      current.expandNode = (topic, expand) => {
        const node = topic.nodeObj
        const wasExpanded = !search.isFolded(node)
        const willExpand = expand ?? !wasExpanded
        search.keepManualFold(node)
        if (node.parent && node.children?.length && willExpand !== wasExpanded) {
          originalExpand(topic, willExpand)
          return
        }
        node.expanded = willExpand
        decorateNodes()
        changed()
      }
      current.expandNodeAll = (topic, expand) => current.expandNode(topic, expand)
      const onFoldControl = (event: Event) => {
        if (event.target instanceof Element && event.target.closest('.zixi-node-fold')) event.stopPropagation()
      }
      const onFoldClick = (event: MouseEvent) => {
        const topic = event.target instanceof Element ? event.target.closest('.zixi-node-fold')?.closest<Topic>('me-tpc') : null
        if (!topic) return
        event.preventDefault()
        event.stopPropagation()
        commitFocusedNode(hostRef.current)
        current.expandNode(topic)
        current.selectNode(topic)
        current.container.focus({ preventScroll: true })
      }
      current.container.addEventListener('pointerdown', onFoldControl, true)
      current.container.addEventListener('keydown', onFoldControl, true)
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
      const afterHistory = () => {
        changed()
        searchNeedsUpdate = true
        scheduleDecoration()
      }
      current.undo = () => { originalUndo(); afterHistory() }
      current.redo = () => { originalRedo(); afterHistory() }
      const root = current.findEle(data.nodeData.id)
      if (root) current.selectNode(root)
      return () => {
        current.bus.removeListener('operation', onOperation)
        current.bus.removeListener('expandNode', onExpand)
        current.bus.removeListener('selectNodes', onSelection)
        current.container.removeEventListener('pointerdown', onFoldControl, true)
        current.container.removeEventListener('keydown', onFoldControl, true)
        current.container.removeEventListener('click', onFoldClick, true)
        observer.disconnect()
        resizeObserver.disconnect()
        document.fonts.removeEventListener('loadingdone', scheduleDecoration)
        cancelAnimationFrame(frame)
        window.removeEventListener('blur', saveOnBackground)
        document.removeEventListener('visibilitychange', saveWhenHidden)
        current.destroy()
        mindRef.current = null
        searchRef.current = null
        redrawRef.current = null
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

  useEffect(() => {
    commitFocusedNode(hostRef.current)
    redrawRef.current?.()
  }, [template])

  const openSearch = useCallback(() => {
    if (!mindRef.current || !searchEnabled) return
    commitFocusedNode(hostRef.current)
    setSearchOpen(true)
    searchInputRef.current?.focus()
    searchInputRef.current?.select()
  }, [searchEnabled])

  const closeSearch = useCallback(() => {
    searchRef.current?.search('')
    setQuery('')
    setSearchOpen(false)
    mindRef.current?.container.focus({ preventScroll: true })
  }, [])

  useEffect(() => { if (searchOpen) searchInputRef.current?.focus() }, [searchOpen])

  useEffect(() => {
    if (!searchEnabled) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) openSearch()
      } else if (searchOpen && event.key === 'Escape' && event.target instanceof HTMLElement && !event.target.isContentEditable
        && (hostRef.current?.contains(event.target) || searchPanelRef.current?.contains(event.target))) {
        event.preventDefault()
        event.stopPropagation()
        closeSearch()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [closeSearch, openSearch, searchEnabled, searchOpen])

  useImperativeHandle(ref, () => {
    function selectedNode() {
      const mind = mindRef.current
      if (!mind) return null
      if (selectedIdRef.current) {
        const selected = findMindMapTopic(mind, selectedIdRef.current)
        if (selected) return selected
      }
      if (mind.currentNode && mind.nodes.contains(mind.currentNode)) return mind.currentNode
      return findMindMapTopic(mind, mind.nodeData.id)
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
    openSearch,
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
  } }, [openSearch])

  const searchCount = searchPosition.count
  return <div className="mind-map-canvas-wrap">
    {error && <div className="mind-map-error" role="alert">{error}</div>}
    <div ref={hostRef} className="mind-map-canvas" data-template={template} aria-label="思维导图画布" />
    {searchOpen && <div ref={searchPanelRef} className="mind-map-search" role="search" aria-label="查找导图" inert={!searchEnabled}>
      <input ref={searchInputRef} aria-label="查找节点文字" placeholder="查找节点" value={query} onChange={(event) => {
        setQuery(event.target.value)
        searchRef.current?.search(event.target.value)
      }} onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
        event.preventDefault()
        searchRef.current?.step(event.shiftKey ? -1 : 1)
      }} />
      <span role="status">{query.trim() ? searchCount ? `${searchPosition.index} / ${searchCount}` : '无匹配' : ''}</span>
      <button type="button" className="square-button" title="上一处 (Shift+Enter)" aria-label="上一处匹配" disabled={!searchCount} onClick={() => searchRef.current?.step(-1)}><ChevronUp size={15} /></button>
      <button type="button" className="square-button" title="下一处 (Enter)" aria-label="下一处匹配" disabled={!searchCount} onClick={() => searchRef.current?.step(1)}><ChevronDown size={15} /></button>
      <button type="button" className="square-button" title="关闭查找 (Esc)" aria-label="关闭查找" onClick={closeSearch}><X size={15} /></button>
    </div>}
  </div>
})
