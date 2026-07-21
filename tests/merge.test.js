import { describe, it, expect } from 'vitest'
import { mergeStates, canonicalize, serialize, isCockpitFile } from '../src/sync/merge.js'
import { APP, SCHEMA_VERSION } from '../src/data/model.js'

function todo(id, updatedAt, extra = {}) {
  return {
    id,
    title: id,
    notes: '',
    done: false,
    doneAt: null,
    priority: 'normale',
    dueDate: '',
    projectId: null,
    order: updatedAt,
    subtasks: [],
    createdAt: 1,
    updatedAt,
    ...extra,
  }
}
function habit(id, updatedAt, extra = {}) {
  return {
    id,
    title: id,
    notes: '',
    active: true,
    schedule: { frequency: 'daily', daysOfWeek: [], time: '', durationMinutes: 30 },
    calendarEventId: null,
    calendarSync: 'pending',
    createdAt: 1,
    updatedAt,
    ...extra,
  }
}
function state({ todos = [], habits = [], deleted = [] } = {}) {
  return { app: APP, version: SCHEMA_VERSION, todos, habits, deleted }
}
const ids = (list) => list.map((x) => x.id)

describe('isCockpitFile guard', () => {
  it('accepts a cockpit file', () => {
    expect(isCockpitFile(state())).toBe(true)
  })
  it('rejects null / non-cockpit shapes', () => {
    expect(isCockpitFile(null)).toBe(false)
    expect(isCockpitFile({ companies: [], contacts: [] })).toBe(false) // radar.json
    expect(isCockpitFile({ app: 'cockpit', todos: {}, habits: [] })).toBe(false)
  })
})

describe('last-writer-wins', () => {
  it('keeps the object with the greater updatedAt, whole object', () => {
    const a = state({ todos: [todo('t1', 5, { title: 'old', notes: 'A' })] })
    const b = state({ todos: [todo('t1', 9, { title: 'new', notes: 'B' })] })
    const m = mergeStates(a, b)
    expect(m.todos).toHaveLength(1)
    expect(m.todos[0].title).toBe('new')
    expect(m.todos[0].notes).toBe('B')
    expect(m.todos[0].updatedAt).toBe(9)
  })

  it('replaces subtasks wholesale (no subtask-level union)', () => {
    const a = state({ todos: [todo('t1', 5, { subtasks: [{ id: 's1', title: 'a', done: true }] })] })
    const b = state({ todos: [todo('t1', 9, { subtasks: [{ id: 's2', title: 'b', done: false }] })] })
    const m = mergeStates(a, b)
    expect(ids(m.todos[0].subtasks)).toEqual(['s2'])
  })

  it('unions distinct ids across both sides', () => {
    const a = state({ todos: [todo('t1', 5)], habits: [habit('h1', 5)] })
    const b = state({ todos: [todo('t2', 5)], habits: [habit('h2', 5)] })
    const m = mergeStates(a, b)
    expect(ids(m.todos).sort()).toEqual(['t1', 't2'])
    expect(ids(m.habits).sort()).toEqual(['h1', 'h2'])
  })
})

