import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { LightDialog } from '../../components/LightDialog'
import type { NoteFolderState } from './noteFolders'
import type { NoteRecord } from './types'

export function NoteSearchDialog({ notes, folders, disabled, initialQuery = '', onApplyFilter, onClose, onSelect }: {
  notes: NoteRecord[]; folders: NoteFolderState; disabled: boolean; onClose(): void; onSelect(id: string): void
  initialQuery?: string; onApplyFilter?(query: string): void
}) {
  const [query, setQuery] = useState(initialQuery)
  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return notes.filter((note) => `${note.title}\n${note.content}`.toLocaleLowerCase().includes(needle))
  }, [notes, query])
  return <LightDialog title="搜索便签" onClose={onClose}>
    <label className="note-search-input"><Search size={17} /><input data-dialog-autofocus placeholder="搜索便签" aria-label="搜索便签内容" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <div className="note-search-results" aria-label="便签搜索结果">
      {results.map((note) => <button key={note.id} disabled={disabled} onClick={() => onSelect(note.id)}><strong>{note.title || '未命名便签'}</strong><small>{folders.folders.find((folder) => folder.id === folders.entries[note.id])?.name ?? '未分类'}</small><span>{note.content.slice(0, 80) || '空便签'}</span></button>)}
      {!results.length && <p className="directory-empty" role="status">没有匹配的搜索结果</p>}
    </div>
    {onApplyFilter && <footer className="note-search-footer"><button className="secondary-button" disabled={disabled} onClick={() => onApplyFilter(query)}>筛选回收站列表</button></footer>}
  </LightDialog>
}
