import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { NavigationTarget } from '../../components/WorkspaceNavigation'
import { DEFAULT_APPEARANCE } from '../settings/appearance'
import { DEFAULT_WINDOW_BEHAVIOR } from '../settings/windowBehavior'
import { NotesWorkspace } from './NotesWorkspace'
import { createNote, getNote, moveNoteToTrash } from './noteRepository'
import { mutateNoteFolder, readNoteFolders } from './noteFolders'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

it('Ctrl-selects notes without switching the editor and confirms deletion beside the directory button', async () => {
  const first = await createNote({ title: '多选一', content: '保留编辑中的文字' })
  const second = await createNote({ title: '多选二' })
  render(<NotesWorkspace appearance={DEFAULT_APPEARANCE} windowBehavior={DEFAULT_WINDOW_BEHAVIOR} />)
  await screen.findByPlaceholderText('记录灵感、待办或会议信息…')
  fireEvent.click(document.querySelector(`[data-note-id="${first.id}"]`)!)
  await waitFor(() => expect(screen.getByRole('textbox', { name: '便签标题' })).toHaveValue(first.title))
  fireEvent.change(screen.getByPlaceholderText('记录灵感、待办或会议信息…'), { target: { value: '删除前的草稿' } })
  fireEvent.click(document.querySelector(`[data-note-id="${second.id}"]`)!, { ctrlKey: true })
  expect(document.querySelectorAll('[data-note-id][aria-pressed="true"]')).toHaveLength(2)
  expect(screen.getByRole('textbox', { name: '便签标题' })).toHaveValue(first.title)
  fireEvent.click(screen.getByRole('button', { name: '移至回收站' }))
  expect(screen.getByRole('alertdialog')).toHaveTextContent('所选 2 张')
  expect((await getNote(first.id))?.deletedAt).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '确认移至回收站' }))
  await waitFor(async () => expect((await getNote(first.id))?.deletedAt).not.toBeNull())
  await waitFor(async () => expect((await getNote(second.id))?.deletedAt).not.toBeNull())
  expect((await getNote(first.id))?.content).toBe('删除前的草稿')
})

it('allows Ctrl-click to deselect every item without deleting the open editor', async () => {
  const note = await createNote({ title: '可以取消选择' })
  render(<NotesWorkspace appearance={DEFAULT_APPEARANCE} windowBehavior={DEFAULT_WINDOW_BEHAVIOR} />)
  await screen.findByPlaceholderText('记录灵感、待办或会议信息…')
  fireEvent.click(document.querySelector(`[data-note-id="${note.id}"]`)!, { ctrlKey: true })
  expect(document.querySelectorAll('[data-note-id][aria-pressed="true"]')).toHaveLength(0)
  expect(screen.getByRole('button', { name: '移至回收站' })).toBeDisabled()
})

