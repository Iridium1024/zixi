import { isTauriRuntime, makeId } from '../../lib/platform'

export interface MindMapEvent {
  eventId: string
  source: string
  mapId: string
  action: 'saved' | 'deleted' | 'created'
  updatedAt: string
}

const EVENT = 'mind-map-domain-event'
const STORAGE_KEY = 'zixi.mind-map-domain-event.v1'
const source = makeId('mindmap-window')
const seen = new Set<string>()

function remember(id: string) {
  seen.add(id)
  if (seen.size > 200) seen.delete(seen.values().next().value!)
}

export async function publishMindMapEvent(event: Omit<MindMapEvent, 'eventId' | 'source'>): Promise<void> {
  const payload: MindMapEvent = { ...event, eventId: makeId('event'), source }
  remember(payload.eventId)
  if (isTauriRuntime()) {
    const { emit } = await import('@tauri-apps/api/event')
    await emit(EVENT, payload)
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    localStorage.removeItem(STORAGE_KEY)
  }
}

export async function subscribeMindMapEvents(handler: (event: MindMapEvent) => void): Promise<() => void> {
  const deliver = (event: MindMapEvent) => {
    if (!event || typeof event.eventId !== 'string' || typeof event.source !== 'string'
      || typeof event.mapId !== 'string' || typeof event.updatedAt !== 'string'
      || !['created', 'saved', 'deleted'].includes(event.action)
      || event.source === source || seen.has(event.eventId)) return
    remember(event.eventId)
    handler(event)
  }
  if (isTauriRuntime()) {
    const { listen } = await import('@tauri-apps/api/event')
    return listen<MindMapEvent>(EVENT, ({ payload }) => deliver(payload))
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return
    try { deliver(JSON.parse(event.newValue) as MindMapEvent) } catch { /* Ignore invalid events. */ }
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
