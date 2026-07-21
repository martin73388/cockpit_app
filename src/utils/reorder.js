// Move `fromId` relative to `toId` in an id array.
// Dragging downward drops after the target; upward drops before — feels natural.
export function reorderList(ids, fromId, toId) {
  const from = ids.indexOf(fromId)
  const to = ids.indexOf(toId)
  if (from < 0 || to < 0 || from === to) return ids
  const next = ids.slice()
  next.splice(from, 1)
  const insertAt = next.indexOf(toId) + (from < to ? 1 : 0)
  next.splice(insertAt, 0, fromId)
  return next
}
