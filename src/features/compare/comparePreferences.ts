import { useEffect, useRef, useState } from 'react'
import { isTauriRuntime } from '../../lib/platform'
import { loadSetting, saveSetting } from '../settings/settingsRepository'
import { PRESET_RULES, type ComparisonRule, type ComparePreset, type UnicodeMode, type WhitespaceMode } from './types'

export type CompareLayout = 'auto' | 'side-by-side' | 'stacked'
export type WordWrapMode = 'window' | 'column' | 'off'
export type WhitespaceDisplay = 'none' | 'selection' | 'all'

export interface ComparePreferences {
  version: 1
  layout: CompareLayout
  wordWrap: WordWrapMode
  wordWrapColumn: number
  lineNumbers: boolean
  whitespace: WhitespaceDisplay
  syncScroll: boolean
  rule: ComparisonRule
}

export const COMPARE_PREFERENCES_KEY = 'compare-preferences'
export const COMPARE_PREFERENCES_STORAGE_KEY = 'zixi.compare-preferences.v1'

export const DEFAULT_COMPARE_PREFERENCES: ComparePreferences = {
  version: 1,
  layout: 'auto',
  wordWrap: 'window',
  wordWrapColumn: 80,
  lineNumbers: true,
  whitespace: 'selection',
  syncScroll: true,
  rule: PRESET_RULES.review,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number) {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : fallback
}

export function ruleForPreset(preset: ComparePreset): ComparisonRule {
  return { ...PRESET_RULES[preset] }
}

export function normalizeComparisonRule(value: unknown): ComparisonRule {
  const input = isRecord(value) ? value : {}
  const preset = enumValue(input.preset, ['exact', 'review', 'relaxed', 'custom'] as const, 'review')
  if (preset !== 'custom') return ruleForPreset(preset)
  return {
    preset,
    caseSensitive: typeof input.caseSensitive === 'boolean' ? input.caseSensitive : true,
    whitespace: enumValue<WhitespaceMode>(input.whitespace, ['all', 'trim-trailing', 'collapse'], 'trim-trailing'),
    unicode: enumValue<UnicodeMode>(input.unicode, ['none', 'nfc', 'nfkc'], 'nfc'),
  }
}

export function normalizeComparePreferences(value: unknown): ComparePreferences {
  const input = isRecord(value) ? value : {}
  return {
    version: 1,
    layout: enumValue<CompareLayout>(input.layout, ['auto', 'side-by-side', 'stacked'], DEFAULT_COMPARE_PREFERENCES.layout),
    wordWrap: enumValue<WordWrapMode>(input.wordWrap, ['window', 'column', 'off'], DEFAULT_COMPARE_PREFERENCES.wordWrap),
    wordWrapColumn: boundedInteger(input.wordWrapColumn, 40, 200, DEFAULT_COMPARE_PREFERENCES.wordWrapColumn),
    lineNumbers: typeof input.lineNumbers === 'boolean' ? input.lineNumbers : DEFAULT_COMPARE_PREFERENCES.lineNumbers,
    whitespace: enumValue<WhitespaceDisplay>(input.whitespace, ['none', 'selection', 'all'], DEFAULT_COMPARE_PREFERENCES.whitespace),
    syncScroll: typeof input.syncScroll === 'boolean' ? input.syncScroll : DEFAULT_COMPARE_PREFERENCES.syncScroll,
    rule: normalizeComparisonRule(input.rule),
  }
}

function readCachedPreferences() {
  if (typeof localStorage === 'undefined') return DEFAULT_COMPARE_PREFERENCES
  try { return normalizeComparePreferences(JSON.parse(localStorage.getItem(COMPARE_PREFERENCES_STORAGE_KEY) ?? '')) } catch { return DEFAULT_COMPARE_PREFERENCES }
}

interface PreferenceEvent { eventId: string; sourceWindow: string; preferences: ComparePreferences }

export function useComparePreferences(onIssue?: (message: string) => void) {
  const [preferences, setPreferences] = useState(readCachedPreferences)
  const sourceRef = useRef(`compare-${crypto.randomUUID()}`)
  const originRef = useRef<'hydrate' | 'remote' | 'local'>('hydrate')
  const seenEvents = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false
    if (!isTauriRuntime()) return
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      sourceRef.current = getCurrentWindow().label
    }).catch(() => undefined)
    void loadSetting<unknown>(COMPARE_PREFERENCES_KEY)
      .then((saved) => { if (!cancelled && saved) { originRef.current = 'hydrate'; setPreferences(normalizeComparePreferences(saved)) } })
      .catch(() => onIssue?.('高级比较设置读取失败，已使用安全默认值'))
    return () => { cancelled = true }
  }, [onIssue])

  useEffect(() => {
    localStorage.setItem(COMPARE_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
    const origin = originRef.current
    originRef.current = 'local'
    if (!isTauriRuntime() || origin === 'hydrate' || origin === 'remote') return
    const event: PreferenceEvent = { eventId: crypto.randomUUID(), sourceWindow: sourceRef.current, preferences }
    seenEvents.current.add(event.eventId)
    void Promise.all([
      saveSetting(COMPARE_PREFERENCES_KEY, preferences),
      import('@tauri-apps/api/event').then(({ emit }) => emit('compare-preferences-changed', event)),
    ]).catch(() => onIssue?.('高级比较设置保存失败，当前窗口仍保留所选项'))
  }, [onIssue, preferences])

  useEffect(() => {
    if (!isTauriRuntime()) return
    let dispose: (() => void) | undefined
    let cancelled = false
    void import('@tauri-apps/api/event').then(({ listen }) => listen<PreferenceEvent>('compare-preferences-changed', ({ payload }) => {
      if (payload.sourceWindow === sourceRef.current || seenEvents.current.has(payload.eventId)) return
      seenEvents.current.add(payload.eventId)
      originRef.current = 'remote'
      setPreferences(normalizeComparePreferences(payload.preferences))
    })).then((unlisten) => { if (cancelled) unlisten(); else dispose = unlisten })
    return () => { cancelled = true; dispose?.() }
  }, [])

  return { preferences, setPreferences: (next: ComparePreferences) => { originRef.current = 'local'; setPreferences(normalizeComparePreferences(next)) } }
}
