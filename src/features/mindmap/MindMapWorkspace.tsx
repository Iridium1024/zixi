import { DirectoryHeader } from '../../components/DirectoryHeader'
import { useObjectDirectory } from '../../lib/useObjectDirectory'
import { ViewStatus, isFailureStatus } from '../../components/ViewStatus'
import { WorkspaceNavigation, useUnifiedNavigation } from '../../components/WorkspaceNavigation'
import { Clipboard, CornerDownRight, Crosshair, ExternalLink, FileInput, GitBranchPlus, Maximize, Pencil, Plus, Redo2, Save, Trash2, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { pickMindMapCollaborationFile } from '../../lib/collaborationSnapshot'
import { isTauriRuntime } from '../../lib/platform'
import { useSaveShortcut } from '../../lib/useSaveShortcut'
import { MindMapCanvas, type MindMapCanvasHandle } from './MindMapCanvas'
import { applyMindMapSnapshot, copyMindMapIndex } from './mindMapIndex'
import { subscribeMindMapEvents, type MindMapEvent } from './mindMapEvents'
import { createMindMap, deleteMindMap, getMindMap, listMindMaps, MindMapConflictError, saveMindMap, type MindMapRecord } from './mindMapRepository'
import license from './mind-elixir-license.txt?raw'

interface Props {
  statusMessage?: string
  theme: 'light' | 'dark'
  onStatusChange?(status: string): void
  onBeforeLeaveReady?(handler: (() => Promise<boolean>) | null): void
  standaloneId?: string
}

export function MindMapWorkspace({ statusMessage, theme, onStatusChange, onBeforeLeaveReady, standaloneId }: Props) {
  const unifiedNavigation = useUnifiedNavigation()
  const [maps, setMaps] = useState<MindMapRecord[]>([])
  const [draft, setDraft] = useState<MindMapRecord | null>(null)
  const [status, setStatus] = useState('正在读取导图…')
  const directory = useObjectDirectory('mindmap', setStatus)
  const [busy, setBusy] = useState(false)
  const [prompt, setPrompt] = useState<'index' | 'delete' | 'reload' | null>(null)
  const [conflict, setConflict] = useState(false)
  const [canvasRevision, setCanvasRevision] = useState(0)
  const canvasRef = useRef<MindMapCanvasHandle>(null)
  const draftRef = useRef<MindMapRecord | null>(null)
  const changedVersion = useRef(0)
  const savedVersion = useRef(0)
  const timer = useRef<number | null>(null)
  const saving = useRef<Promise<void> | null>(null)
  const blocked = useRef(false)
  const promptRef = useRef<typeof prompt>(null)
  const mounted = useRef(true)
  const conflictRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }, [])

  const markConflict = useCallback(() => {
    clearTimer()
    conflictRef.current = true
    if (mounted.current) {
      setConflict(true)
      setStatus('另一窗口已更改导图；本地草稿仍保留')
    }
  }, [clearTimer])

  const flush = useCallback(async () => {
    canvasRef.current?.commit()
    clearTimer()
    if (conflictRef.current) throw new MindMapConflictError()
    while (saving.current) await saving.current
    if (conflictRef.current) throw new MindMapConflictError()
    if (!draftRef.current || savedVersion.current >= changedVersion.current) return
    const perform = async () => {
      while (draftRef.current && savedVersion.current < changedVersion.current) {
        if (conflictRef.current) throw new MindMapConflictError()
        const submitted = draftRef.current
        const version = changedVersion.current
        if (mounted.current) setStatus('保存中…')
        const saved = await saveMindMap(submitted)
        savedVersion.current = version
        if (draftRef.current?.id === saved.id) {
          const latest = { ...draftRef.current, updatedAt: saved.updatedAt }
          draftRef.current = latest
          if (mounted.current) setDraft(latest)
        }
        if (mounted.current) setMaps((items) => [saved, ...items.filter((item) => item.id !== saved.id)])
      }
      if (conflictRef.current) throw new MindMapConflictError()
      if (mounted.current) setStatus('已保存')
    }
    const task = perform()
    saving.current = task
    try { await task } finally { if (saving.current === task) saving.current = null }
  }, [clearTimer])

  const reportFailure = useCallback((error: unknown) => {
    if (error instanceof MindMapConflictError || (error instanceof Error && error.name === 'MindMapConflictError')) {
      markConflict()
      return
    }
    const detail = error instanceof Error ? error.message : '请重试'
    if (mounted.current) setStatus(`保存失败，草稿仍保留：${detail}`)
  }, [markConflict])

  const updateDraft = useCallback((patch: Partial<Pick<MindMapRecord, 'title' | 'dataJson'>>) => {
    const current = draftRef.current
    if (!current) return
    const next = { ...current, ...patch }
    if (next.title === current.title && next.dataJson === current.dataJson) return
    draftRef.current = next
    changedVersion.current += 1
    setDraft(next)
    setStatus(conflictRef.current ? '另一窗口已更改导图；本地草稿仍保留' : '有未保存的更改')
    clearTimer()
    if (!conflictRef.current) timer.current = window.setTimeout(() => { timer.current = null; void flush().catch(reportFailure) }, 600)
  }, [clearTimer, flush, reportFailure])

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    let dispose: (() => void) | undefined
    let ready = false
    const pending: MindMapEvent[] = []
    const handleExternal = async (event: MindMapEvent) => {
      try {
        const items = await listMindMaps()
        if (cancelled) return
        setMaps(items)
        const current = draftRef.current
        if (!current || event.mapId !== current.id) return
        const latest = items.find((item) => item.id === current.id) ?? null
        if (latest && latest.updatedAt <= current.updatedAt) return
        canvasRef.current?.commit()
        if (changedVersion.current > savedVersion.current || saving.current || blocked.current || promptRef.current || conflictRef.current) {
          markConflict()
          return
        }
        if (draftRef.current?.id !== current.id) return
        draftRef.current = latest
        changedVersion.current = 0
        savedVersion.current = 0
        setDraft(latest)
        setCanvasRevision((revision) => revision + 1)
        setStatus(latest ? '已同步另一窗口的更改' : '此导图已在另一窗口删除')
      } catch { if (!cancelled) setStatus('无法同步另一窗口的导图，请重试') }
    }
    const onEvent = (event: MindMapEvent) => { if (ready) void handleExternal(event); else pending.push(event) }
    void (async () => {
      let syncAvailable = true
      try { dispose = await subscribeMindMapEvents(onEvent) } catch { syncAvailable = false }
      if (cancelled) { dispose?.(); return }
      const items = await listMindMaps()
      if (cancelled) return
      setMaps(items)
      const selected = standaloneId ? items.find((item) => item.id === standaloneId) ?? null : items[0] ?? null
      draftRef.current = selected
      setDraft(selected)
      setStatus(selected ? syncAvailable ? '已保存' : '同步通知不可用，保存时仍会检查冲突' : standaloneId ? '此导图不存在或已被删除' : '新建一张导图开始记录')
      ready = true
      pending.forEach((event) => void handleExternal(event))
    })().catch(() => { if (!cancelled) setStatus('读取导图失败，请检查本地数据库') })
    return () => { cancelled = true; mounted.current = false; dispose?.(); clearTimer() }
  }, [clearTimer, markConflict, standaloneId])

  const prepareToLeave = useCallback(async () => {
    if (blocked.current || promptRef.current || conflictRef.current) return false
    blocked.current = true
    setBusy(true)
    try { await flush(); return true }
    catch (error) { reportFailure(error); return false }
    finally { blocked.current = false; if (mounted.current) setBusy(false) }
  }, [flush, reportFailure])

  useEffect(() => {
    onBeforeLeaveReady?.(prepareToLeave)
    return () => onBeforeLeaveReady?.(null)
  }, [onBeforeLeaveReady, prepareToLeave])

  useSaveShortcut(async () => {
    if (blocked.current || promptRef.current) return
    try { await flush(); onStatusChange?.('思维导图已保存') } catch (error) { reportFailure(error) }
  }, Boolean(draft))

  function showPrompt(value: typeof prompt) {
    promptRef.current = value
    setPrompt(value)
  }

  async function selectOrCreate(id?: string) {
    if (blocked.current || promptRef.current || conflictRef.current) return
    if (id && draftRef.current?.id === id) { directory.choose(id, false); return }
    blocked.current = true
    setBusy(true)
    try {
      await flush()
      const selected = id ? maps.find((item) => item.id === id) : await createMindMap()
      if (!selected) throw new Error('导图不存在')
      if (!id) setMaps((items) => [selected, ...items])
      draftRef.current = selected
      changedVersion.current = 0
      savedVersion.current = 0
      setDraft(selected)
      directory.choose(selected.id, false)
      setStatus('已保存')
    } catch (error) { reportFailure(error) }
    finally { blocked.current = false; setBusy(false) }
  }

  function requestIndex() {
    if (!draftRef.current || blocked.current || conflictRef.current) return
    canvasRef.current?.commit()
    if (savedVersion.current < changedVersion.current || saving.current) showPrompt('index')
    else void copyIndex(false)
  }

  async function copyIndex(saveChanges: boolean) {
    if (!draftRef.current || blocked.current) return
    showPrompt(null)
    blocked.current = true
    setBusy(true)
    let savingDraft = saveChanges
    try {
      if (saveChanges) await flush()
      savingDraft = false
      await copyMindMapIndex(draftRef.current.id)
      setStatus('导图副本路径已复制')
      onStatusChange?.('导图协作副本路径已复制到剪贴板')
    } catch (error) {
      if (error instanceof MindMapConflictError) markConflict()
      else setStatus(savingDraft ? '保存失败，未复制路径；草稿仍保留' : error instanceof Error ? error.message : '复制路径失败')
    }
    finally { blocked.current = false; setBusy(false) }
  }

  async function openStandalone() {
    if (!draftRef.current || blocked.current || conflictRef.current) return
    blocked.current = true
    setBusy(true)
    let prepared = false
    try {
      await flush()
      prepared = true
      if (!isTauriRuntime()) throw new Error('浏览器预览无法打开独立窗口')
      const { invoke } = await import('@tauri-apps/api/core')
      const current = draftRef.current!
      const result = await invoke<{ created: boolean }>('open_mind_map_window', { mapId: current.id, title: current.title })
      setStatus(result.created ? '已打开独立导图窗口' : '已聚焦独立导图窗口')
    } catch (error) {
      if (!prepared) reportFailure(error)
      else setStatus(error instanceof Error ? error.message : '无法打开独立导图窗口')
    }
    finally { blocked.current = false; setBusy(false) }
  }

  async function applyExternalChanges() {
    if (!draftRef.current || blocked.current || conflictRef.current) return
    blocked.current = true
    setBusy(true)
    let savingDraft = true
    try {
      await flush()
      savingDraft = false
      const text = await pickMindMapCollaborationFile()
      if (text === null) return
      const current = draftRef.current
      if (!current || conflictRef.current) throw new MindMapConflictError()
      const saved = await getMindMap(current.id)
      if (!saved || saved.updatedAt !== current.updatedAt || changedVersion.current > savedVersion.current) throw new MindMapConflictError()
      const candidate = applyMindMapSnapshot(text, saved)
      const updated = await saveMindMap(candidate)
      draftRef.current = updated
      changedVersion.current = 0
      savedVersion.current = 0
      setDraft(updated)
      setCanvasRevision((revision) => revision + 1)
      setMaps((items) => [updated, ...items.filter((item) => item.id !== updated.id)])
      setStatus('已应用外部修改')
    } catch (error) {
      if (error instanceof MindMapConflictError) markConflict()
      else setStatus(savingDraft ? '保存失败，未应用外部修改；草稿仍保留' : error instanceof Error ? error.message : '应用外部修改失败')
    } finally { blocked.current = false; setBusy(false) }
  }

  async function resolveConflict(keepCopy: boolean) {
    const current = draftRef.current
    if (!current || blocked.current) return
    showPrompt(null)
    blocked.current = true
    setBusy(true)
    try {
      if (keepCopy) await createMindMap({ title: `${current.title || '未命名导图'}（草稿副本）`, dataJson: current.dataJson })
      const latest = await getMindMap(current.id)
      const items = await listMindMaps()
      draftRef.current = latest
      changedVersion.current = 0
      savedVersion.current = 0
      conflictRef.current = false
      setConflict(false)
      setMaps(items)
      setDraft(latest)
      setCanvasRevision((revision) => revision + 1)
      setStatus(keepCopy ? '草稿已另存为新导图' : latest ? '已重新载入已保存导图' : '此导图已被删除')
    } catch (error) { setStatus(error instanceof Error ? error.message : '处理冲突失败，草稿仍保留') }
    finally { blocked.current = false; setBusy(false) }
  }

  async function removeMap() {
    if (!draftRef.current || blocked.current) return
    showPrompt(null)
    blocked.current = true
    setBusy(true)
    try {
      await flush()
      const current = draftRef.current
      if (!current) return
      await deleteMindMap(current)
      const remaining = maps.filter((item) => item.id !== current.id)
      setMaps(remaining)
      draftRef.current = remaining[0] ?? null
      changedVersion.current = 0
      savedVersion.current = 0
      setDraft(remaining[0] ?? null)
      setStatus('导图已删除')
    } catch (error) { setStatus(error instanceof Error ? error.message : '删除导图失败') }
    finally { blocked.current = false; setBusy(false) }
  }

  const displayedStatus = statusMessage && isFailureStatus(statusMessage) ? statusMessage : status
  return (
    <div className={`mind-map-workspace ${standaloneId || unifiedNavigation ? 'standalone' : ''}`}>
      {!standaloneId && <WorkspaceNavigation><aside className="mind-map-list" aria-label="导图列表">
        <DirectoryHeader title="思维导图"><button className="square-button" title={`新建导图（当前 ${maps.length} 张）`} aria-label="新建导图" disabled={busy || Boolean(prompt) || conflict} onClick={() => void selectOrCreate()}><Plus size={17} /></button></DirectoryHeader>
        <div className="mind-map-list-items">{directory.ordered(maps).map((map) => <button key={map.id} aria-pressed={directory.selectionActive ? directory.selected.has(map.id) : draft?.id === map.id} className={(directory.selectionActive ? directory.selected.has(map.id) : draft?.id === map.id) ? 'active' : ''} {...directory.dragProps(map.id, directory.ordered(maps), busy || Boolean(prompt) || conflict)} disabled={busy || Boolean(prompt) || conflict} onClick={(event) => { if (event.ctrlKey || event.metaKey) directory.choose(map.id, true, draft?.id); else void selectOrCreate(map.id) }}><GitBranchPlus size={16} /><span>{map.id === draft?.id ? draft.title || '未命名导图' : map.title || '未命名导图'}</span></button>)}</div>
        <details className="mind-map-license"><summary>开源组件许可</summary><pre>{license}</pre></details>
      </aside></WorkspaceNavigation>}
      <main className="mind-map-main">
        {draft ? <>
          <header className="mind-map-toolbar">
            <input aria-label="导图标题" value={draft.title} disabled={busy || Boolean(prompt)} onChange={(event) => updateDraft({ title: event.target.value })} placeholder="未命名导图" />
            <ViewStatus message={displayedStatus} />
            <button aria-label="保存" className="icon-button" disabled={busy || Boolean(prompt) || conflict} onClick={() => void flush().catch(reportFailure)} title="保存 (Ctrl+S)"><Save size={16} /></button>
            <button className="icon-button" disabled={busy || Boolean(prompt) || conflict} onClick={requestIndex} title="复制已保存导图的 JSON 副本路径；外部修改需手动应用，不会自动同步" aria-label="复制导图副本路径"><Clipboard size={16} /></button>
            <button aria-label="应用外部修改" className="icon-button" disabled={busy || Boolean(prompt) || conflict} onClick={() => void applyExternalChanges()} title="选择此前生成的协作 JSON，并检查版本后应用修改"><FileInput size={16} /></button>
            {!standaloneId && <button aria-label="独立窗口" className="icon-button" disabled={busy || Boolean(prompt) || conflict} onClick={() => void openStandalone()} title="在独立窗口打开当前导图"><ExternalLink size={16} /></button>}
            {!standaloneId && <button className="square-button" disabled={busy || Boolean(prompt) || conflict} onClick={() => showPrompt('delete')} title="删除导图" aria-label="删除导图"><Trash2 size={16} /></button>}
          </header>
          <div className="mind-map-actions" aria-label="导图节点操作">
            <button title="添加子节点" aria-label="添加子节点" className="secondary-button" disabled={busy || Boolean(prompt)} onClick={() => canvasRef.current?.addChild()}><CornerDownRight size={15} /></button>
            <button title="添加同级" aria-label="添加同级" className="secondary-button" disabled={busy || Boolean(prompt)} onClick={() => canvasRef.current?.addSibling()}><Plus size={15} /></button>
            <button title="编辑节点" aria-label="编辑节点" className="secondary-button" disabled={busy || Boolean(prompt)} onClick={() => canvasRef.current?.edit()}><Pencil size={15} /></button>
            <button title="删除节点" aria-label="删除节点" className="secondary-button" disabled={busy || Boolean(prompt)} onClick={() => canvasRef.current?.remove()}><Trash2 size={15} /></button>
            <button className="square-button" disabled={busy || Boolean(prompt)} onClick={() => canvasRef.current?.undo()} aria-label="撤销" title="撤销"><Undo2 size={15} /></button>
            <button className="square-button" disabled={busy || Boolean(prompt)} onClick={() => canvasRef.current?.redo()} aria-label="重做" title="重做"><Redo2 size={15} /></button>
            <button className="square-button" disabled={busy || Boolean(prompt)} onClick={() => canvasRef.current?.center()} aria-label="居中画布" title="居中画布"><Crosshair size={15} /></button>
            <button className="square-button" disabled={busy || Boolean(prompt)} onClick={() => canvasRef.current?.fit()} aria-label="适应画布" title="适应画布"><Maximize size={15} /></button>
            <small>双击节点编辑 · Tab 添加子节点 · 拖动调整顺序</small>
          </div>
          <div className="mind-map-editor" aria-busy={busy}><MindMapCanvas key={`${draft.id}:${canvasRevision}`} ref={canvasRef} initialData={draft.dataJson} theme={theme} onChange={(dataJson) => updateDraft({ dataJson })} onBackground={() => { void flush().catch(reportFailure) }} />{(busy || prompt) && <div className="mind-map-editor-blocker" />}{conflict && <div className="mind-map-conflict" role="alert"><span>另一窗口已更新或删除导图。本地草稿仍保留；请另存草稿或重新载入。</span><button className="secondary-button" disabled={busy} onClick={() => void resolveConflict(true)}>草稿另存为新导图</button><button className="secondary-button" disabled={busy} onClick={() => showPrompt('reload')}>重新载入</button></div>}</div>
        </> : <div className="detail-empty"><GitBranchPlus size={32} /><ViewStatus message={displayedStatus} />{!standaloneId && <button className="primary-button" disabled={busy} onClick={() => void selectOrCreate()}><Plus size={16} />新建导图</button>}</div>}
        {prompt === 'index' && <div className="note-close-dialog-backdrop"><div className="note-close-dialog note-index-dialog" role="alertdialog" aria-modal="true" aria-labelledby="mind-index-title"><strong id="mind-index-title">保存更改后复制副本路径？</strong><p>将生成已保存导图的 JSON 副本；副本不会自动更新，外部修改需要手动应用。自动保存仍会继续。</p><div><button className="secondary-button" onClick={() => showPrompt(null)}>取消</button><button className="secondary-button" onClick={() => void copyIndex(false)}>复制已保存版本</button><button className="primary-button" onClick={() => void copyIndex(true)}>保存并复制</button></div></div></div>}
        {prompt === 'delete' && <div className="note-close-dialog-backdrop"><div className="note-close-dialog" role="alertdialog" aria-modal="true" aria-labelledby="mind-delete-title"><strong id="mind-delete-title">删除这张导图？</strong><p>此操作会永久删除这张导图，无法从便签回收站恢复。</p><div><button className="secondary-button" onClick={() => showPrompt(null)}>取消</button><button className="danger-button" onClick={() => void removeMap()}>永久删除</button></div></div></div>}
        {prompt === 'reload' && <div className="note-close-dialog-backdrop"><div className="note-close-dialog" role="alertdialog" aria-modal="true" aria-labelledby="mind-reload-title"><strong id="mind-reload-title">放弃当前草稿并重新载入？</strong><p>当前窗口未保存的修改将丢失；如需保留，请先另存为新导图。</p><div><button className="secondary-button" onClick={() => showPrompt(null)}>取消</button><button className="danger-button" onClick={() => void resolveConflict(false)}>放弃并重新载入</button></div></div></div>}
      </main>
    </div>
  )
}
