// Merge engine — the core of multi-device sync.
//
// Rules (from spec):
//   - Per id, the object with the greatest updatedAt wins, WHOLE object
//     (todo or habit, subtasks included — no subtask-level union in v1).
//   - Tombstones (root.deleted[], each {id, at, kind}) prevent resurrection.
//   - Canonical stable ordering so two identical devices emit an identical file.
//   - Never treat a remote that is not a Cockpit file as mergeable.
//
// mergeStates is commutative and idempotent:
//   mergeStates(a, b) deep-equals mergeStates(b, a)
//   mergeStates(a, a) deep-equals canonicalize(a)
import { APP, SCHEMA_VERSION, DAYS, PRIORITIES } from '../data/model.js'

export function isCockpitFile(obj) {
  return !!obj && obj.app === APP && Array.isArray(obj.todos) && Array.isArray(obj.habits)
}

function asArray(v) {
  return Array.isArray(v) ? v : []
}

function normalize(state) {
  return {
    todos: asArray(state && state.todos),
    habits: asArray(state && state.habits),
    deleted: asArray(state && state.deleted),
  }
}

// Deterministic, key-order-independent stringify, used only for tie-breaks.
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}'
}

// Coerce a timestamp/order field to a finite number (0 on garbage). Keeps merge
// commutative even if a remote (hand-edited or from another client) carries a
// string/undefined updatedAt — otherwise string-vs-number comparison could drop data.
function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// Deterministic winner between two versions of the same id.
function pickNewer(x, y) {
  const ux = num(x.updatedAt)
  const uy = num(y.updatedAt)
  if (ux !== uy) return ux > uy ? x : y
  // Equal timestamps (cross-device coincidence): break ties on content so the
  // merge stays commutative regardless of argument order.
  return stableStringify(x) >= stableStringify(y) ? x : y
}

function mergeTombstones(a, b) {
  const map = new Map()
  for (const t of [...a, ...b]) {
    if (!t || t.id == null) continue
    const at = num(t.at)
    const kind = t.kind === 'habit' ? 'habit' : 'todo'
    const prev = map.get(t.id)
    // Tie-break kind deterministically on equal `at` so the result is commutative.
    if (!prev || at > prev.at || (at === prev.at && kind < prev.kind)) map.set(t.id, { id: t.id, at, kind })
  }
  return map
}

// Union by id (LWW), then drop anything a tombstone buries.
function mergeCollection(a, b, tombs) {
  const byId = new Map()
  for (const item of [...a, ...b]) {
    if (!item || item.id == null) continue
    const prev = byId.get(item.id)
    byId.set(item.id, prev ? pickNewer(prev, item) : item)
  }
  const survivors = new Map()
  for (const item of byId.values()) {
    const tomb = tombs.get(item.id)
    if (tomb && tomb.at >= num(item.updatedAt)) continue // deletion wins (>= : delete wins ties)
    survivors.set(item.id, item)
  }
  return survivors
}

export function mergeStates(a, b) {
  const na = normalize(a)
  const nb = normalize(b)
  const tombs = mergeTombstones(na.deleted, nb.deleted)

  const todos = mergeCollection(na.todos, nb.todos, tombs)
  const habits = mergeCollection(na.habits, nb.habits, tombs)

  // Prune tombstones made obsolete by a resurrected/edited object (updatedAt > at).
  const live = new Map([...todos, ...habits])
  const deleted = []
  for (const t of tombs.values()) {
    const survivor = live.get(t.id)
    if (survivor && num(survivor.updatedAt) > t.at) continue
    deleted.push(t)
  }

  return canonicalize({
    app: APP,
    version: SCHEMA_VERSION,
    todos: [...todos.values()],
    habits: [...habits.values()],
    deleted,
  })
}

// ---- Canonicalization: fixed key order + stable array order -> identical files.

function canonSubtask(s) {
  return { id: s.id, title: typeof s.title === 'string' ? s.title : '', done: !!s.done }
}

function canonTodo(t) {
  const priority = PRIORITIES.includes(t.priority) ? t.priority : 'normale'
  return {
    id: t.id,
    title: typeof t.title === 'string' ? t.title : '',
    notes: typeof t.notes === 'string' ? t.notes : '',
    done: !!t.done,
    doneAt: typeof t.doneAt === 'number' ? t.doneAt : null,
    priority,
    dueDate: typeof t.dueDate === 'string' ? t.dueDate : '',
    projectId: t.projectId == null ? null : String(t.projectId),
    order: Number.isFinite(Number(t.order)) ? num(t.order) : num(t.createdAt),
    subtasks: asArray(t.subtasks).filter((s) => s && s.id != null).map(canonSubtask),
    createdAt: num(t.createdAt),
    updatedAt: num(t.updatedAt),
  }
}

function canonSchedule(s) {
  const src = s || {}
  const frequency = src.frequency === 'weekly' ? 'weekly' : 'daily'
  const days = asArray(src.daysOfWeek).filter((d) => DAYS.includes(d))
  const uniqueSorted = DAYS.filter((d) => days.includes(d))
  return {
    frequency,
    daysOfWeek: uniqueSorted,
    time: typeof src.time === 'string' ? src.time : '',
    durationMinutes: Number.isFinite(src.durationMinutes) ? src.durationMinutes : 30,
  }
}

function canonHabit(h) {
  const sync = ['pending', 'synced', 'off'].includes(h.calendarSync) ? h.calendarSync : 'pending'
  return {
    id: h.id,
    title: typeof h.title === 'string' ? h.title : '',
    notes: typeof h.notes === 'string' ? h.notes : '',
    active: !!h.active,
    schedule: canonSchedule(h.schedule),
    calendarEventId: h.calendarEventId == null ? null : String(h.calendarEventId),
    calendarSync: sync,
    createdAt: num(h.createdAt),
    updatedAt: num(h.updatedAt),
  }
}

function canonTomb(t) {
  return { id: t.id, at: num(t.at), kind: t.kind === 'habit' ? 'habit' : 'todo' }
}

// Collapse duplicate ids (keep the newer version) so canonicalize matches the
// de-duplicated output of mergeStates — preserving the idempotency invariant.
function dedupeById(items) {
  const m = new Map()
  for (const it of items) {
    const prev = m.get(it.id)
    m.set(it.id, prev ? pickNewer(prev, it) : it)
  }
  return [...m.values()]
}

function cmpTodo(a, b) {
  return a.order - b.order || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
function cmpHabit(a, b) {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
function cmpTomb(a, b) {
  return a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export function canonicalize(state) {
  const s = normalize(state)
  const tombs = [...mergeTombstones(s.deleted, []).values()] // de-dupes tombstones by id
  return {
    app: APP,
    version: SCHEMA_VERSION,
    todos: dedupeById(s.todos.filter((t) => t && t.id != null)).map(canonTodo).sort(cmpTodo),
    habits: dedupeById(s.habits.filter((h) => h && h.id != null)).map(canonHabit).sort(cmpHabit),
    deleted: tombs.map(canonTomb).sort(cmpTomb),
  }
}

// Canonical JSON text for a state — this is exactly what we write to both remotes.
export function serialize(state) {
  return JSON.stringify(canonicalize(state), null, 2)
}
