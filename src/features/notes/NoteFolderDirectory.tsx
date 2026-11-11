import { SelectControl } from '../../components/FormControls'
import { Popconfirm } from '../../components/Popconfirm'
import { DIRECTORY_DRAG, readDirectoryDrag, insertionTarget, moveBefore, orderItems } from '../../lib/directoryOrder'
import { ChevronDown, ChevronRight, Folder, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useImperativeHandle, useState, type Ref } from 'react'
import { FloatingMenu } from '../../components/FloatingMenu'
import { newFolderId, type FolderMutation, type NoteFolderState } from './noteFolders'
import type { NoteRecord } from './types'

export interface NoteFolderDirectoryHandle { create(): void }

export function NoteFolderDirectory({ ref, state, notes, selectedId, selectedIds, disabled, query, filter, onFilter, onSelect, onMutate }: {
  ref?: Ref<NoteFolderDirectoryHandle>
  state: NoteFolderState; notes: NoteRecord[]; selectedId: string | null; disabled: boolean; query: string
  selectedIds: ReadonlySet<string>; filter: string; onFilter(value: string): void; onSelect(id: string, additive?: boolean): void
  onMutate(input: FolderMutation): Promise<boolean>
}) {
  const [closed, setClosed] = useState<Set<string>>(() => new Set())
  const [editing, setEditing] = useState<{ id: string; name: string; creating: boolean } | null>(null)
  const [moveMenu, setMoveMenu] = useState<{ noteId: string; anchor: HTMLElement; point?: { x: number; y: number } } | null>(null)
  const closeMoveMenu = useCallback(() => setMoveMenu(null), [])
  useImperativeHandle(ref, () => ({ create: () => { setEditing({ id: newFolderId(), name: '', creating: true }) } }), [])
  useEffect(() => {
    if (!selectedId) return
    const folderId = state.entries[selectedId] ?? ''
    setClosed((current) => { if (!current.has(folderId)) return current; const next = new Set(current); next.delete(folderId); return next })
  }, [selectedId, state.entries])
  const movingNote = notes.find((note) => note.id === moveMenu?.noteId)
  const groups = [{ id: '', name: '未分类' }, ...orderItems(state.folders, state.orders?.folder)]
  async function drop(data: DataTransfer, folderId: string, beforeId: string | null = null, afterFolder = false) {
    const item = readDirectoryDrag(data)
    if (!item || disabled) return
    if (item.kind === 'folder' && folderId) {
      await onMutate({ action: 'reorder', kind: 'folder', ids: moveBefore(groups.filter((group) => group.id).map((group) => group.id), item.ids, insertionTarget(groups.filter((group) => group.id).map((group) => group.id), item.ids, folderId, afterFolder)) })
    } else if (item.kind === 'note') {
      if (item.ids.some((id) => (state.entries[id] ?? '') !== folderId)) {
        if (!await onMutate({ action: 'moveMany', noteIds: item.ids, folderId: folderId || null })) return
      }
      await onMutate({ action: 'reorder', kind: 'note', ids: moveBefore(orderItems(notes, state.orders?.note).map((note) => note.id), item.ids, beforeId) })
    }
  }
  const dragStart = (data: DataTransfer, kind: string, ids: string[]) => { data.effectAllowed = 'move'; data.setData(DIRECTORY_DRAG, JSON.stringify({ kind, ids })) }
  return <div className="folder-directory">
    <div className="folder-filter"><SelectControl aria-label="按文件夹筛选" value={filter} onChange={(event) => onFilter(event.target.value)}><option value="all">全部便签</option>{groups.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</SelectControl></div>
    {editing && <form className="folder-form" onSubmit={(event) => {
      event.preventDefault()
      void onMutate({ action: editing.creating ? 'create' : 'rename', id: editing.id, name: editing.name }).then((ok) => { if (ok) setEditing(null) })
    }}><input autoFocus aria-label="文件夹名称" placeholder="文件夹名称" maxLength={80} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /><div><button className="secondary-button" type="button" onClick={() => setEditing(null)}>取消</button><button className="primary-button" disabled={disabled || !editing.name.trim()}>保存文件夹</button></div></form>}

    <div className="folder-groups">
      {groups.filter((group) => filter === 'all' || filter === group.id).map((group) => {
        const members = orderItems(notes, state.orders?.note).filter((note) => (state.entries[note.id] ?? '') === group.id)
        const collapsed = !query && closed.has(group.id)
        return <section className="note-folder-group" key={group.id || 'uncategorized'} onDragOver={(event) => { if (!disabled && event.dataTransfer.types.includes(DIRECTORY_DRAG)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; event.currentTarget.dataset.dropEdge = 'into' } }} onDragLeave={(event) => { delete event.currentTarget.dataset.dropEdge }} onDrop={(event) => { event.preventDefault(); delete event.currentTarget.dataset.dropEdge; const heading = event.currentTarget.querySelector('.folder-heading')!.getBoundingClientRect(); void drop(event.dataTransfer, group.id, null, event.clientY > heading.top + heading.height / 2) }}>
          <div className="folder-heading" draggable={Boolean(group.id) && !disabled} onDragStart={(event) => { event.stopPropagation(); dragStart(event.dataTransfer, 'folder', [group.id]) }}><button className="folder-toggle" aria-label={`${collapsed ? '展开' : '收起'}${group.name}`} aria-expanded={!collapsed} data-tooltip-overflow title={group.name} onClick={() => setClosed((current) => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next })}>{collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}<Folder size={14} /><span>{group.name}</span><small>{members.length}</small></button>{group.id && <><button className="folder-action" aria-label={`重命名文件夹${group.name}`} title="重命名文件夹" disabled={disabled} onClick={() => { setEditing({ ...group, creating: false }) }}><Pencil size={13} /></button><Popconfirm title="删除文件夹确认" description={`删除“${group.name}”？便签将保留并移回未分类。`} confirmLabel="确认删除文件夹" disabled={disabled} onConfirm={async () => { const ok = await onMutate({ action: 'delete', id: group.id }); if (ok && filter === group.id) onFilter('all'); return ok }} trigger={<button className="folder-action" aria-label={`删除文件夹${group.name}`} title="删除文件夹，保留便签"><Trash2 size={13} /></button>} /></>}</div>
          <div className={`folder-children ${collapsed ? 'collapsed' : ''}`} inert={collapsed} aria-hidden={collapsed}><div>{members.map((note) => <div className={`note-list-row ${selectedIds.has(note.id) ? 'selected' : ''}`} key={note.id} draggable={!disabled} onDragStart={(event) => { event.stopPropagation(); dragStart(event.dataTransfer, 'note', selectedIds.has(note.id) ? [...selectedIds] : [note.id]) }} onDragOver={(event) => { if (!disabled && event.dataTransfer.types.includes(DIRECTORY_DRAG)) { event.preventDefault(); event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); event.currentTarget.dataset.dropEdge = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before' } }} onDragLeave={(event) => { delete event.currentTarget.dataset.dropEdge }} onDrop={(event) => { delete event.currentTarget.dataset.dropEdge; const item = readDirectoryDrag(event.dataTransfer); if (item?.kind === 'note') { event.preventDefault(); event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); void drop(event.dataTransfer, group.id, insertionTarget(orderItems(notes, state.orders?.note).map((entry) => entry.id), item.ids, note.id, event.clientY > rect.top + rect.height / 2)) } }}>
            <button data-note-id={note.id} data-tooltip-overflow title={note.title || '未命名便签'} disabled={disabled} className={`note-list-item ${selectedIds.has(note.id) ? 'selected' : ''}`} aria-pressed={selectedIds.has(note.id)} onClick={(event) => onSelect(note.id, event.ctrlKey || event.metaKey)} onContextMenu={(event) => { event.preventDefault(); if (!disabled) setMoveMenu({ noteId: note.id, anchor: event.currentTarget, point: { x: event.clientX, y: event.clientY } }) }}><strong>{note.title || '未命名便签'}</strong></button>
            <button className="note-more ghost-icon" disabled={disabled} aria-label={`便签${note.title || '未命名便签'}的更多操作`} title="移动到文件夹" aria-haspopup="menu" aria-expanded={moveMenu?.noteId === note.id} onClick={(event) => setMoveMenu(moveMenu?.noteId === note.id ? null : { noteId: note.id, anchor: event.currentTarget })}><MoreHorizontal size={15} /></button>
          </div>)}</div></div>
        </section>
      })}
      {!notes.length && <p className="directory-empty">{query ? '没有匹配的搜索结果' : '还没有便签，点击上方 + 新建'}</p>}
    </div>
    {moveMenu && movingNote && <FloatingMenu anchor={moveMenu.anchor} point={moveMenu.point} label="移动便签到文件夹" onClose={closeMoveMenu}>
      <strong className="menu-heading">移动到文件夹</strong>
      {groups.map((folder) => <button key={folder.id} role="menuitemradio" aria-checked={(state.entries[movingNote.id] ?? '') === folder.id} disabled={disabled} onClick={() => void onMutate({ action: 'moveMany', noteIds: selectedIds.has(movingNote.id) ? [...selectedIds] : [movingNote.id], folderId: folder.id || null }).then((ok) => { if (ok) { moveMenu.anchor.focus(); closeMoveMenu() } })}><Folder size={14} /><span>{folder.name}</span></button>)}
    </FloatingMenu>}
  </div>
}
