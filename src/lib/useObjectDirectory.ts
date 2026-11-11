import { useCallback, useEffect, useState, type DragEvent } from 'react'
import { mutateNoteFolder, readNoteFolders } from '../features/notes/noteFolders'
import { subscribeNoteEvents } from '../features/notes/noteEvents'
import { DIRECTORY_DRAG, insertionTarget, moveBefore, orderItems, readDirectoryDrag } from './directoryOrder'

export function useObjectDirectory(kind: 'mindmap' | 'book', onError: (message: string) => void) {
  const [order, setOrder] = useState<string[]>([])
  const [selectionActive, setSelectionActive] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [savingOrder, setSavingOrder] = useState(false)
  useEffect(() => {
    let cancelled = false
    let dispose: (() => void) | undefined
    const load = async () => { try { const state = await readNoteFolders(); if (!cancelled) setOrder(state.orders?.[kind] ?? []) } catch { if (!cancelled) onError('目录顺序读取失败，请重试') } }
    void load()
    void subscribeNoteEvents((event) => { if (event.action === 'folders-changed') void load() }).then((unlisten) => { if (cancelled) unlisten(); else dispose = unlisten })
    return () => { cancelled = true; dispose?.() }
  }, [kind, onError])
  const choose = (id: string, additive: boolean, current?: string) => {
    if (!additive) { setSelectionActive(true); setSelected(new Set([id])); return false }
    setSelectionActive(true)
    setSelected((old) => { const next = new Set(selectionActive ? old : current ? [current] : []); if (next.has(id)) next.delete(id); else next.add(id); return next })
    return true
  }
  const reorder = useCallback(async (items: { id: string }[], ids: string[], target: string | null) => {
    if (savingOrder) return false
    setSavingOrder(true)
    try { const state = await mutateNoteFolder({ action: 'reorder', kind, ids: moveBefore(items.map((item) => item.id), ids, target) }); setOrder(state.orders?.[kind] ?? []); return true }
    catch { onError('目录排序保存失败，请重试'); return false }
    finally { setSavingOrder(false) }
  }, [kind, onError, savingOrder])
  function dragProps(id: string, items: { id: string }[], disabled = false, afterDrop?: () => void) {
    return {
      draggable: !disabled && !savingOrder,
      onDragStart(event: DragEvent) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData(DIRECTORY_DRAG, JSON.stringify({ kind, ids: selected.has(id) ? [...selected] : [id] })) },
      onDragOver(event: DragEvent<HTMLElement>) { if (!disabled && !savingOrder && event.dataTransfer.types.includes(DIRECTORY_DRAG)) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); event.currentTarget.dataset.dropEdge = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before' } },
      onDragLeave(event: DragEvent<HTMLElement>) { delete event.currentTarget.dataset.dropEdge },
      onDrop(event: DragEvent<HTMLElement>) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); delete event.currentTarget.dataset.dropEdge; if (disabled) return; const item = readDirectoryDrag(event.dataTransfer); if (item?.kind === kind) void reorder(items, item.ids, insertionTarget(items.map((entry) => entry.id), item.ids, id, event.clientY > rect.top + rect.height / 2)).then((ok) => { if (ok) afterDrop?.() }) },
    }
  }
  return { order, selected, selectionActive, choose, dragProps, ordered: <T extends { id: string }>(items: T[]) => orderItems(items, order) }
}
