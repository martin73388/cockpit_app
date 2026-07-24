import { describe, it, expect } from 'vitest'
import { canonicalize, mergeStates, serialize } from '../src/sync/merge.js'
import { visibleTodos } from '../src/utils/todoView.js'
import { createStore } from '../src/data/store.js'
import { newTodo } from '../src/data/model.js'
import { getUi, setUi } from '../src/data/ui.js'
import { APP } from '../src/data/model.js'

function todo(id, extra = {}) {
  return { id, title: id, notes: '', done: false, doneAt: null, status: 'todo', waiting: null, priority: 'normale', dueDate: '', projectId: null, order: 0, subtasks: [], createdAt: 1, updatedAt: 1, ...extra }
}
function state(partial = {}) {
  return { app: APP, version: 3, todos: [], habits: [], inbox: [], deleted: [], ...partial }
}

describe('migration v2 -> v3 (status/waiting)', () => {
  it('dérive status depuis done et émet waiting:null', () => {
    const v2 = state({ version: 2, todos: [{ ...todo('t1'), status: undefined, waiting: undefined }, { ...todo('t2', { done: true }), status: undefined, waiting: undefined }] })
    const m = canonicalize(v2)
    expect(m.version).toBe(3)
    expect(m.todos[0].status).toBe('todo')
    expect(m.todos[0].waiting).toBe(null)
    expect(m.todos[1].status).toBe('done')
    expect(m.todos[1].done).toBe(true)
    expect(canonicalize(m)).toEqual(m) // idempotent
  })
  it('waiting valide est conservé ; waiting sans détail retombe à faire', () => {
    const a = state({ todos: [
      todo('t1', { status: 'waiting', waiting: { note: 'réponse de Jean', since: 5, followUpDate: '2026-07-28' } }),
      todo('t2', { status: 'waiting', waiting: null }),
    ] })
    const c = canonicalize(a)
    expect(c.todos[0].status).toBe('waiting')
    expect(c.todos[0].waiting).toEqual({ note: 'réponse de Jean', since: 5, followUpDate: '2026-07-28' })
    expect(c.todos[0].done).toBe(false)
    expect(c.todos[1].status).toBe('todo')
  })
  it('fusion LWW : le waiting le plus récent gagne (objet entier)', () => {
    const a = state({ todos: [todo('t1', { updatedAt: 10, status: 'waiting', waiting: { note: 'X', since: 10, followUpDate: '' } })] })
    const b = state({ todos: [todo('t1', { updatedAt: 5 })] })
    const m = mergeStates(a, b)
    expect(m.todos[0].status).toBe('waiting')
    expect(mergeStates(a, b)).toEqual(mergeStates(b, a))
    expect(serialize(mergeStates(a, a))).toBe(serialize(canonicalize(a)))
  })
})

describe('filtres v3', () => {
  const todos = [
    todo('t1', { priority: 'haute' }),
    todo('t2', { priority: 'basse' }),
    todo('t3', { status: 'waiting', waiting: { note: 'n', since: 1, followUpDate: '' } }),
    todo('t4', { status: 'done', done: true }),
  ]
  const base = { query: '', status: 'all', priorities: ['haute', 'normale', 'basse'], sort: 'manual' }
  it('« À faire » exclut les en-attente et les faites', () => {
    expect(visibleTodos(todos, { ...base, status: 'todo' }).map((t) => t.id)).toEqual(['t1', 't2'])
  })
  it('« En attente » ne montre que les waiting', () => {
    expect(visibleTodos(todos, { ...base, status: 'waiting' }).map((t) => t.id)).toEqual(['t3'])
  })
  it('multi-priorité : haute+normale sans basse', () => {
    expect(visibleTodos(todos, { ...base, priorities: ['haute', 'normale'] }).map((t) => t.id)).toEqual(['t1', 't3', 't4'])
  })
})

describe('store v3 : cycle attente', () => {
  function freshStore(extraTodos = []) {
    const t = newTodo({ title: 'Envoyer le mail' })
    return { st: createStore(canonicalize(state({ todos: [t, ...extraTodos] }))), id: t.id }
  }
  it('setTodoWaiting -> waiting avec note/date ; resumeTodo -> retour à faire', () => {
    const { st, id } = freshStore()
    st.setTodoWaiting(id, { note: 'réponse de Jean', followUpDate: '2026-07-30' })
    let t = st.getSnapshot().todos[0]
    expect(t.status).toBe('waiting')
    expect(t.done).toBe(false)
    expect(t.waiting.note).toBe('réponse de Jean')
    expect(t.waiting.since).toBeGreaterThan(0)
    st.resumeTodo(id)
    t = st.getSnapshot().todos[0]
    expect(t.status).toBe('todo')
    expect(t.waiting).toBe(null)
  })
  it('terminer une tâche en attente clôt l’attente', () => {
    const { st, id } = freshStore()
    st.setTodoWaiting(id, { note: 'x' })
    st.toggleTodoDone(id)
    const t = st.getSnapshot().todos[0]
    expect(t.status).toBe('done')
    expect(t.waiting).toBe(null)
    expect(t.done).toBe(true)
  })
})

describe('ui v3 : migration du pref priority -> priorities', () => {
  it('convertit l’ancien réglage simple', () => {
    localStorage.setItem('cockpit-ui', JSON.stringify({ priority: 'haute', sort: 'due' }))
    const ui = getUi()
    expect(ui.priorities).toEqual(['haute'])
    expect(ui.sort).toBe('due')
    expect(ui.priority).toBeUndefined()
    localStorage.removeItem('cockpit-ui')
  })
})
