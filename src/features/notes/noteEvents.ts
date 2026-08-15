import { isTauriRuntime, makeId } from '../../lib/platform'

export type NoteDomainAction =
  | 'created'
  | 'updated'
  | 'trashed'
  | 'restored'
  | 'deleted'
  | 'trash-cleared'

export interface NoteDomainEvent {
  eventId: string
  noteId: string | null
  noteIds?: string[]
  action: NoteDomainAction
  updatedAt: string
  sourceWindow: string
}

const EVENT_NAME = 'note-domain-event'
const STORAGE_KEY = 'zixi.note-domain-event.v1'
const sourceWindow = makeId(new URLSearchParams(window.location.search).get('window') ?? 'main')
const seenEventIds = new Set<string>()
const localEventTarget = new EventTarget()
let channel: BroadcastChannel | null = null

function broadcastChannel() {
  if (!channel && 'BroadcastChannel' in window) channel = new BroadcastChannel(EVENT_NAME)
  return channel
}

function remember(eventId: string) {
  seenEventIds.add(eventId)
  if (seenEventIds.size > 200) seenEventIds.delete(seenEventIds.values().next().value!)
}

export async function publishNoteEvent(
  detail: Omit<NoteDomainEvent, 'eventId' | 'sourceWindow'>,
): Promise<NoteDomainEvent> {
  const event: NoteDomainEvent = { ...detail, eventId: makeId('event'), sourceWindow }
  remember(event.eventId)
  localEventTarget.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: event }))
  broadcastChannel()?.postMessage(event)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(event))
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage fallback is best effort; Tauri and BroadcastChannel remain available.
  }
  if (isTauriRuntime()) {
    const { emit } = await import('@tauri-apps/api/event')
    await emit(EVENT_NAME, event)
  }
  return event
}

function isNoteDomainEvent(value: unknown): value is NoteDomainEvent {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<NoteDomainEvent>
  return typeof candidate.eventId === 'string'
    && typeof candidate.action === 'string'
    && typeof candidate.updatedAt === 'string'
    && typeof candidate.sourceWindow === 'string'
}

export async function subscribeNoteEvents(
  handler: (event: NoteDomainEvent) => void,
  includeOwn = false,
): Promise<() => void> {
  const deliver = (event: NoteDomainEvent) => {
    if (seenEventIds.has(event.eventId)) return
    remember(event.eventId)
    if (!includeOwn && event.sourceWindow === sourceWindow) return
    handler(event)
  }
  const localHandler = (raw: Event) => deliver((raw as CustomEvent<NoteDomainEvent>).detail)
  const channelHandler = (raw: MessageEvent<unknown>) => {
    if (isNoteDomainEvent(raw.data)) deliver(raw.data)
  }
  const storageHandler = (raw: StorageEvent) => {
    if (raw.key !== STORAGE_KEY || !raw.newValue) return
    try {
      const parsed: unknown = JSON.parse(raw.newValue)
      if (isNoteDomainEvent(parsed)) deliver(parsed)
    } catch {
      // Ignore malformed cross-window messages.
    }
  }

  localEventTarget.addEventListener(EVENT_NAME, localHandler)
  broadcastChannel()?.addEventListener('message', channelHandler)
  window.addEventListener('storage', storageHandler)
  let unlistenTauri: (() => void) | undefined
  if (isTauriRuntime()) {
    const { listen } = await import('@tauri-apps/api/event')
    unlistenTauri = await listen<NoteDomainEvent>(EVENT_NAME, ({ payload }) => deliver(payload))
  }
  return () => {
    localEventTarget.removeEventListener(EVENT_NAME, localHandler)
    broadcastChannel()?.removeEventListener('message', channelHandler)
    window.removeEventListener('storage', storageHandler)
    unlistenTauri?.()
  }
}

export function noteEventSourceWindow() {
  return sourceWindow
}
