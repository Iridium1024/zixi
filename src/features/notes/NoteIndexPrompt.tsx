interface NoteIndexPromptProps {
  newNote: boolean
  onCancel(): void
  onCopySaved(): void
  onSaveAndCopy(): void
}

export function NoteIndexPrompt({ newNote, onCancel, onCopySaved, onSaveAndCopy }: NoteIndexPromptProps) {
  return (
    <div className="note-close-dialog-backdrop">
      <div className="note-close-dialog note-index-dialog" role="alertdialog" aria-modal="true" aria-labelledby="note-index-dialog-title">
        <strong id="note-index-dialog-title">保存更改后复制副本路径？</strong>
        <p>{newNote
          ? '新便签需要先确认保存，才能生成文本副本。'
          : '将生成已保存内容的文本副本；副本不会自动更新或写回便签。自动保存仍会按原设置执行。'}</p>
        <div>
          <button type="button" className="secondary-button" onClick={onCancel}>取消</button>
          {!newNote && <button type="button" className="secondary-button" onClick={onCopySaved}>复制已保存版本</button>}
          <button type="button" className="primary-button" onClick={onSaveAndCopy}>保存并复制</button>
        </div>
      </div>
    </div>
  )
}
