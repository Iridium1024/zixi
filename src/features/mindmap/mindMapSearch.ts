import type MindElixir from 'mind-elixir'
import type { NodeObj, Topic } from 'mind-elixir'

export interface MindMapSearchPosition {
  index: number
  count: number
}

export function findMindMapTopic(mind: MindElixir, id: string) {
  const topic = mind.nodes.querySelector<Topic>(`me-tpc[data-nodeid="${CSS.escape(`me${id}`)}"]`)
  return topic?.getClientRects().length ? topic : null
}

function matchingNodes(root: NodeObj, query: string) {
  const matches: NodeObj[] = []
  if (!query) return matches
  const pending = [root]
  while (pending.length) {
    const node = pending.pop()!
    if (node.topic.toLowerCase().includes(query)) matches.push(node)
    if (node.children) {
      for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index])
    }
  }
  return matches
}

export function createMindMapSearch(mind: MindElixir, refreshView: () => void, onPosition: (position: MindMapSearchPosition) => void) {
  let query = ''
  let matches: NodeObj[] = []
  let index = -1
  let revealed = new Set<string>()
  let highlighted: Topic | null = null

  const createWrapper = mind.createWrapper.bind(mind)
  mind.createWrapper = (node, omitChildren) => {
    if (node.expanded !== false || !revealed.has(node.id)) return createWrapper(node, omitChildren)
    // Mind Elixir reads the flag while it creates the subtree's DOM. Restore it
    // synchronously so save, clipboard and undo always see the stored fold state.
    node.expanded = true
    try { return createWrapper(node, omitChildren) }
    finally { node.expanded = false }
  }

  function paintMatch() {
    const match = matches[index]
    const topic = match ? findMindMapTopic(mind, match.id) : null
    if (highlighted !== topic) {
      highlighted?.removeAttribute('data-zixi-search-match')
      topic?.setAttribute('data-zixi-search-match', '')
      highlighted = topic
    }
    return topic
  }

  function showMatch(revealPath: boolean) {
    const next = new Set<string>()
    for (let node: NodeObj | undefined = matches[index]; node; node = node.parent) {
      if (node.expanded === false && (revealPath || revealed.has(node.id))) next.add(node.id)
    }
    const layoutChanged = next.size !== revealed.size || [...next].some((id) => !revealed.has(id))
    revealed = next
    if (layoutChanged) refreshView()
    const topic = paintMatch()
    if (revealPath && topic) {
      const target = topic.getBoundingClientRect()
      const viewport = mind.container.getBoundingClientRect()
      mind.move((viewport.left + viewport.right - target.left - target.right) / 2,
        (viewport.top + viewport.bottom - target.top - target.bottom) / 2)
    }
    onPosition({ index: index + 1, count: matches.length })
  }

  return {
    search(value: string) {
      query = value.trim().toLowerCase()
      matches = matchingNodes(mind.nodeData, query)
      index = matches.length ? 0 : -1
      showMatch(true)
    },
    step(direction: number) {
      if (!matches.length) return
      index = (index + direction + matches.length) % matches.length
      showMatch(true)
    },
    update() {
      if (!query) return
      const previousId = matches[index]?.id
      matches = matchingNodes(mind.nodeData, query)
      const previousIndex = matches.findIndex((node) => node.id === previousId)
      index = previousIndex >= 0 ? previousIndex : Math.min(Math.max(index, 0), matches.length - 1)
      showMatch(false)
    },
    isFolded(node: NodeObj) { return node.expanded === false && !revealed.has(node.id) },
    keepManualFold(node: NodeObj) { revealed.delete(node.id) },
    paintMatch,
  }
}
