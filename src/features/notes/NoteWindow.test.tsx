import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteWindowTitlebar } from './NoteWindow'

afterEach(cleanup)

function renderTitlebar(title = '一个非常长但仍然可以拖动的便签标题') {
  const actions = {
    onTitleChange: vi.fn(),
    onTogglePin: vi.fn(),
    onMinimize: vi.fn(),
    onRequestClose: vi.fn(),
    onStartDragging: vi.fn(),
  }
  render(<NoteWindowTitlebar title={title} disabled={false} alwaysOnTop={false} {...actions} />)
  return actions
}

describe('floating note titlebar', () => {
  it('keeps the visible title inside the draggable surface', () => {
    const actions = renderTitlebar()
    const dragRegion = screen.getByTitle('拖动窗口；双击最小化')

    expect(screen.getByText('一个非常长但仍然可以拖动的便签标题')).toBeInTheDocument()
    fireEvent.mouseDown(dragRegion, { button: 0 })
    expect(actions.onStartDragging).toHaveBeenCalledOnce()

    fireEvent.mouseDown(dragRegion, { button: 2 })
    expect(actions.onStartDragging).toHaveBeenCalledOnce()
  })

  it('edits only after an explicit rename action and isolates title input gestures', () => {
    const actions = renderTitlebar('原标题')
    fireEvent.click(screen.getByRole('button', { name: '重命名便签' }))

    const input = screen.getByRole('textbox', { name: '便签标题' })
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: '新标题' } })
    expect(actions.onTitleChange).toHaveBeenCalledWith('新标题')

    fireEvent.doubleClick(input)
    expect(actions.onMinimize).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByRole('textbox', { name: '便签标题' })).not.toBeInTheDocument()
  })

  it('limits double-click minimization to the draggable surface', () => {
    const actions = renderTitlebar()
    fireEvent.doubleClick(screen.getByTitle('拖动窗口；双击最小化'))
    expect(actions.onMinimize).toHaveBeenCalledOnce()

    fireEvent.doubleClick(screen.getByRole('button', { name: '重命名便签' }))
    expect(actions.onMinimize).toHaveBeenCalledOnce()
  })
})
