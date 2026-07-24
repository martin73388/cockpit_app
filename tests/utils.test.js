import { describe, it, expect } from 'vitest'
import { reorderList } from '../src/utils/reorder.js'
import { visibleTodos, todoProgress } from '../src/utils/todoView.js'
import { isOverdue, dueLabel } from '../src/utils/dates.js'
import { describeSchedule } from '../src/utils/recurrence.js'

function todo(id, extra = {}) {
  return { id, title: id, notes: '', done: false, doneAt: null, priority: 'normale', dueDate: '', projectId: null, order: 0, subtasks: [], createdAt: 0, updatedAt: 0, ...extra }
}

describe('reorderList (drag reorder)', () => {
  it('drops after target when moving downward', () => {
    expect(reorderList(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd'])
  })
  it('drops before target when moving upward', () => {
    expect(reorderList(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
  })
  it('is a no-op for same id or unknown ids', () => {
    expect(reorderList(['a', 'b'], 'a', 'a')).toEqual(['a', 'b'])
    expect(reorderList(['a', 'b'], 'x', 'b')).toEqual(['a', 'b'])
  })
  it('adjacent swap downward', () => {
    expect(reorderList(['a', 'b', 'c'], 'a', 'b')).toEqual(['b', 'a', 'c'])
  })
})

describe('visibleTodos (filter/sort/search)', () => {
  const todos = [
    todo('t1', { title: 'Café', order: 30, createdAt: 1, priority: 'basse' }),
    todo('t2', { title: 'Rapport', notes: 'urgent', order: 10, createdAt: 2, priority: 'haute', dueDate: '2020-01-01' }),
    todo('t3', { title: 'Sport', order: 20, createdAt: 3, done: true }),
  ]
  const base = { query: '', status: 'all', priorities: ['haute', 'normale', 'basse'], sort: 'manual' }

  it('manual sort honors order', () => {
    expect(visibleTodos(todos, base).map((t) => t.id)).toEqual(['t2', 't3', 't1'])
  })
  it('status=todo hides done, status=done shows only done', () => {
    expect(visibleTodos(todos, { ...base, status: 'todo' }).map((t) => t.id).sort()).toEqual(['t1', 't2'])
    expect(visibleTodos(todos, { ...base, status: 'done' }).map((t) => t.id)).toEqual(['t3'])
  })
  it('status=overdue uses dueDate < today and not done', () => {
    expect(visibleTodos(todos, { ...base, status: 'overdue' }, () => '', '2026-07-20').map((t) => t.id)).toEqual(['t2'])
  })
  it('priority filter (multi-choix)', () => {
    expect(visibleTodos(todos, { ...base, priorities: ['haute'] }).map((t) => t.id)).toEqual(['t2'])
    // haute + normale sans les basses (le cas demandé)
    expect(visibleTodos(todos, { ...base, priorities: ['haute', 'normale'] }).map((t) => t.id)).toEqual(['t2', 't3'])
  })
  it('search matches title, notes, subtasks and project label', () => {
    expect(visibleTodos(todos, { ...base, query: 'urgent' }).map((t) => t.id)).toEqual(['t2'])
    const withSub = [todo('s1', { title: 'x', subtasks: [{ id: 'a', title: 'appeler client', done: false }] })]
    expect(visibleTodos(withSub, { ...base, query: 'client' })).toHaveLength(1)
    const withProj = [todo('p1', { projectId: 'c1' })]
    expect(visibleTodos(withProj, { ...base, query: 'acme' }, (id) => (id === 'c1' ? 'ACME' : ''))).toHaveLength(1)
  })
  it('priority sort orders haute < normale < basse', () => {
    expect(visibleTodos(todos, { ...base, sort: 'priority' }).map((t) => t.id)).toEqual(['t2', 't3', 't1'])
  })
})

describe('todoProgress', () => {
  it('computes done/total/pct', () => {
    expect(todoProgress(todo('x', { subtasks: [{ id: '1', done: true }, { id: '2', done: false }] }))).toEqual({ done: 1, total: 2, pct: 50 })
    expect(todoProgress(todo('x'))).toEqual({ done: 0, total: 0, pct: 0 })
  })
})

describe('dates', () => {
  it('isOverdue only when not done and due in the past', () => {
    expect(isOverdue(todo('x', { dueDate: '2020-01-01' }), '2026-07-20')).toBe(true)
    expect(isOverdue(todo('x', { dueDate: '2020-01-01', done: true }), '2026-07-20')).toBe(false)
    expect(isOverdue(todo('x', { dueDate: '' }), '2026-07-20')).toBe(false)
  })
  it('dueLabel special-cases today/tomorrow', () => {
    expect(dueLabel('2026-07-20', '2026-07-20')).toBe("Aujourd'hui")
    expect(dueLabel('2026-07-21', '2026-07-20')).toBe('Demain')
  })
})

describe('describeSchedule', () => {
  it('daily with time and duration', () => {
    expect(describeSchedule({ frequency: 'daily', daysOfWeek: [], time: '09:00', durationMinutes: 30 })).toBe('Tous les jours · 09:00 · 30 min')
  })
  it('weekly lists days', () => {
    expect(describeSchedule({ frequency: 'weekly', daysOfWeek: ['WE', 'MO', 'FR'], time: '', durationMinutes: 0 })).toBe('Lun, Mer, Ven')
  })
  it('weekly weekdays shortcut', () => {
    expect(describeSchedule({ frequency: 'weekly', daysOfWeek: ['MO', 'TU', 'WE', 'TH', 'FR'], time: '', durationMinutes: 0 })).toBe('En semaine')
  })
})
