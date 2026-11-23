import type MindElixir from 'mind-elixir'
import type { NodeObj, Topic } from 'mind-elixir'

function measureWrappedTopics(mind: MindElixir, topics: Topic[]) {
  // Measure the full text without the button so its own width cannot trigger it.
  mind.nodes.classList.add('zixi-measure-topic-text')
  const range = document.createRange()
  const wraps = topics.map((topic) => {
    const text = topic.text
    if (!text || !topic.contains(text)) return false
    range.selectNodeContents(text)
    const lines = Array.from(range.getClientRects())
    return lines.some((line) => line.top - lines[0].top > line.height / 2)
  })
  mind.nodes.classList.remove('zixi-measure-topic-text')
  return wraps
}

export function decorateMindMapTopics(mind: MindElixir, isFolded: (node: NodeObj) => boolean, classic: boolean) {
  const topics = Array.from(mind.nodes.querySelectorAll<Topic>('me-tpc'))
  mind.nodes.classList.toggle('zixi-root-folded', isFolded(mind.nodeData))
  const wraps = classic ? [] : measureWrappedTopics(mind, topics)

  for (const [index, topic] of topics.entries()) {
    const node = topic.nodeObj
    const hasChildren = Boolean(node.children?.length)
    const folded = isFolded(node)
    const wrapsText = classic || wraps[index]
    topic.toggleAttribute('data-zixi-text-folded', wrapsText && folded)
    topic.toggleAttribute('data-zixi-branch-fold', !wrapsText && hasChildren)
    topic.title = wrapsText && folded ? node.topic : ''

    let label = topic.querySelector<HTMLElement>(':scope > .zixi-node-label')
    let button = (label ?? topic).querySelector<HTMLButtonElement>(':scope > .zixi-node-fold')
    if (!wrapsText && !hasChildren) {
      button?.remove()
      continue
    }
    if (classic && label) {
      label.replaceWith(...label.childNodes)
      label = null
    } else if (!classic && !label) {
      label = document.createElement('span')
      label.className = 'zixi-node-label'
      const text = topic.text
      if (text?.parentElement === topic) {
        text.before(label)
        label.appendChild(text)
      } else topic.appendChild(label)
    }
    if (!button) {
      button = document.createElement('button')
      button.type = 'button'
      button.className = 'zixi-node-fold'
    }
    const controls = label ?? topic
    if (button.parentElement !== controls) controls.appendChild(button)
    button.textContent = classic ? folded ? '▸' : '▾' : ''
    const action = folded ? '展开' : '折叠'
    button.title = `${action}此节点`
    button.setAttribute('aria-label', `${button.title}：${node.topic}`)
    button.setAttribute('aria-expanded', String(!folded))
  }
}
