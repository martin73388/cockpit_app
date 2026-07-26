import { describe, it, expect } from 'vitest'
import { canonicalize, mergeStates, serialize } from '../src/sync/merge.js'
import { createStore } from '../src/data/store.js'
import { newTodo, APP, SCHEMA_VERSION, ESTIMATES } from '../src/data/model.js'
import { formatDuration } from '../src/utils/dates.js'

function state(partial = {}) {
  return { app: APP, version: SCHEMA_VERSION, todos: [], habits: [], inbox: [], deleted: [], ...partial }
}
function freshStore(todos = []) {
  return createStore(canonicalize(state({ todos })))
}

describe('v6 : temps estimé', () => {
  it('version du fichier', () => {
    expect(canonicalize(state()).version).toBe(SCHEMA_VERSION)
    expect(SCHEMA_VERSION).toBe(6)
  })

  it('une tâche migrée depuis v5 arrive simplement « non estimée »', () => {
    const legacy = { ...newTodo({ title: 'ancienne' }) }
    delete legacy.estimateMinutes
    expect(canonicalize(state({ todos: [legacy] })).todos[0].estimateMinutes).toBe(null)
  })

  it('canonTodo valide l’estimation et reste idempotent', () => {
    const cases = [
      [45, 45],
      ['30', 30],
      [90.4, 90],
      [0, null],
      [-10, null],
      [null, null],
      ['plus tard', null],
      [0.3, null], // arrondi AVANT le test de positivité : sinon 0 puis null au 2e passage
    ]
    for (const [input, expected] of cases) {
      const s = state({ todos: [newTodo({ title: 'x', estimateMinutes: input })] })
      const once = canonicalize(s)
      expect(once.todos[0].estimateMinutes, `entrée ${JSON.stringify(input)}`).toBe(expected)
      expect(canonicalize(once)).toEqual(once) // idempotence
      expect(mergeStates(s, s)).toEqual(once) // invariant du moteur
    }
  })

  it('sérialisation stable et fusion commutative avec l’estimation', () => {
    const a = { ...newTodo({ title: 'x' }), id: 'X', updatedAt: 10, estimateMinutes: 45 }
    const b = { ...a, updatedAt: 20, estimateMinutes: 90 }
    const m = mergeStates(state({ todos: [a] }), state({ todos: [b] }))
    expect(m.todos[0].estimateMinutes).toBe(90) // LWW objet
    expect(mergeStates(state({ todos: [b] }), state({ todos: [a] }))).toEqual(m)
    expect(serialize(m)).toBe(serialize(canonicalize(m)))
  })

  it('updateTodo pose et retire l’estimation', () => {
    const st = freshStore([newTodo({ title: 'a' })])
    const id = st.getSnapshot().todos[0].id
    st.updateTodo(id, { estimateMinutes: 45 })
    expect(st.getSnapshot().todos[0].estimateMinutes).toBe(45)
    st.updateTodo(id, { estimateMinutes: null })
    expect(st.getSnapshot().todos[0].estimateMinutes).toBe(null)
  })

  it('formatDuration lit comme un humain', () => {
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(60)).toBe('1 h')
    expect(formatDuration(90)).toBe('1 h 30')
    expect(formatDuration(125)).toBe('2 h 05')
    expect(formatDuration(0)).toBe('')
    expect(formatDuration(null)).toBe('')
    for (const m of ESTIMATES) expect(formatDuration(m)).not.toBe('')
  })

  it('planifier part du temps estimé pour dimensionner le créneau', () => {
    // Le lien entre les deux : un créneau qui colle à ce que la tâche demande.
    const st = freshStore([newTodo({ title: 'a', estimateMinutes: 90 })])
    const id = st.getSnapshot().todos[0].id
    st.scheduleTodo(id, { date: '2099-01-01', time: '10:00', durationMinutes: 90 })
    expect(st.getSnapshot().todos[0].scheduled.durationMinutes).toBe(90)
  })
})
