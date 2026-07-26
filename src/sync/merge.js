// Merge engine — the core of multi-device sync.
//
// Rules (v2):
//   - Per id, the object with the greatest updatedAt wins, WHOLE object —
//     EXCEPT habit completions, tracked as a per-date CRDT (`checks`:
//     date -> {on, at}, LWW per date; `completions` derived). A check made on
//     one device is never lost to LWW, and an un-check is durable instead of
//     being resurrected by a blind union.
//   - inbox items merge by id (LWW per item) like todos.
//   - Tombstones (root.deleted[], {id, at, kind:"todo"|"habit"|"inbox"})
//     prevent resurrection.
//   - Canonical stable ordering so two identical devices emit identical bytes.
//   - Never treat a remote that is not a Cockpit file as mergeable.
//
// Loading an older file through canonicalize() IS the migration: defaults are
// added (v2 completions/pillar/anchorDate/inbox, v3 status/waiting, v4 focus,
// v5 scheduled/calendar*) and version is rewritten. Idempotent by construction.
//
// mergeStates is commutative and idempotent:
//   mergeStates(a, b) deep-equals mergeStates(b, a)
//   mergeStates(a, a) deep-equals canonicalize(a)
import { APP, SCHEMA_VERSION, DAYS, PRIORITIES, PILLARS } from '../data/model.js'

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
    inbox: asArray(state && state.inbox),
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

// ---- Per-date completion CRDT.
// `checks` maps "YYYY-MM-DD" -> { on, at }: the last check/un-check of that date
// (LWW per date). `completions` is DERIVED (dates where on === true, sorted).
// This keeps the spec's guarantee — a check made on another device is never
// lost (absence never beats presence) — while making un-checking durable:
// a newer { on:false } wins over a stale { on:true } instead of being
// resurrected by a blind union.

// Validate stored entries and seed missing ones from legacy `completions`
// (v1 / early-v2 files): a bare date is an implicit { on:true } as of the
// habit's updatedAt.
function seededChecks(h) {
  const out = {}
  const raw = h && h.checks && typeof h.checks === 'object' && !Array.isArray(h.checks) ? h.checks : {}
  for (const [date, e] of Object.entries(raw)) {
    if (!DATE_RE.test(date) || !e || typeof e !== 'object') continue
    out[date] = { on: !!e.on, at: num(e.at) }
  }
  for (const d of asArray(h && h.completions)) {
    if (typeof d === 'string' && DATE_RE.test(d) && !(d in out)) out[d] = { on: true, at: num(h && h.updatedAt) }
  }
  return out
}

// Per-date LWW join: higher `at` wins; on an exact tie, on:true wins (never
// lose a check) — commutative either way.
function mergeChecks(a, b) {
  const out = { ...a }
  for (const [date, e] of Object.entries(b)) {
    const prev = out[date]
    if (!prev || e.at > prev.at || (e.at === prev.at && e.on && !prev.on)) out[date] = e
  }
  return out
}

function completionsOf(checks) {
  return Object.keys(checks).filter((d) => checks[d].on).sort()
}

// Habits combine specially: LWW for every field EXCEPT the completion CRDT
// (per-date join of both sides) and updatedAt (max of both, so the joined
// checks survive later merges against either original side).
function combineHabit(x, y) {
  const winner = pickNewer(x, y)
  const checks = mergeChecks(seededChecks(x), seededChecks(y))
  return {
    ...winner,
    checks,
    completions: completionsOf(checks),
    updatedAt: Math.max(num(x.updatedAt), num(y.updatedAt)),
  }
}

const TOMB_KINDS = ['todo', 'habit', 'inbox']

function mergeTombstones(a, b) {
  const map = new Map()
  for (const t of [...a, ...b]) {
    if (!t || t.id == null) continue
    const at = num(t.at)
    const kind = TOMB_KINDS.includes(t.kind) ? t.kind : 'todo'
    const prev = map.get(t.id)
    // Tie-break kind deterministically on equal `at` so the result is commutative.
    if (!prev || at > prev.at || (at === prev.at && kind < prev.kind)) map.set(t.id, { id: t.id, at, kind })
  }
  return map
}

