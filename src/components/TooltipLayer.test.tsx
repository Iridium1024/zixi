import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { TooltipLayer } from './TooltipLayer'

afterEach(cleanup)

it('suppresses native titles, describes focused controls and updates a visible hint', async () => {
  render(<><button title="旧说明">控件</button><TooltipLayer /></>)
  const trigger = screen.getByRole('button', { name: '控件' })
  expect(trigger).not.toHaveAttribute('title')
  fireEvent.focusIn(trigger)
  expect(await screen.findByRole('tooltip')).toHaveTextContent('旧说明')
  expect(trigger).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id)
  trigger.setAttribute('title', '更新后的说明')
  await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('更新后的说明'))
  expect(trigger).not.toHaveAttribute('title')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  expect(trigger).not.toHaveAttribute('aria-describedby')
})

it('covers dynamically inserted icon controls and restores their titles on cleanup', async () => {
  const view = render(<TooltipLayer />)
  const button = document.createElement('button')
  button.title = '动态操作'
  document.body.append(button)
  try {
    await waitFor(() => expect(button).not.toHaveAttribute('title'))
    expect(button).toHaveAttribute('aria-label', '动态操作')
    fireEvent.mouseOver(button)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('动态操作')
    fireEvent.pointerDown(button)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    view.unmount()
    expect(button).toHaveAttribute('title', '动态操作')
    expect(button).not.toHaveAttribute('aria-label')
  } finally { button.remove() }
})
