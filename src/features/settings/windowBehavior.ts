import { isTauriRuntime } from '../../lib/platform'

export const WINDOW_BEHAVIOR_STORAGE_KEY = 'zixi.window-behavior.v1'

export type MainWindowOpenBehavior = 'keep' | 'minimize' | 'hide'
export type MainWindowCloseBehavior = 'keep' | 'show'
export type IndependentWindowKind = 'note' | 'compare' | 'reader'

export interface IndependentWindowBehavior {
  open: MainWindowOpenBehavior
  close: MainWindowCloseBehavior
}

export interface WindowBehaviorPreferences {
  version: 2
  note: IndependentWindowBehavior
  compare: IndependentWindowBehavior
  reader: IndependentWindowBehavior
}

export const DEFAULT_WINDOW_BEHAVIOR: WindowBehaviorPreferences = {
  version: 2,
  note: { open: 'hide', close: 'keep' },
  compare: { open: 'keep', close: 'keep' },
  reader: { open: 'keep', close: 'keep' },
}

function normalizeOpen(value: unknown, fallback: MainWindowOpenBehavior): MainWindowOpenBehavior {
  return value === 'keep' || value === 'minimize' || value === 'hide' ? value : fallback
}

function normalizeClose(value: unknown, fallback: MainWindowCloseBehavior): MainWindowCloseBehavior {
  return value === 'keep' || value === 'show' ? value : fallback
}

export function normalizeWindowBehavior(value: unknown): WindowBehaviorPreferences {
  if (!value || typeof value !== 'object') return DEFAULT_WINDOW_BEHAVIOR
  const candidate = value as Partial<Record<IndependentWindowKind, Partial<IndependentWindowBehavior>>>
  return {
    version: 2,
    note: {
      open: normalizeOpen(candidate.note?.open, DEFAULT_WINDOW_BEHAVIOR.note.open),
      close: normalizeClose(candidate.note?.close, DEFAULT_WINDOW_BEHAVIOR.note.close),
    },
    compare: {
      open: normalizeOpen(candidate.compare?.open, DEFAULT_WINDOW_BEHAVIOR.compare.open),
      close: normalizeClose(candidate.compare?.close, DEFAULT_WINDOW_BEHAVIOR.compare.close),
    },
    reader: {
      open: normalizeOpen(candidate.reader?.open, DEFAULT_WINDOW_BEHAVIOR.reader.open),
      close: normalizeClose(candidate.reader?.close, DEFAULT_WINDOW_BEHAVIOR.reader.close),
    },
  }
}

export function readCachedWindowBehavior(): WindowBehaviorPreferences {
  try {
    const saved = localStorage.getItem(WINDOW_BEHAVIOR_STORAGE_KEY)
    return saved ? normalizeWindowBehavior(JSON.parse(saved)) : DEFAULT_WINDOW_BEHAVIOR
  } catch {
    return DEFAULT_WINDOW_BEHAVIOR
  }
}

export function cacheWindowBehavior(value: WindowBehaviorPreferences) {
  localStorage.setItem(WINDOW_BEHAVIOR_STORAGE_KEY, JSON.stringify(value))
}

export async function applyMainWindowOpenBehavior(behavior: MainWindowOpenBehavior) {
  if (!isTauriRuntime() || behavior === 'keep') return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('set_main_window_state', { action: behavior })
}

export async function applyMainWindowCloseBehavior(behavior: MainWindowCloseBehavior) {
  if (!isTauriRuntime() || behavior === 'keep') return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('restore_main_window_after_independent_close')
}
