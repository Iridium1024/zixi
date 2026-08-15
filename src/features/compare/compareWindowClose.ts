export type ComparisonSaveResult =
  | { status: 'clean' }
  | { status: 'saved' }
  | { status: 'conflict' }
  | { status: 'failed'; error?: unknown }

export type CompareWindowCloseResult =
  | { status: 'clean' | 'saved' }
  | { status: 'conflict' }
  | { status: 'failed'; phase: 'save' | 'destroy' | 'changing'; error?: unknown }

interface CompareWindowCloseOptions {
  hasUnsavedChanges(): boolean
  save(): Promise<ComparisonSaveResult>
  destroy(): Promise<void>
  maxSavePasses?: number
}

/**
 * Coordinates the native close request without ever assuming that a caught
 * save error is safe to close through. A second save pass handles text that
 * changed while the first request was in flight.
 */
export async function coordinateCompareWindowClose({
  hasUnsavedChanges,
  save,
  destroy,
  maxSavePasses = 3,
}: CompareWindowCloseOptions): Promise<CompareWindowCloseResult> {
  const startedDirty = hasUnsavedChanges()

  if (startedDirty) {
    for (let attempt = 0; attempt < maxSavePasses; attempt += 1) {
      const result = await save()
      if (result.status === 'conflict') return { status: 'conflict' }
      if (result.status === 'failed') return { status: 'failed', phase: 'save', error: result.error }
      if (!hasUnsavedChanges()) break
      if (attempt === maxSavePasses - 1) return { status: 'failed', phase: 'changing' }
    }
  }

  try {
    await destroy()
    return { status: startedDirty ? 'saved' : 'clean' }
  } catch (error) {
    return { status: 'failed', phase: 'destroy', error }
  }
}
