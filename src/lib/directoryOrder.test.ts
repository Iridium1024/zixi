import { expect, it } from 'vitest'
import { insertionTarget, moveBefore, orderItems } from './directoryOrder'

it('moves a selected block in directory order and retains items outside the filtered list', () => {
  expect(moveBefore(['a', 'b', 'c', 'd'], ['c', 'a'], 'd')).toEqual(['b', 'a', 'c', 'd'])
  expect(insertionTarget(['a', 'b', 'c'], ['a'], 'c', true)).toBeNull()
  expect(insertionTarget(['a', 'b', 'c', 'd'], ['a', 'c'], 'b', true)).toBe('d')
  expect(moveBefore(['a', 'b', 'c'], ['a'], null)).toEqual(['b', 'c', 'a'])
  expect(moveBefore(['a', 'b', 'c'], ['b'], 'b')).toEqual(['a', 'b', 'c'])
  expect(orderItems([{ id: 'new' }, { id: 'a' }, { id: 'b' }], ['b', 'a'])).toEqual([{ id: 'b' }, { id: 'a' }, { id: 'new' }])
})
