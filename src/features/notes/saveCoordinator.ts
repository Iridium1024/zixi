import type { NoteRecord } from './types'

export type CoordinatedSaveState = 'idle' | 'scheduled' | 'saving' | 'saved' | 'failed' | 'conflict'

interface SaveCoordinatorOptions {
  delay?: number
  save(note: NoteRecord): Promise<NoteRecord>
  onSaved?(saved: NoteRecord): void
  onStateChange?(state: CoordinatedSaveState, error?: unknown): void
}

export class NoteSaveCoordinator {
  private readonly delay: number
  private readonly save: SaveCoordinatorOptions['save']
  private readonly onSaved?: SaveCoordinatorOptions['onSaved']
  private readonly onStateChange?: SaveCoordinatorOptions['onStateChange']
  private latest: NoteRecord | null = null
  private changeVersion = 0
  private savedVersion = 0
  private timer: number | null = null
  private inFlight: Promise<NoteRecord> | null = null
  private disposed = false

  constructor(options: SaveCoordinatorOptions) {
    this.delay = options.delay ?? 700
    this.save = options.save
    this.onSaved = options.onSaved
    this.onStateChange = options.onStateChange
  }

  setBaseline(note: NoteRecord) {
    this.latest = note
    this.changeVersion = 0
    this.savedVersion = 0
    this.clearTimer()
    this.onStateChange?.('saved')
  }

  schedule(note: NoteRecord) {
    if (this.disposed) return
    this.latest = note
    this.changeVersion += 1
    this.clearTimer()
    this.onStateChange?.('scheduled')
    this.timer = window.setTimeout(() => {
      this.timer = null
      void this.flush().catch(() => undefined)
    }, this.delay)
  }

  private clearTimer() {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
  }

  private async saveOnce(): Promise<NoteRecord> {
    if (!this.latest) throw new Error('没有可保存的便签')
    const submitted = this.latest
    const submittedVersion = this.changeVersion
    this.onStateChange?.('saving')
    this.inFlight = this.save(submitted)
    try {
      const saved = await this.inFlight
      this.savedVersion = Math.max(this.savedVersion, submittedVersion)
      this.latest = this.changeVersion === submittedVersion
        ? saved
        : { ...this.latest!, updatedAt: saved.updatedAt }
      this.onSaved?.(saved)
      this.onStateChange?.('saved')
      return saved
    } catch (error) {
      const isConflict = error instanceof Error && error.name === 'NoteConflictError'
      this.onStateChange?.(isConflict ? 'conflict' : 'failed', error)
      throw error
    } finally {
      this.inFlight = null
    }
  }

  async flush(note?: NoteRecord): Promise<NoteRecord> {
    if (note && JSON.stringify(note) !== JSON.stringify(this.latest)) {
      this.latest = note
      this.changeVersion += 1
    }
    this.clearTimer()
    if (this.inFlight) await this.inFlight
    let saved = this.latest
    while (this.latest && this.savedVersion < this.changeVersion) {
      saved = await this.saveOnce()
    }
    if (!saved) throw new Error('没有可保存的便签')
    return this.latest ?? saved
  }

  cancelPending() {
    this.clearTimer()
    this.changeVersion = this.savedVersion
  }

  hasPendingSave() {
    return this.timer !== null || this.inFlight !== null || this.savedVersion < this.changeVersion
  }

  dispose() {
    this.disposed = true
    this.clearTimer()
  }
}
