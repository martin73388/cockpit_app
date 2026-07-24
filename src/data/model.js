// Cockpit data model — factories, constants, defaults.
// Conventions shared with Radar / Carnet de bord:
//   - ids from crypto.randomUUID()
//   - timestamps in epoch ms, updatedAt monotone (see clock.js)
//   - deletions via tombstones (root.deleted[])
import { stamp } from './clock.js'

export const APP = 'cockpit'
export const SCHEMA_VERSION = 3

export const PRIORITIES = ['haute', 'normale', 'basse']
export const PRIORITY_LABEL = { haute: 'Haute', normale: 'Normale', basse: 'Basse' }
// Ascending weight so "priority" sort puts haute first.
export const PRIORITY_WEIGHT = { haute: 0, normale: 1, basse: 2 }

export const STATUS_FILTERS = ['all', 'todo', 'waiting', 'done', 'overdue']
export const STATUS_LABEL = { all: 'Toutes', todo: 'À faire', waiting: 'En attente', done: 'Faites', overdue: 'En retard' }

export const TODO_STATUSES = ['todo', 'waiting', 'done']

export const SORTS = ['manual', 'due', 'priority', 'created']
export const SORT_LABEL = { manual: 'Manuel', due: 'Échéance', priority: 'Priorité', created: 'Création' }

export const LAYOUTS = ['rows', 'cards']

export const FREQUENCIES = ['daily', 'weekly', 'biweekly']
export const FREQUENCY_LABEL = { daily: 'Quotidienne', weekly: 'Hebdomadaire', biweekly: 'Toutes les 2 semaines' }

export const PILLARS = ['sommeil', 'sport', 'couple', 'proches', 'repas']
export const PILLAR_LABEL = { sommeil: 'Sommeil', sport: 'Sport', couple: 'Couple', proches: 'Proches', repas: 'Repas' }

// Ordered Mon-first, matching human recurrence display.
export const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
export const DAY_LABEL = { MO: 'Lun', TU: 'Mar', WE: 'Mer', TH: 'Jeu', FR: 'Ven', SA: 'Sam', SU: 'Dim' }

export const CALENDAR_SYNC = ['pending', 'synced', 'off']

export function uid() {
  // crypto.randomUUID is available in all PWA-capable browsers and in Node 22.
  return crypto.randomUUID()
}

export function emptyState() {
  return { app: APP, version: SCHEMA_VERSION, todos: [], habits: [], inbox: [], deleted: [] }
}

export function newTodo(patch = {}) {
  const t = stamp()
  return {
    id: uid(),
    title: '',
    notes: '',
    done: false,
    doneAt: null,
    status: 'todo', // 'todo' | 'waiting' | 'done' — done reste synchronisé (dérivé)
    waiting: null, // { note, since(epoch ms), followUpDate("YYYY-MM-DD"|"") } quand status==='waiting'
    priority: 'normale',
    dueDate: '',
    projectId: null,
    order: t, // large monotone default -> new items append at the end of manual order
    subtasks: [],
    createdAt: t,
    updatedAt: t,
    ...patch,
  }
}

export function newSubtask(patch = {}) {
  return { id: uid(), title: '', done: false, ...patch }
}

export function emptySchedule() {
  // anchorDate is only meaningful for biweekly (week-parity anchor); kept ''
  // otherwise so canonical serialization stays stable.
  return { frequency: 'daily', daysOfWeek: [], time: '', durationMinutes: 30, anchorDate: '' }
}

export function newHabit(patch = {}) {
  const t = stamp()
  return {
    id: uid(),
    title: '',
    notes: '',
    active: true,
    schedule: emptySchedule(),
    completions: [],
    checks: {}, // per-date completion CRDT: { "YYYY-MM-DD": { on, at } } — completions is derived
    pillar: null,
    calendarEventId: null,
    calendarSync: 'pending',
    createdAt: t,
    updatedAt: t,
    ...patch,
  }
}

export function newInboxItem(text, patch = {}) {
  const t = stamp()
  return { id: uid(), text: text || '', createdAt: t, processedAt: null, processedNote: '', updatedAt: t, ...patch }
}

export function tombstone(id, kind) {
  return { id, at: stamp(), kind }
}