describe('tombstones', () => {
  it('a newer delete suppresses an older object and is retained', () => {
    const a = state({ todos: [todo('t1', 5)] })
    const b = state({ deleted: [{ id: 't1', at: 10, kind: 'todo' }] })
    const m = mergeStates(a, b)
    expect(m.todos).toHaveLength(0)
    expect(m.deleted).toEqual([{ id: 't1', at: 10, kind: 'todo' }])
  })

  it('prevents resurrection when re-merged with the old copy', () => {
    const withTodo = state({ todos: [todo('t1', 5)] })
    const deletedState = state({ deleted: [{ id: 't1', at: 10, kind: 'todo' }] })
    const merged = mergeStates(withTodo, deletedState)
    const remerged = mergeStates(merged, withTodo) // old device pushes t1 again
    expect(remerged.todos).toHaveLength(0)
  })

  it('an edit newer than the delete wins and prunes the obsolete tombstone', () => {
    const edited = state({ todos: [todo('t1', 20, { title: 'revived' })] })
    const deletedState = state({ deleted: [{ id: 't1', at: 10, kind: 'todo' }] })
    const m = mergeStates(edited, deletedState)
    expect(m.todos).toHaveLength(1)
    expect(m.todos[0].title).toBe('revived')
    expect(m.deleted).toHaveLength(0) // tombstone pruned (object updatedAt > at)
  })

  it('keeps the latest tombstone when both sides deleted', () => {
    const a = state({ deleted: [{ id: 't1', at: 4, kind: 'todo' }] })
    const b = state({ deleted: [{ id: 't1', at: 8, kind: 'todo' }] })
    expect(mergeStates(a, b).deleted).toEqual([{ id: 't1', at: 8, kind: 'todo' }])
  })
})

describe('determinism', () => {
  it('is commutative', () => {
    const a = state({
      todos: [todo('t1', 5), todo('t3', 2)],
      habits: [habit('h1', 3)],
      deleted: [{ id: 'x', at: 7, kind: 'todo' }],
    })
    const b = state({
      todos: [todo('t1', 9), todo('t2', 1)],
      habits: [habit('h2', 4)],
      deleted: [{ id: 'y', at: 2, kind: 'habit' }],
    })
    expect(mergeStates(a, b)).toEqual(mergeStates(b, a))
  })

  it('breaks equal-timestamp ties deterministically (commutative)', () => {
    const a = state({ todos: [todo('t1', 5, { title: 'AAA' })] })
    const b = state({ todos: [todo('t1', 5, { title: 'ZZZ' })] })
    expect(mergeStates(a, b)).toEqual(mergeStates(b, a))
  })

  it('is idempotent (merge with self == canonicalize)', () => {
    const a = state({ todos: [todo('t2', 2), todo('t1', 5)], habits: [habit('h1', 3)] })
    expect(mergeStates(a, a)).toEqual(canonicalize(a))
    const m = mergeStates(a, a)
    expect(mergeStates(m, m)).toEqual(m)
  })

  it('two identical devices emit a byte-identical file regardless of ordering', () => {
    const a = state({ todos: [todo('t1', 5, { order: 20 }), todo('t2', 6, { order: 10 })] })
    const b = state({ todos: [todo('t2', 6, { order: 10 }), todo('t1', 5, { order: 20 })] })
    expect(serialize(a)).toBe(serialize(b))
    expect(serialize(mergeStates(a, b))).toBe(serialize(a))
  })

  it('canonical order sorts todos by order then createdAt', () => {
    const a = state({ todos: [todo('t1', 5, { order: 30 }), todo('t2', 6, { order: 10 }), todo('t3', 7, { order: 20 })] })
    expect(ids(canonicalize(a).todos)).toEqual(['t2', 't3', 't1'])
  })

  it('coerces non-numeric updatedAt and stays commutative', () => {
    const a = state({ todos: [todo('t1', 5, { title: 'num' })] })
    const b = state({ todos: [{ ...todo('t1', 0, { title: 'str' }), updatedAt: '9' }] }) // string timestamp
    const m1 = mergeStates(a, b)
    const m2 = mergeStates(b, a)
    expect(m1).toEqual(m2)
    expect(m1.todos[0].title).toBe('str') // 9 > 5 once coerced
    expect(typeof m1.todos[0].updatedAt).toBe('number')
  })

  it('canonicalize de-duplicates ids so idempotency holds for dup-id input', () => {
    const dup = state({ todos: [todo('t1', 5, { title: 'old' }), todo('t1', 9, { title: 'new' })] })
    const c = canonicalize(dup)
    expect(c.todos).toHaveLength(1)
    expect(c.todos[0].title).toBe('new')
    expect(mergeStates(dup, dup)).toEqual(c)
  })
})
