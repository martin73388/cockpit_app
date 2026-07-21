// Monotonic epoch-ms clock.
// `updatedAt` must never go backwards, even when two edits land in the same
// millisecond or the wall clock jumps — otherwise last-writer-wins merges
// would resolve incorrectly. `stamp()` guarantees strictly increasing values.
let last = 0

export function stamp() {
  const now = Date.now()
  last = now > last ? now : last + 1
  return last
}

// Keep the monotonic floor above anything already present in a loaded store
// (from localStorage or a remote pull) so new edits always out-rank old ones.
export function observe(ts) {
  if (typeof ts === 'number' && ts > last) last = ts
}
