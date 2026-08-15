import type { editor } from 'monaco-editor'

export const MONACO_LIGHT_THEME: editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#fcfbf8',
    'editor.foreground': '#292724',
    'editorLineNumber.foreground': '#aaa49b',
    'editorLineNumber.activeForeground': '#625d56',
    'editor.selectionBackground': '#dcd5eaaa',
    'editor.lineHighlightBackground': '#f6f3ed',
    'editorGutter.background': '#f8f6f1',
    'editorOverviewRuler.border': '#00000000',
  },
}

export const MONACO_DARK_THEME: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#2e2c29',
    'editor.foreground': '#eeeae3',
    'editorLineNumber.foreground': '#746f68',
    'editorLineNumber.activeForeground': '#c7c0b6',
    'editor.selectionBackground': '#554c68aa',
    'editor.lineHighlightBackground': '#34312e',
    'editorGutter.background': '#2b2926',
    'editorOverviewRuler.border': '#00000000',
  },
}