// Union by id (custom combiner), then drop anything a tombstone buries.
function mergeCollection(a, b, tombs, combine = pickNewer) {
  const byId = new Map()
  for (const item of [...a, ...b]) {
    if (!item || item.id == null) continue
    const prev = byId.get(item.id)
    byId.set(item.id, prev ? combine(prev, item) : item)
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
  const habits = mergeCollection(na.habits, nb.habits, tombs, combineHabit)
  const inbox = mergeCollection(na.inbox, nb.inbox, tombs)

  // Prune tombstones made obsolete by a resurrected/edited object (updatedAt > at).
  const live = new Map([...todos, ...habits, ...inbox])
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
    inbox: [...inbox.values()],
    deleted,
  })
}

// ---- Canonicalization: fixed key order + stable array order -> identical files.
// Running a version-1 state through this IS the v1→v2 migration (defaults added,
// version rewritten to SCHEMA_VERSION).

function canonSubtask(s) {
  return { id: s.id, title: typeof s.title === 'string' ? s.title : '', done: !!s.done }
}

// v5 — créneau réservé. Validé strictement : il pilote la création d'un
// événement d'agenda côté robot, une date/heure douteuse ne doit jamais sortir.
function canonSlot(s) {
  if (!s || typeof s !== 'object' || typeof s.date !== 'string' || !DATE_RE.test(s.date)) return null
  // Arrondir AVANT de tester la positivité : sinon 0.3 donne 0 au premier
  // passage puis 60 au second, et canonicalize cesse d'être idempotent.
  const mins = Math.round(Number(s.durationMinutes))
  return {
    date: s.date,
    time: typeof s.time === 'string' && TIME_RE.test(s.time) ? s.time : '',
    durationMinutes: Number.isFinite(mins) && mins > 0 ? mins : 60,
  }
}

