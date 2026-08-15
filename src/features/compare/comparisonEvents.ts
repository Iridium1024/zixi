export interface ComparisonSessionEvent {
  eventId: string
  sourceWindow: string
  sessionId: string
  revision: number | null
  leftText: string
  rightText: string
}

/**
 * Cross-window events are broadcast by every local editor update.  Keeping
 * this tiny policy pure makes it explicit that an origin never replays its
 * own message and a previously seen event is processed at most once.
 */
export function acceptComparisonEvent(seen: Set<string>, ownSource: string, event: ComparisonSessionEvent) {
  if (event.sourceWindow === ownSource || seen.has(event.eventId)) return false
  seen.add(event.eventId)
  return true
}
