import type MindElixir from 'mind-elixir'
import type { Topic } from 'mind-elixir'

interface BranchNode {
  topic: Topic
  left: number
  right: number
  anchor: number
}

const singleChildWrapper = 'me-wrapper:has(> me-children > me-wrapper:only-child)'
const singleChildOffset = '--zixi-single-child-offset'

function anchorY(topic: Topic, bounds?: DOMRect) {
  if (topic.nodeObj.parent?.parent) return topic.parentElement.getBoundingClientRect().bottom
  const rect = bounds ?? topic.getBoundingClientRect()
  return (rect.top + rect.bottom) / 2
}

function alignPair(container: HTMLElement, parent: Topic, child: Topic, scale: number) {
  const parentBounds = parent.getBoundingClientRect()
  const childBounds = child.getBoundingClientRect()
  if (!parentBounds.width || !childBounds.width) return
  const delta = (anchorY(child, childBounds) - anchorY(parent, parentBounds)) / scale
  if (Math.abs(delta) < 1 / 32) return
  // Positive offsets move the parent down. Negative offsets move the child subtree down.
  const previous = Number.parseFloat(container.style.getPropertyValue(singleChildOffset)) || 0
  const offset = Math.round((previous + delta) * 64) / 64
  container.style.setProperty(singleChildOffset, `${offset}px`)
}

export function alignMindMapBranches(mind: MindElixir) {
  const singleRootChild = mind.direction !== 3 && mind.nodeData.children?.length === 1
  mind.nodes.toggleAttribute('data-zixi-align-root', singleRootChild)
  if (mind.direction === 3 || mind.nodes.classList.contains('zixi-root-folded')) return

  // The child's attachment point depends on the layout of its own descendants.
  const wrappers = Array.from(mind.nodes.querySelectorAll<HTMLElement>(singleChildWrapper))
  for (const wrapper of wrappers.reverse()) {
    const parent = wrapper.querySelector<Topic>(':scope > me-parent > me-tpc')
    const child = wrapper.querySelector<Topic>(':scope > me-children > me-wrapper > me-parent > me-tpc')
    if (parent && child) alignPair(wrapper, parent, child, mind.scaleVal)
  }
  if (singleRootChild) {
    const root = mind.nodes.querySelector<Topic>(':scope > me-root > me-tpc')
    const child = mind.nodes.querySelector<Topic>(':scope > me-main > me-wrapper > me-parent > me-tpc')
    if (root && child) alignPair(mind.nodes, root, child, mind.scaleVal)
  }
}

function appendPath(svg: DocumentFragment, path: string, color: string, width: number) {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  line.setAttribute('d', path)
  line.setAttribute('fill', 'none')
  line.setAttribute('stroke', color)
  line.setAttribute('stroke-width', String(width))
  line.setAttribute('stroke-linecap', 'round')
  line.setAttribute('stroke-linejoin', 'round')
  svg.appendChild(line)
}

function drawChildren(svg: DocumentFragment, parent: BranchNode, children: BranchNode[], side: -1 | 1, color: string, topLevel = false) {
  if (!children.length) return
  const startX = side === 1 ? parent.right : parent.left
  const startY = parent.anchor
  const width = topLevel ? 3 : 2
  const endpoints = children.map((child) => {
    const x = side === 1 ? child.left : child.right
    const endX = side === 1 ? child.right : child.left
    return { x, y: child.anchor, tail: topLevel ? '' : ` H ${endX}` }
  })
  if (endpoints.length === 1) {
    const [end] = endpoints
    const segment = parent.topic.nodeObj.children?.length === 1 ? `H ${end.x}` : `L ${end.x} ${end.y}`
    appendPath(svg, `M ${startX} ${startY} ${segment}${end.tail}`, color, width)
    return
  }

  const gap = Math.min(...endpoints.map((end) => (end.x - startX) * side))
  const forkX = startX + side * Math.max(0, gap) * 0.5
  const forks = endpoints.map((end) => {
    const radius = Math.min(12, Math.abs(end.y - startY), Math.abs(end.x - forkX) / 2)
    return { ...end, radius, startY: end.y - Math.sign(end.y - startY) * radius }
  })
  const top = Math.min(startY, ...forks.map((fork) => fork.startY))
  const bottom = Math.max(startY, ...forks.map((fork) => fork.startY))
  appendPath(svg, `M ${startX} ${startY} H ${forkX} M ${forkX} ${top} V ${bottom}`, color, width)
  for (const fork of forks) {
    const curve = fork.radius ? ` Q ${forkX} ${fork.y} ${forkX + side * fork.radius} ${fork.y}` : ''
    appendPath(svg, `M ${forkX} ${fork.startY}${curve} H ${fork.x}${fork.tail}`, color, width)
  }
}

export function drawMindMapBranches(mind: MindElixir) {
  if (mind.direction === 3) return
  const origin = mind.nodes.getBoundingClientRect()
  const toX = (x: number) => Math.round((x - origin.left) / mind.scaleVal * 10) / 10
  const toY = (y: number) => Math.round((y - origin.top) / mind.scaleVal * 10) / 10
  const nodes = new Map<string, BranchNode>()
  for (const topic of mind.nodes.querySelectorAll<Topic>('me-tpc')) {
    const rect = topic.getBoundingClientRect()
    if (!rect.width || !rect.height) continue
    nodes.set(topic.nodeObj.id, {
      topic, left: toX(rect.left), right: toX(rect.right), anchor: toY(anchorY(topic, rect)),
    })
  }

  const renderedChildren = (parent: BranchNode) => {
    const children: BranchNode[] = []
    for (const node of parent.topic.nodeObj.children ?? []) {
      const child = nodes.get(node.id)
      if (child) children.push(child)
    }
    return children
  }
  const svg = document.createDocumentFragment()
  const root = nodes.get(mind.nodeData.id)
  if (root) {
    const left: BranchNode[] = []
    const right: BranchNode[] = []
    for (const child of renderedChildren(root)) {
      if (child.topic.closest('me-main.lhs')) left.push(child)
      else right.push(child)
    }
    const rootBackground = getComputedStyle(root.topic).backgroundColor
    const rootColor = rootBackground === 'rgba(0, 0, 0, 0)' ? mind.theme.cssVar['--root-bgcolor'] : rootBackground
    for (const { side, children } of [{ side: -1 as const, children: left }, { side: 1 as const, children: right }]) {
      drawChildren(svg, root, children, side, rootColor, true)
      const pending = children.map((node) => ({ node, color: node.topic.style.borderColor || rootColor }))
      while (pending.length) {
        const { node, color } = pending.pop()!
        const descendants = renderedChildren(node)
        drawChildren(svg, node, descendants, side, color)
        for (const child of descendants) pending.push({ node: child, color: child.topic.nodeObj.branchColor || color })
      }
    }
  }

  // Keep the library's arrow and summary layers. Draw the tree paths in its main SVG.
  mind.lines.replaceChildren(svg)
  for (const layer of mind.nodes.querySelectorAll('svg.subLines')) layer.replaceChildren()
}
