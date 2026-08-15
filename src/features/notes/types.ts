export interface NoteStyle {
  fontFamily: string
  usesDefaultFont: boolean
  fontSize: number
  lineHeight: number
  textColor: string
  backgroundColor: string
  backgroundOpacity: number
}

export interface NoteRecord {
  id: string
  title: string
  content: string
  style: NoteStyle
  alwaysOnTop: boolean
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface NoteRevision {
  id: string
  noteId: string
  title: string
  content: string
  kind: 'auto' | 'protection'
  createdAt: string
}

export const DEFAULT_NOTE_STYLE: NoteStyle = {
  fontFamily: "'Noto Serif SC', 'Noto Serif CJK SC', 'Source Han Serif SC', '思源宋体', 'Songti SC', 'SimSun', serif",
  usesDefaultFont: true,
  fontSize: 16,
  lineHeight: 1.7,
  textColor: '#302d28',
  backgroundColor: '#f6eedb',
  backgroundOpacity: 0.96,
}
