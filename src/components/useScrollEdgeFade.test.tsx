import { act, cleanup, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, expect, it } from 'vitest'
import { measureScrollEdgeFade, useScrollEdgeFade } from './useScrollEdgeFade'

afterEach(cleanup)
const box = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON() {} })

it('reserves only overlapping footer space and keeps the native scrollbar unmasked', () => {
  const editor = document.createElement('textarea'), footer = document.createElement('footer')
  Object.defineProperties(editor, { clientHeight: { value: 100 }, scrollHeight: { value: 300 }, offsetWidth: { value: 108 }, clientWidth: { value: 100 } })
  editor.getBoundingClientRect = () => box(0, 100)
  footer.getBoundingClientRect = () => box(100, 130)
  measureScrollEdgeFade(editor, footer)
  expect(editor.style.getPropertyValue('--edge-bottom-reserve')).toBe('0px')
  expect(editor.style.getPropertyValue('--edge-scrollbar-gutter')).toBe('8px')
  footer.getBoundingClientRect = () => box(70, 100)
  measureScrollEdgeFade(editor, footer)
  expect(editor.style.getPropertyValue('--edge-bottom-reserve')).toBe('46px')
  editor.scrollTop = 200
  measureScrollEdgeFade(editor)
  expect(editor.dataset).toMatchObject({ edgeTop: 'true', edgeBottom: 'false' })
})

it('subscribes when a saved note editor appears after the initial loading render', () => {
  function Test({ loaded }: { loaded: boolean }) {
    const editor = useRef<HTMLTextAreaElement>(null)
    useScrollEdgeFade(editor, loaded)
    return loaded ? <textarea ref={editor} aria-label="便签正文" /> : null
  }
  const view = render(<Test loaded={false} />)
  view.rerender(<Test loaded />)
  const editor = screen.getByRole('textbox')
  Object.defineProperties(editor, { clientHeight: { value: 100 }, scrollHeight: { value: 300 } })
  act(() => { editor.scrollTop = 10; editor.dispatchEvent(new Event('scroll')) })
  expect(editor.dataset).toMatchObject({ edgeTop: 'true', edgeBottom: 'true' })
})
