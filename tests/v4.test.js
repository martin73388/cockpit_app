import { describe, it, expect } from 'vitest'
import { canonicalize, mergeStates } from '../src/sync/merge.js'
import { createStore } from '../src/data/store.js'
import { newTodo, APP, SCHEMA_VERSION } from '../src/data/model.js'
import { stalledTodos, computeAlerts } from '../src/utils/alerts.js'

function state(partial = {}) {
  return { app: APP, version: SCHEMA_VERSION, todos: [], habits: [], inbox: [], deleted: [], ...partial }
}
function freshStore(todos = []) {
  return createStore(canonicalize(state({ todos })))
}

describe('v4 : focus (plan du jour)', () => {
  it('canonTodo valide focus et le migre à null par défaut', () => {
    const t = { ...newTodo({ title: 'x' }), focus: undefined }
    const c = canonicalize(state({ todos: [t] }))
    expect(c.todos[0].focus).toBe(null)
    const t2 = { ...newTodo({ title: 'y' }), focus: { date: '2026-07-24', count: 2 } }
    expect(canonicalize(state({ todos: [t2] })).todos[0].focus).toEqual({ date: '2026-07-24', count: 2 })
    const t3 = { ...newTodo({ title: 'z' }), focus: { date: 'garbage', count: -3 } }
    expect(canonicalize(state({ todos: [t3] })).todos[0].focus).toBe(null)
  })

  it('toggleFocus épingle puis retire ; terminer sort du plan', () => {
    const st = freshStore([newTodo({ title: 'a' })])
    const id = st.getSnapshot().todos[0].id
    st.toggleFocus(id, '2026-07-24')
    expect(st.getSnapshot().todos[0].focus).toEqual({ date: '2026-07-24', count: 0 })
    st.toggleTodoDone(id)
    expect(st.getSnapshot().todos[0].focus).toBe(null) // done -> sort du plan
    st.toggleTodoDone(id) // rouvre
    st.toggleFocus(id, '2026-07-24')
    st.toggleFocus(id, '2026-07-24')
    expect(st.getSnapshot().todos[0].focus).toBe(null) // toggle off
  })

  it('rolloverFocus : les ⭐ d’hier roulent vers aujourd’hui (count+1), idempotent', () => {
    const a = newTodo({ title: 'reportée', focus: { date: '2026-07-23', count: 1 } })
    const b = newTodo({ title: 'du jour', focus: { date: '2026-07-24', count: 0 } })
    const done = newTodo({ title: 'finie', done: true, status: 'done', focus: { date: '2026-07-23', count: 0 } })
    const st = freshStore([a, b, done])
    st.rolloverFocus('2026-07-24')
    const byTitle = Object.fromEntries(st.getSnapshot().todos.map((t) => [t.title, t.focus]))
    expect(byTitle['reportée']).toEqual({ date: '2026-07-24', count: 2 })
    expect(byTitle['du jour']).toEqual({ date: '2026-07-24', count: 0 }) // inchangée
    const before = st.getSnapshot()
    st.rolloverFocus('2026-07-24') // deuxième passage : no-op
    expect(st.getSnapshot()).toBe(before)
  })

  it('fusion : focus suit le LWW objet, commutatif', () => {
    const t1 = { ...newTodo({ title: 'x' }), id: 'X', updatedAt: 10, focus: { date: '2026-07-24', count: 1 } }
    const t2 = { ...t1, updatedAt: 5, focus: null }
    const m = mergeStates(state({ todos: [t1] }), state({ todos: [t2] }))
    expect(m.todos[0].focus).toEqual({ date: '2026-07-24', count: 1 })
    expect(mergeStates(state({ todos: [t1] }), state({ todos: [t2] }))).toEqual(
      mergeStates(state({ todos: [t2] }), state({ todos: [t1] })),
    )
  })
})

describe('v4 : « Créer la suite » (next action)', () => {
  it('hérite du projet et de la priorité, arrive en fin de liste', () => {
    const src = newTodo({ title: 'Envoyer le mail', priority: 'haute', projectId: 'proj1', order: 1000 })
    const st = freshStore([src])
    const id = st.addFollowUpTodo(src.id, { title: 'Relancer Jean', dueDate: '2026-07-28' })
    const created = st.getSnapshot().todos.find((t) => t.id === id)
    expect(created.title).toBe('Relancer Jean')
    expect(created.priority).toBe('haute')
    expect(created.projectId).toBe('proj1')
    expect(created.dueDate).toBe('2026-07-28')
    expect(created.order).toBeGreaterThan(1000)
    expect(created.status).toBe('todo')
  })
  it('titre vide -> rien créé', () => {
    const src = newTodo({ title: 'x' })
    const st = freshStore([src])
    expect(st.addFollowUpTodo(src.id, { title: '   ' })).toBe(null)
    expect(st.getSnapshot().todos).toHaveLength(1)
  })
})

describe('v4 : sujets en panne (stalled)', () => {
  const now = Date.parse('2026-07-24T12:00:00Z')
  const old = now - 10 * 86400000
  function t(extra) {
    return canonicalize(state({ todos: [{ ...newTodo({ title: 'sujet' }), updatedAt: old, ...extra }] })).todos
  }
  it('détecte : active, sans étape restante, sans attente, sans échéance, > 7 j', () => {
    expect(stalledTodos(t({}), now)).toHaveLength(1)
  })
  it('ignore : échéance, attente, sous-tâche restante, récent, terminé', () => {
    expect(stalledTodos(t({ dueDate: '2026-08-01' }), now)).toHaveLength(0)
    expect(stalledTodos(t({ status: 'waiting', waiting: { note: 'x', since: old, followUpDate: '' } }), now)).toHaveLength(0)
    expect(stalledTodos(t({ subtasks: [{ id: 's1', title: 'reste', done: false }] }), now)).toHaveLength(0)
    expect(stalledTodos(t({ updatedAt: now - 86400000 }), now)).toHaveLength(0)
    expect(stalledTodos(t({ done: true, status: 'done' }), now)).toHaveLength(0)
  })
  it('computeAlerts expose le groupe Cockpit sans URL', () => {
    const groups = computeAlerts({ radar: { available: false }, carnet: { available: false } }, '2026-07-24', now, t({}))
    const cockpit = groups.find((g) => g.source === 'Cockpit')
    expect(cockpit.url).toBe(null)
    expect(cockpit.items).toHaveLength(1)
  })
})