it('keeps the editor draft and notes intact when deleting its folder from the shared directory', async () => {
  const note = await createNote({ title: '项目便签', content: '原文' })
  await mutateNoteFolder({ action: 'create', id: 'f', name: '测试项目' })
  await mutateNoteFolder({ action: 'move', noteId: note.id, folderId: 'f' })
  const directory = document.createElement('div')
  document.body.append(directory)
  try {
    render(<NavigationTarget value={directory}><NotesWorkspace appearance={DEFAULT_APPEARANCE} windowBehavior={DEFAULT_WINDOW_BEHAVIOR} /></NavigationTarget>)
    const editor = await screen.findByPlaceholderText('记录灵感、待办或会议信息…')
    await screen.findByRole('button', { name: '删除文件夹测试项目' })
    expect(directory.querySelector('#note-list-panel')).not.toBeNull()
    fireEvent.change(editor, { target: { value: '仍在编辑的草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '删除文件夹测试项目' }))
    expect(screen.getByRole('alertdialog', { name: '删除文件夹确认' })).toHaveTextContent('保留并移回未分类')
    fireEvent.click(screen.getByRole('button', { name: '确认删除文件夹' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(editor).toHaveValue('仍在编辑的草稿')
    expect(await readNoteFolders()).toEqual({ folders: [], entries: {} })
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(async () => expect((await getNote(note.id))?.content).toBe('仍在编辑的草稿'))
    expect((await getNote(note.id))?.deletedAt).toBeNull()
  } finally { directory.remove() }
})

it('moves a note from its list menu without losing an in-flight editor draft', async () => {
  const note = await createNote({ title: '待归类', content: '原文' })
  await mutateNoteFolder({ action: 'create', id: 'f', name: '新项目' })
  render(<NotesWorkspace appearance={DEFAULT_APPEARANCE} windowBehavior={DEFAULT_WINDOW_BEHAVIOR} />)
  const editor = await screen.findByPlaceholderText('记录灵感、待办或会议信息…')
  fireEvent.change(editor, { target: { value: '移动时仍在编辑' } })
  fireEvent.click(screen.getByRole('button', { name: '便签待归类的更多操作' }))
  fireEvent.click(await screen.findByRole('menuitemradio', { name: '新项目' }))
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  expect(editor).toHaveValue('移动时仍在编辑')
  expect(await readNoteFolders()).toMatchObject({ entries: { [note.id]: 'f' } })
  expect(screen.getByRole('img', { name: '所属文件夹：新项目' })).toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: '便签所在文件夹' })).not.toBeInTheDocument()
  fireEvent.keyDown(window, { key: 's', ctrlKey: true })
  await waitFor(async () => expect((await getNote(note.id))?.content).toBe('移动时仍在编辑'))
})

it('searches in a modal, restores keyboard focus, and saves before selecting another note', async () => {
  const note = await createNote({ title: '第一张', content: '原文' })
  const other = await createNote({ title: '另一张', content: '可检索正文' })
  const root = document.createElement('div')
  root.id = 'root'
  document.body.append(root)
  try {
    render(<NotesWorkspace appearance={DEFAULT_APPEARANCE} windowBehavior={DEFAULT_WINDOW_BEHAVIOR} />, { container: root })
    await screen.findByPlaceholderText('记录灵感、待办或会议信息…')
    fireEvent.click(document.querySelector(`[data-note-id="${note.id}"]`)!)
    await waitFor(() => expect(screen.getByRole('textbox', { name: '便签标题' })).toHaveValue('第一张'))
    fireEvent.change(screen.getByPlaceholderText('记录灵感、待办或会议信息…'), { target: { value: '切换前的草稿' } })
    const trigger = screen.getByRole('button', { name: '搜索便签' })
    trigger.focus()
    fireEvent.click(trigger)
    expect(root.inert).toBe(true)
    expect(screen.getByRole('textbox', { name: '搜索便签内容' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(root.inert).toBe(false)
    expect(trigger).toHaveFocus()
    fireEvent.click(trigger)
    fireEvent.change(screen.getByRole('textbox', { name: '搜索便签内容' }), { target: { value: '可检索正文' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /另一张/ }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '便签标题' })).toHaveValue(other.title))
    expect((await getNote(note.id))?.content).toBe('切换前的草稿')
    expect(root.inert).toBe(false)
  } finally { root.remove() }
})

it('keeps filtered batch restore scoped to the trash search results', async () => {
  const first = await createNote({ title: '匹配一' })
  const second = await createNote({ title: '匹配二' })
  const untouched = await createNote({ title: '其它内容' })
  await Promise.all([first, second, untouched].map(moveNoteToTrash))
  render(<NotesWorkspace appearance={DEFAULT_APPEARANCE} windowBehavior={DEFAULT_WINDOW_BEHAVIOR} trashMode />)
  await screen.findByRole('button', { name: '搜索回收站' })
  await waitFor(() => expect(document.querySelectorAll('[data-note-id]')).toHaveLength(3))
  fireEvent.click(screen.getByRole('button', { name: '搜索回收站' }))
  fireEvent.change(screen.getByRole('textbox', { name: '搜索便签内容' }), { target: { value: '匹配' } })
  fireEvent.click(screen.getByRole('button', { name: '筛选回收站列表' }))
  expect(document.querySelectorAll('[data-note-id]')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: '选择' }))
  fireEvent.click(screen.getByRole('button', { name: '全选当前筛选结果' }))
  fireEvent.click(screen.getByRole('button', { name: '恢复所选' }))
  await waitFor(async () => expect((await getNote(first.id))?.deletedAt).toBeNull())
  expect((await getNote(second.id))?.deletedAt).toBeNull()
  expect((await getNote(untouched.id))?.deletedAt).not.toBeNull()
})
