// Contrat d'interopérabilité avec Carnet de bord (carnet_core/interop/README.md).
// Carnet LIT nos todos et, depuis une fiche projet, AJOUTE une todo dans
// cockpit-data.json (ajout seul, CAS sur `version`). Ces tests verrouillent ce
// dont Carnet dépend : si un refactor les casse, c'est Carnet qui casse — en
// silence, chez l'utilisateur.
import { describe, it, expect } from 'vitest'
import { canonicalize, mergeStates, serialize } from '../src/sync/merge.js'
import { createStore } from '../src/data/store.js'
import { newTodo, newSubtask, APP, SCHEMA_VERSION, TODO_STATUSES } from '../src/data/model.js'

function state(partial = {}) {
  return { app: APP, version: SCHEMA_VERSION, todos: [], habits: [], inbox: [], deleted: [], ...partial }
}
function freshStore(todos = []) {
  return createStore(canonicalize(state({ todos })))
}
const subIds = (store, id) => store.getSnapshot().todos.find((t) => t.id === id).subtasks.map((s) => s.id)

// La todo telle que Carnet la fabrique (conforme à notre newTodo, sans les
// champs v5+ qu'il ne connaît pas).
function carnetTodo(patch = {}) {
  const t = Date.now()
  return {
    id: 'carnet-uuid-1', title: 'Contacter Williams pour exposer', notes: '',
    done: false, doneAt: null, status: 'todo', waiting: null, focus: null,
    priority: 'normale', dueDate: '', projectId: 'f0cf8018-926b-4c87-a1b7-f82fc8db15cb',
    projectSource: 'carnet', order: t, subtasks: [], createdAt: t, updatedAt: t, ...patch,
  }
}

// Carnet borne la version qu'il accepte pour ÉCRIRE dans cockpit-data.json.
// Ce test est le rappel : toucher ce nombre oblige à prévenir Carnet, sans quoi
// son bouton « créer une tâche depuis un projet » cesse de fonctionner.
describe('interop Carnet : version du fichier partagé', () => {
  it('version courante de cockpit-data.json', () => {
    expect(SCHEMA_VERSION).toBe(8)
    expect(canonicalize(state()).version).toBe(8)
  })
})

describe('interop Carnet : champs dont Carnet dépend en lecture', () => {
  it('aucun champ lu par Carnet n’a disparu', () => {
    const c = canonicalize(state({ todos: [newTodo({ title: 'x', subtasks: [newSubtask({ title: 'sous' })] })] })).todos[0]
    for (const k of ['id', 'title', 'done', 'status', 'priority', 'dueDate', 'subtasks', 'projectId', 'projectSource', 'updatedAt']) {
      expect(c, `champ « ${k} » lu par Carnet`).toHaveProperty(k)
    }
    for (const k of ['id', 'title', 'done']) expect(c.subtasks[0]).toHaveProperty(k)
    const root = canonicalize(state())
    expect(root).toHaveProperty('version')
    expect(root).toHaveProperty('deleted')
  })

  // Carnet documente status comme 'todo'|'waiting'|'done'. Depuis la v5 on émet
  // aussi 'scheduled' : c'est une tâche ACTIVE (done:false), pas une terminée.
  it('« scheduled » est un statut actif, et done reste le drapeau sûr', () => {
    expect(TODO_STATUSES).toContain('scheduled')
    const sched = canonicalize(
      state({ todos: [newTodo({ title: 'x', status: 'scheduled', scheduled: { date: '2099-01-01', time: '', durationMinutes: 60 } })] }),
    ).todos[0]
    expect(sched.status).toBe('scheduled')
    expect(sched.done).toBe(false) // un filtre « !done » côté Carnet reste juste
  })

  it('les tombstones gardent leur forme { id, at, kind:"todo" }', () => {
    const st = freshStore([newTodo({ title: 'à supprimer' })])
    const id = st.getSnapshot().todos[0].id
    st.deleteTodo(id)
    const tomb = st.getSnapshot().deleted.find((d) => d.id === id)
    expect(tomb).toMatchObject({ id, kind: 'todo' })
    expect(typeof tomb.at).toBe('number')
  })
})

