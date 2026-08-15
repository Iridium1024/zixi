import { isTauriRuntime } from '../../lib/platform'
import type { ComparePreset, DiffStats } from './types'

export interface ComparisonDraft {
  id: string
  leftText: string
  rightText: string
  preset: ComparePreset
  stats: DiffStats
  updatedAt: string
  revision: number
}

interface ComparisonTransport {
  id: string
  leftText: string
  rightText: string
  preset: string
  statsJson: string
  updatedAt: string
  revision: number
}

interface AtomicSaveResult { status: 'created' | 'updated' | 'unchanged' | 'conflict'; comparison: ComparisonTransport | null }

const CURRENT_ID = 'comparison-current'
const LOCAL_KEY = 'zixi.comparison.current.v2'
const EMPTY_STATS: DiffStats = { insertedCharacters: 0, deletedCharacters: 0, replacementGroups: 0, totalChanges: 0 }

function normalizeDraft(value: unknown): ComparisonDraft | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  if (typeof input.leftText !== 'string' || typeof input.rightText !== 'string') return null
  const preset: ComparePreset = input.preset === 'exact' || input.preset === 'relaxed' ? input.preset : 'review'
  const stats = normalizeStats(input.stats)
  return { id: typeof input.id === 'string' ? input.id : CURRENT_ID, leftText: input.leftText, rightText: input.rightText, preset, stats, updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date(0).toISOString(), revision: Number.isInteger(input.revision) ? Number(input.revision) : 0 }
}

function normalizeStats(value: unknown): DiffStats {
  const input = value && typeof value === 'object' ? value as Partial<DiffStats> : {}
  const nonNegativeInteger = (candidate: unknown) => Number.isInteger(candidate) && Number(candidate) >= 0 ? Number(candidate) : 0
  return {
    insertedCharacters: nonNegativeInteger(input.insertedCharacters),
    deletedCharacters: nonNegativeInteger(input.deletedCharacters),
    replacementGroups: nonNegativeInteger(input.replacementGroups),
    totalChanges: nonNegativeInteger(input.totalChanges),
  }
}

/** Converts the Rust SQLite transport shape without exposing its JSON column to the UI. */
export function comparisonDraftFromTransport(value: ComparisonTransport | null): ComparisonDraft | null {
  if (!value || typeof value.leftText !== 'string' || typeof value.rightText !== 'string') return null
  let stats: DiffStats = EMPTY_STATS
  try { stats = normalizeStats(JSON.parse(value.statsJson)) } catch { /* An old malformed row remains readable with safe zero statistics. */ }
  return {
    id: typeof value.id === 'string' ? value.id : CURRENT_ID,
    leftText: value.leftText,
    rightText: value.rightText,
    preset: value.preset === 'exact' || value.preset === 'relaxed' ? value.preset : 'review',
    stats,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
    revision: Number.isInteger(value.revision) ? value.revision : 0,
  }
}

export function comparisonSaveTransport(
  draft: Omit<ComparisonDraft, 'id' | 'updatedAt' | 'revision'>,
  expectedRevision: number | null,
) {
  return {
    id: CURRENT_ID,
    leftText: draft.leftText,
    rightText: draft.rightText,
    preset: draft.preset,
    statsJson: JSON.stringify(normalizeStats(draft.stats)),
    updatedAt: new Date().toISOString(),
    expectedRevision,
  }
}

function retryDelay(attempt: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 140 * (attempt + 1)))
}

export class ComparisonConflictError extends Error {
  readonly persisted: ComparisonDraft | null

  constructor(persisted: ComparisonDraft | null) {
    super('比较会话已被另一窗口更新')
    this.name = 'ComparisonConflictError'
    this.persisted = persisted
  }
}

export async function loadComparison(): Promise<ComparisonDraft | null> {
  if (!isTauriRuntime()) {
    try { return normalizeDraft(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '')) } catch { return null }
  }
  const { invoke } = await import('@tauri-apps/api/core')
  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const transport = await invoke<ComparisonTransport | null>('load_comparison_atomic', { id: CURRENT_ID })
      const draft = comparisonDraftFromTransport(transport)
      if (transport && !draft) throw new Error('比较会话返回格式无效')
      return draft
    } catch (error) {
      lastError = error
      if (attempt < 3) await retryDelay(attempt)
    }
  }
  throw lastError
}

export async function saveComparison(
  draft: Omit<ComparisonDraft, 'id' | 'updatedAt' | 'revision'>,
  expectedRevision: number | null,
): Promise<ComparisonDraft> {
  const record = { ...draft, id: CURRENT_ID, updatedAt: new Date().toISOString() }
  if (!isTauriRuntime()) {
    const cached = normalizeDraft(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null'))
    if (expectedRevision !== null && cached && cached.revision !== expectedRevision) throw new ComparisonConflictError(cached)
    const saved: ComparisonDraft = { ...record, revision: (cached?.revision ?? 0) + 1 }
    localStorage.setItem(LOCAL_KEY, JSON.stringify(saved))
    return saved
  }
  const { invoke } = await import('@tauri-apps/api/core')
  const result = await invoke<AtomicSaveResult>('save_comparison_atomic', { input: comparisonSaveTransport(draft, expectedRevision) })
  const comparison = comparisonDraftFromTransport(result.comparison)
  if (result.status === 'conflict') throw new ComparisonConflictError(comparison)
  if (!comparison) throw new Error('比较会话保存未返回记录')
  return comparison
}
