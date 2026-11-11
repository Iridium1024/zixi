import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ThemeSwitcher } from './ThemeSwitcher'

afterEach(cleanup)
it('opens the compact theme group, selects system mode and closes it', () => {
  const onChange = vi.fn()
  render(<ThemeSwitcher value="dark" collapsed onChange={onChange} />)
  const trigger = screen.getByRole('button', { name: '主题切换' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('group')).not.toBeInTheDocument()
  fireEvent.click(trigger)
  expect(screen.getByRole('group', { name: '快速主题切换' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '自动' }))
  expect(onChange).toHaveBeenCalledWith('system')
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(trigger).toHaveFocus()
  fireEvent.click(trigger)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})