// L'ask explicite de Carnet : il pointe une sous-tâche via
// projects[].nextStepSubtaskId. Un id régénéré = pointeur mort chez lui.
describe('interop Carnet : les ids de sous-tâches sont STABLES', () => {
  it('renommer, cocher, réordonner et éditer le parent ne régénèrent aucun id', () => {
    const st = freshStore([newTodo({ title: 'parent' })])
    const id = st.getSnapshot().todos[0].id
    st.addSubtask(id, 'étape A')
    st.addSubtask(id, 'étape B')
    st.addSubtask(id, 'étape C')
    const initial = subIds(st, id)
    expect(new Set(initial).size).toBe(3)

    st.renameSubtask(id, initial[1], 'étape B renommée')
    expect(subIds(st, id)).toEqual(initial)

    st.toggleSubtask(id, initial[0])
    st.toggleSubtask(id, initial[0])
    expect(subIds(st, id)).toEqual(initial)

    st.reorderSubtasks(id, [initial[2], initial[0], initial[1]])
    expect(subIds(st, id).slice().sort()).toEqual(initial.slice().sort())

    st.updateTodo(id, { title: 'parent renommé', priority: 'haute' })
    st.toggleTodoDone(id)
    st.toggleTodoDone(id)
    st.scheduleTodo(id, { date: '2099-01-01', time: '10:00', durationMinutes: 30 })
    expect(subIds(st, id).slice().sort()).toEqual(initial.slice().sort())

    // Retirer une sous-tâche ne doit pas renuméroter les autres.
    st.removeSubtask(id, initial[0])
    expect(subIds(st, id).slice().sort()).toEqual(initial.slice(1).sort())
  })

  it('canonicalize et un aller-retour de fusion préservent les ids', () => {
    const sub = newSubtask({ title: 'étape' })
    const s = state({ todos: [newTodo({ title: 'p', subtasks: [sub] })] })
    expect(canonicalize(s).todos[0].subtasks[0].id).toBe(sub.id)
    expect(mergeStates(s, canonicalize(s)).todos[0].subtasks[0].id).toBe(sub.id)
  })

  it('en revanche, DUPLIQUER une tâche donne bien de nouveaux ids (c’est une copie)', () => {
    const st = freshStore([newTodo({ title: 'p' })])
    const id = st.getSnapshot().todos[0].id
    st.addSubtask(id, 'étape')
    const original = subIds(st, id)
    st.duplicateTodo(id)
    const copy = st.getSnapshot().todos.find((t) => t.id !== id)
    expect(copy.subtasks[0].id).not.toBe(original[0])
  })
})

describe('interop Carnet : écriture externe « ajout seul »', () => {
  it('la todo créée par Carnet survit à la fusion, avec des défauts sûrs', () => {
    const mine = newTodo({ title: 'ma tâche', status: 'scheduled', scheduled: { date: '2099-01-01', time: '', durationMinutes: 60 } })
    // Ce que Carnet réécrit : nos todos verbatim + la sienne concaténée.
    const fromCarnet = state({ todos: [mine, carnetTodo()] })
    const merged = mergeStates(state({ todos: [mine] }), fromCarnet)

    const added = merged.todos.find((t) => t.id === 'carnet-uuid-1')
    expect(added).toBeTruthy()
    expect(added.title).toBe('Contacter Williams pour exposer')
    expect(added.projectId).toBe('f0cf8018-926b-4c87-a1b7-f82fc8db15cb')
    // Champs v5+ absents chez Carnet : nos défauts doivent être INOFFENSIFS.
    expect(added.scheduled).toBe(null)
    expect(added.calendarSync).toBe('off') // surtout pas 'pending' : pas d'événement fantôme
    expect(added.estimateMinutes).toBe(null)
    // Et notre propre tâche n'a rien perdu.
    expect(merged.todos.find((t) => t.id === mine.id).scheduled).toEqual({ date: '2099-01-01', time: '', durationMinutes: 60 })
  })

  it('projectSource est conservé, pas effacé en silence', () => {
    const c = canonicalize(state({ todos: [carnetTodo()] })).todos[0]
    expect(c.projectSource).toBe('carnet')
    // Idempotent, et stable à travers une fusion (sinon Carnet le verrait
    // réapparaître/disparaître à chaque cycle de synchro).
    const once = canonicalize(state({ todos: [carnetTodo()] }))
    expect(canonicalize(once)).toEqual(once)
    expect(mergeStates(once, once)).toEqual(once)
    expect(canonicalize(state({ todos: [carnetTodo({ projectSource: undefined })] })).todos[0].projectSource).toBe(null)
  })

  it('l’ajout de Carnet ne ressuscite pas une tâche supprimée chez nous', () => {
    const dead = newTodo({ title: 'supprimée', updatedAt: 100 })
    const tomb = { id: dead.id, at: 200, kind: 'todo' }
    // Carnet relit un fichier frais : il verra la tombstone et ne renverra pas
    // la tâche. Mais même s'il le faisait (copie périmée), on doit tenir.
    const merged = mergeStates(
      state({ todos: [], deleted: [tomb] }),
      state({ todos: [dead, carnetTodo()], deleted: [tomb] }),
    )
    expect(merged.todos.map((t) => t.id)).toEqual(['carnet-uuid-1'])
  })

  it('la sérialisation reste stable après un aller-retour Carnet', () => {
    const s = state({ todos: [newTodo({ title: 'a' }), carnetTodo()] })
    expect(serialize(s)).toBe(serialize(canonicalize(s)))
  })
})
