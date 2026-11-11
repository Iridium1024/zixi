export function orderItems<T extends { id: string }>(items: T[], order: readonly string[] = []): T[] {
  const positions = new Map(order.map((id, index) => [id, index]))
  return [...items].sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity))
}

/** Keep relative order within a dragged selection; preserve unseen items. */
export function moveBefore(order: readonly string[], ids: readonly string[], target: string | null): string[] {
  const moving = new Set(ids)
  if (target && moving.has(target)) return [...order]
  const block = order.filter((id) => moving.has(id))
  const rest = order.filter((id) => !moving.has(id))
  const index = target === null ? rest.length : rest.indexOf(target)
  rest.splice(index < 0 ? rest.length : index, 0, ...block)
  return rest
}

export const DIRECTORY_DRAG = 'application/x-zixi-directory'
export function insertionTarget(order: readonly string[], moving: readonly string[], target: string, after: boolean): string | null {
  if (!after || moving.includes(target)) return target
  return order.slice(order.indexOf(target) + 1).find((id) => !moving.includes(id)) ?? null
}
export type DirectoryDrag = { kind: string; ids: string[] }
export function readDirectoryDrag(data: DataTransfer): DirectoryDrag | null {
  try { const value = JSON.parse(data.getData(DIRECTORY_DRAG)); return typeof value.kind === 'string' && Array.isArray(value.ids) && value.ids.length > 0 && value.ids.every((id: unknown) => typeof id === 'string') ? value : null } catch { return null }
}