function canonTodo(t) {
  const priority = PRIORITIES.includes(t.priority) ? t.priority : 'normale'
  // v3 : status ('todo'|'waiting'|'done'), v5 ajoute 'scheduled'. Migration v2 :
  // dérivé de done. `done` reste émis et synchronisé pour tout lecteur externe.
  let status = ['todo', 'waiting', 'scheduled', 'done'].includes(t.status) ? t.status : (t.done ? 'done' : 'todo')
  if (t.done && status !== 'done') status = 'done' // done coché prime (cohérence)
  const w = t.waiting
  const waiting =
    status === 'waiting' && w && typeof w === 'object'
      ? {
          note: typeof w.note === 'string' ? w.note : '',
          since: num(w.since),
          followUpDate: typeof w.followUpDate === 'string' && DATE_RE.test(w.followUpDate) ? w.followUpDate : '',
        }
      : null
  if (status === 'waiting' && !waiting) status = 'todo' // waiting sans détail -> retombe à faire
  // Le créneau survit à la complétion (trace de « quand je l'ai fait ») ; seul un
  // statut 'scheduled' orphelin de créneau retombe « à faire ».
  const scheduled = canonSlot(t.scheduled)
  if (status === 'scheduled' && !scheduled) status = 'todo'
  const f = t.focus
  const focus =
    f && typeof f === 'object' && typeof f.date === 'string' && DATE_RE.test(f.date)
      ? { date: f.date, count: Math.max(0, Math.floor(num(f.count))) }
      : null
  return {
    id: t.id,
    title: typeof t.title === 'string' ? t.title : '',
    notes: typeof t.notes === 'string' ? t.notes : '',
    done: status === 'done',
    doneAt: typeof t.doneAt === 'number' ? t.doneAt : null,
    status,
    waiting,
    scheduled,
    calendarEventId: t.calendarEventId == null ? null : String(t.calendarEventId),
    // Défaut 'off' (et NON 'pending' comme les habitudes) : migrer un fichier v4
    // ne doit pas déclencher la création d'un événement pour chaque tâche.
    calendarSync: ['pending', 'synced', 'off'].includes(t.calendarSync) ? t.calendarSync : 'off',
    focus,
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
  const frequency = src.frequency === 'weekly' || src.frequency === 'biweekly' ? src.frequency : 'daily'
  const days = asArray(src.daysOfWeek).filter((d) => DAYS.includes(d))
  const uniqueSorted = DAYS.filter((d) => days.includes(d))
  const anchor = typeof src.anchorDate === 'string' && DATE_RE.test(src.anchorDate) ? src.anchorDate : ''
  return {
    frequency,
    daysOfWeek: uniqueSorted,
    time: typeof src.time === 'string' ? src.time : '',
    durationMinutes: Number.isFinite(src.durationMinutes) ? src.durationMinutes : 30,
    anchorDate: anchor,
  }
}

function canonHabit(h) {
  const sync = ['pending', 'synced', 'off'].includes(h.calendarSync) ? h.calendarSync : 'pending'
  const seeded = seededChecks(h)
  const checks = {}
  for (const date of Object.keys(seeded).sort()) checks[date] = seeded[date]
  return {
    id: h.id,
    title: typeof h.title === 'string' ? h.title : '',
    notes: typeof h.notes === 'string' ? h.notes : '',
    active: !!h.active,
    schedule: canonSchedule(h.schedule),
    completions: completionsOf(checks),
    checks,
    pillar: PILLARS.includes(h.pillar) ? h.pillar : null,
    calendarEventId: h.calendarEventId == null ? null : String(h.calendarEventId),
    calendarSync: sync,
    createdAt: num(h.createdAt),
    updatedAt: num(h.updatedAt),
  }
}

function canonInbox(i) {
  return {
    id: i.id,
    text: typeof i.text === 'string' ? i.text : '',
    createdAt: num(i.createdAt),
    processedAt: typeof i.processedAt === 'number' ? i.processedAt : null,
    processedNote: typeof i.processedNote === 'string' ? i.processedNote : '',
    updatedAt: num(i.updatedAt != null ? i.updatedAt : i.createdAt),
  }
}

function canonTomb(t) {
  return { id: t.id, at: num(t.at), kind: TOMB_KINDS.includes(t.kind) ? t.kind : 'todo' }
}

// Collapse duplicate ids (keep the newer version) so canonicalize matches the
// de-duplicated output of mergeStates — preserving the idempotency invariant.
function dedupeById(items, combine = pickNewer) {
  const m = new Map()
  for (const it of items) {
    const prev = m.get(it.id)
    m.set(it.id, prev ? combine(prev, it) : it)
  }
  return [...m.values()]
}

function cmpTodo(a, b) {
  return a.order - b.order || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
function cmpHabit(a, b) {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
function cmpInbox(a, b) {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
function cmpTomb(a, b) {
  return a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export function canonicalize(state) {
  const s = normalize(state)
  const tombs = mergeTombstones(s.deleted, []) // de-dupes tombstones by id
  const suppress = (item) => {
    const tomb = tombs.get(item.id)
    return !(tomb && tomb.at >= num(item.updatedAt)) // same rule as mergeCollection
  }
  const todos = dedupeById(s.todos.filter((t) => t && t.id != null)).filter(suppress)
  const habits = dedupeById(s.habits.filter((h) => h && h.id != null), combineHabit).filter(suppress)
  const inbox = dedupeById(s.inbox.filter((i) => i && i.id != null)).filter(suppress)
  // Prune tombstones outlived by their object (updatedAt > at) — as mergeStates does.
  const live = new Map([...todos, ...habits, ...inbox].map((x) => [x.id, x]))
  const deleted = [...tombs.values()].filter((t) => {
    const survivor = live.get(t.id)
    return !(survivor && num(survivor.updatedAt) > t.at)
  })
  return {
    app: APP,
    version: SCHEMA_VERSION,
    todos: todos.map(canonTodo).sort(cmpTodo),
    habits: habits.map(canonHabit).sort(cmpHabit),
    inbox: inbox.map(canonInbox).sort(cmpInbox),
    deleted: deleted.map(canonTomb).sort(cmpTomb),
  }
}

// Canonical JSON text for a state — this is exactly what we write to both remotes.
export function serialize(state) {
  return JSON.stringify(canonicalize(state), null, 2)
}
