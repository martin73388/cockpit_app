// Todo list view-model: search, filters, sort. Pure functions (easy to test).
import { PRIORITY_WEIGHT } from '../data/model.js'
import { isOverdue } from './dates.js'

export function todoProgress(todo) {
  const total = todo.subtasks.length
  const done = todo.subtasks.filter((s) => s.done).length
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 }
}

function matchesQuery(todo, q, projectLabel) {
  if (!q) return true
  const hay = [
    todo.title,
    todo.notes,
    projectLabel || '',
    ...todo.subtasks.map((s) => s.title),
  ]
    .join(' ')
    .toLowerCase()
  return hay.includes(q)
}

function statusOf(todo) {
  return todo.status || (todo.done ? 'done' : 'todo')
}

function matchesStatus(todo, status, today) {
  switch (status) {
    case 'todo':
      // « À faire » exclut les tâches en attente (elles ont leur propre puce).
      return statusOf(todo) === 'todo'
    case 'waiting':
      return statusOf(todo) === 'waiting'
    case 'done':
      return statusOf(todo) === 'done'
    case 'overdue':
      return isOverdue(todo, today)
    default:
      return true
  }
}

// dueDate ascending, empty due dates sorted last.
function cmpDue(a, b) {
  const av = a.dueDate || '￿'
  const bv = b.dueDate || '￿'
  return av < bv ? -1 : av > bv ? 1 : a.createdAt - b.createdAt
}

const COMPARATORS = {
  manual: (a, b) => (a.order || 0) - (b.order || 0) || a.createdAt - b.createdAt,
  due: cmpDue,
  priority: (a, b) => PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority] || cmpDue(a, b),
  created: (a, b) => b.createdAt - a.createdAt, // newest first
}

// filters: { query, status, priority, sort }
// projectLabelOf: (projectId) => string | undefined
export function visibleTodos(todos, filters, projectLabelOf = () => '', today = undefined) {
  const q = (filters.query || '').trim().toLowerCase()
  const cmp = COMPARATORS[filters.sort] || COMPARATORS.manual
  const prios = Array.isArray(filters.priorities) ? filters.priorities : null
  const filtered = todos.filter((t) => {
    if (!matchesStatus(t, filters.status, today)) return false
    if (prios && prios.length > 0 && prios.length < 3 && !prios.includes(t.priority)) return false
    if (!matchesQuery(t, q, projectLabelOf(t.projectId))) return false
    return true
  })
  // Slice to a copy before sorting to avoid mutating the store array.
  return filtered.slice().sort(cmp)
}
