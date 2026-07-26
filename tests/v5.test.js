import { describe, it, expect } from 'vitest'
import { canonicalize, mergeStates, serialize } from '../src/sync/merge.js'
import { createStore } from '../src/data/store.js'
import { newTodo, APP, SCHEMA_VERSION, STATUS_FILTERS } from '../src/data/model.js'
import { visibleTodos, isSlotDue } from '../src/utils/todoView.js'
import { missedSlots, computeAlerts, stalledTodos } from '../src/utils/alerts.js'
import { slotLabel } from '../src/utils/dates.js'

function state(partial = {}) {
  return { app: APP, version: SCHEMA_VERSION, todos: [], habits: [], inbox: [], deleted: [], ...partial }
}
function freshStore(todos = []) {
  return createStore(canonicalize(state({ todos })))
}
const SLOT = { date: '2026-07-28', time: '14:00', durationMinutes: 60 }
// Créneaux ancrés loin dans le futur / le passé : les tests de réouverture
// dépendent de la date du jour, ils ne doivent pas pourrir avec le temps.
const FUTURE = { date: '2099-01-01', time: '10:00', durationMinutes: 30 }
const PAST = { date: '2020-01-01', time: '10:00', durationMinutes: 30 }

describe('v5 : modèle du créneau', () => {
  it('les tâches migrées v4 arrivent sans créneau et SANS réveiller le robot', () => {
    // Le piège : un défaut calendarSync 'pending' (comme les habitudes) ferait
    // créer un événement d'agenda pour chaque tâche existante.
    const legacy = { ...newTodo({ title: 'ancienne' }) }
    delete legacy.scheduled
    delete legacy.calendarSync
    delete legacy.calendarEventId
    const c = canonicalize(state({ todos: [legacy] })).todos[0]
    expect(c.scheduled).toBe(null)
    expect(c.calendarSync).toBe('off')
    expect(c.calendarEventId).toBe(null)
  })

  it('canonSlot valide date/heure/durée et rejette le douteux', () => {
    const ok = canonicalize(state({ todos: [newTodo({ title: 'a', status: 'scheduled', scheduled: SLOT })] })).todos[0]
    expect(ok.scheduled).toEqual(SLOT)
    expect(ok.status).toBe('scheduled')

    const badTime = newTodo({ title: 'b', status: 'scheduled', scheduled: { date: '2026-07-28', time: '25:99', durationMinutes: 0 } })
    const c = canonicalize(state({ todos: [badTime] })).todos[0]
    expect(c.scheduled).toEqual({ date: '2026-07-28', time: '', durationMinutes: 60 })

    // Piège d'idempotence : arrondir après le test de positivité donnerait 0
    // au premier passage puis 60 au second.
    const tiny = newTodo({ title: 'd', status: 'scheduled', scheduled: { date: '2026-07-28', time: '', durationMinutes: 0.3 } })
    const once = canonicalize(state({ todos: [tiny] }))
    expect(once.todos[0].scheduled.durationMinutes).toBe(60)
    expect(canonicalize(once)).toEqual(once)

    // Date invalide -> pas de créneau, donc le statut retombe « à faire ».
    const badDate = newTodo({ title: 'c', status: 'scheduled', scheduled: { date: 'demain' } })
    const d = canonicalize(state({ todos: [badDate] })).todos[0]
    expect(d.scheduled).toBe(null)
    expect(d.status).toBe('todo')
  })

  it('done coché prime sur scheduled mais le créneau reste (trace du quand)', () => {
    const t = newTodo({ title: 'x', done: true, status: 'scheduled', scheduled: SLOT })
    const c = canonicalize(state({ todos: [t] })).todos[0]
    expect(c.status).toBe('done')
    expect(c.scheduled).toEqual(SLOT)
  })

  it('canonicalize est idempotent et mergeStates(a,a) === canonicalize(a)', () => {
    const s = state({
      todos: [
        newTodo({ title: 'a', status: 'scheduled', scheduled: SLOT, calendarSync: 'synced', calendarEventId: 'evt1' }),
        newTodo({ title: 'b' }),
      ],
    })
    const once = canonicalize(s)
    expect(canonicalize(once)).toEqual(once)
    expect(mergeStates(s, s)).toEqual(once)
    expect(serialize(once)).toBe(serialize(canonicalize(once)))
  })

  it('fusion : LWW objet, commutatif, et le lien agenda du robot survit', () => {
    // Le robot écrit calendarEventId + 'synced' avec un updatedAt plus récent.
    const app = { ...newTodo({ title: 'x' }), id: 'X', updatedAt: 10, status: 'scheduled', scheduled: SLOT, calendarSync: 'pending' }
    const robot = { ...app, updatedAt: 20, calendarSync: 'synced', calendarEventId: 'evt-42' }
    const m = mergeStates(state({ todos: [app] }), state({ todos: [robot] }))
    expect(m.todos[0].calendarSync).toBe('synced')
    expect(m.todos[0].calendarEventId).toBe('evt-42')
    expect(mergeStates(state({ todos: [robot] }), state({ todos: [app] }))).toEqual(m)
  })

  it('version du fichier = SCHEMA_VERSION', () => {
    expect(canonicalize(state()).version).toBe(SCHEMA_VERSION)
    expect(SCHEMA_VERSION).toBe(5)
  })
})

describe('v5 : transitions du store', () => {
  it('planifier sort de À faire, demande l’agenda et clôt attente + focus', () => {
    const st = freshStore([newTodo({ title: 'a', focus: { date: '2026-07-25', count: 1 } })])
    const id = st.getSnapshot().todos[0].id
    st.setTodoWaiting(id, { note: 'réponse Jean' })
    st.scheduleTodo(id, { date: '2026-07-28', time: '14:00', durationMinutes: 60 })
    const t = st.getSnapshot().todos[0]
    expect(t.status).toBe('scheduled')
    expect(t.scheduled).toEqual(SLOT)
    expect(t.calendarSync).toBe('pending') // le robot a du travail
    expect(t.waiting).toBe(null)
    expect(t.focus).toBe(null) // le créneau remplace l'épingle du jour
  })

  it('replanifier au même créneau ne relance pas le robot', () => {
    const st = freshStore([newTodo({ title: 'a' })])
    const id = st.getSnapshot().todos[0].id
    st.scheduleTodo(id, SLOT)
    st.replaceState({ ...st.getSnapshot(), todos: st.getSnapshot().todos.map((x) => ({ ...x, calendarSync: 'synced', calendarEventId: 'evt' })) })
    st.scheduleTodo(id, SLOT) // même date/heure/durée
    expect(st.getSnapshot().todos[0].calendarSync).toBe('synced')
    st.scheduleTodo(id, { ...SLOT, time: '15:00' }) // vrai changement
    expect(st.getSnapshot().todos[0].calendarSync).toBe('pending')
  })

  it('déplanifier rend la tâche à faire et demande la suppression de l’événement', () => {
    const st = freshStore([newTodo({ title: 'a', status: 'scheduled', scheduled: SLOT, calendarSync: 'synced', calendarEventId: 'evt' })])
    const id = st.getSnapshot().todos[0].id
    st.unscheduleTodo(id)
    const t = st.getSnapshot().todos[0]
    expect(t.status).toBe('todo')
    expect(t.scheduled).toBe(null)
    expect(t.calendarSync).toBe('pending')
  })

  it('terminer une tâche planifiée réveille le robot ; rouvrir restaure un créneau encore valable', () => {
    const st = freshStore([newTodo({ title: 'a', status: 'scheduled', scheduled: FUTURE, calendarSync: 'synced', calendarEventId: 'evt' })])
    const id = st.getSnapshot().todos[0].id
    st.toggleTodoDone(id)
    let t = st.getSnapshot().todos[0]
    expect(t.status).toBe('done')
    expect(t.scheduled).toEqual(FUTURE) // le créneau reste : c'est la trace du quand
    expect(t.calendarSync).toBe('pending') // le robot tranche garder/supprimer
    st.toggleTodoDone(id)
    t = st.getSnapshot().todos[0]
    expect(t.status).toBe('scheduled') // rouvrir restaure le créneau
  })

  it('rouvrir une vieille tâche n’exhume pas un créneau périmé', () => {
    const st = freshStore([newTodo({ title: 'vieille', status: 'scheduled', scheduled: PAST, calendarSync: 'synced', calendarEventId: 'evt' })])
    const id = st.getSnapshot().todos[0].id
    st.toggleTodoDone(id)
    st.toggleTodoDone(id) // rouvre des mois plus tard
    const t = st.getSnapshot().todos[0]
    expect(t.status).toBe('todo') // pas « planifiée » sur une date morte
    expect(t.scheduled).toBe(null) // ni événement antidaté, ni alerte perpétuelle
  })

  it('reconfirmer le même créneau répare un lien agenda manquant', () => {
    const st = freshStore([newTodo({ title: 'a', status: 'scheduled', scheduled: SLOT, calendarSync: 'off', calendarEventId: null })])
    const id = st.getSnapshot().todos[0].id
    st.scheduleTodo(id, SLOT) // rigoureusement identique
    expect(st.getSnapshot().todos[0].calendarSync).toBe('pending')
  })

  it('terminer une tâche ORDINAIRE ne réveille jamais le robot', () => {
    const st = freshStore([newTodo({ title: 'sans créneau' })])
    const id = st.getSnapshot().todos[0].id
    st.toggleTodoDone(id)
    expect(st.getSnapshot().todos[0].calendarSync).toBe('off')
  })

  it('décocher une sous-tâche rouvre le parent sur son créneau ET l’agenda', () => {
    const st = freshStore([newTodo({ title: 'p', scheduled: FUTURE, status: 'scheduled' })])
    const id = st.getSnapshot().todos[0].id
    st.addSubtask(id, 'une étape')
    st.toggleTodoDone(id) // termine tout
    // Le robot a fait son travail : événement retiré, tâche « off ».
    st.replaceState({
      ...st.getSnapshot(),
      todos: st.getSnapshot().todos.map((x) => ({ ...x, calendarSync: 'off', calendarEventId: null })),
    })
    const subId = st.getSnapshot().todos[0].subtasks[0].id
    st.toggleSubtask(id, subId) // décoche -> rouvre le parent
    const t = st.getSnapshot().todos[0]
    expect(t.status).toBe('scheduled')
    // Sans ceci, le créneau existerait sans rien dans l'agenda.
    expect(t.calendarSync).toBe('pending')
  })

  it('mettre en attente une tâche planifiée libère le créneau (pas d’événement orphelin)', () => {
    const st = freshStore([newTodo({ title: 'a', status: 'scheduled', scheduled: SLOT, calendarSync: 'synced', calendarEventId: 'evt' })])
    const id = st.getSnapshot().todos[0].id
    st.setTodoWaiting(id, { note: 'réponse du client' })
    const t = st.getSnapshot().todos[0]
    expect(t.status).toBe('waiting')
    expect(t.scheduled).toBe(null) // on ne peut plus le faire à l'heure dite
    expect(t.calendarSync).toBe('pending') // le robot retire l'événement
  })

  it('rolloverFocus ignore les tâches planifiées et en attente', () => {
    const sched = newTodo({ title: 'planifiée', status: 'scheduled', scheduled: SLOT, focus: { date: '2026-07-24', count: 0 } })
    const wait = newTodo({ title: 'attente', status: 'waiting', waiting: { note: 'x', since: 1, followUpDate: '' }, focus: { date: '2026-07-24', count: 0 } })
    const st = freshStore([sched, wait])
    st.rolloverFocus('2026-07-25')
    for (const t of st.getSnapshot().todos) expect(t.focus.date).toBe('2026-07-24') // inchangé
  })
})

describe('v5 : vues et filets anti-oubli', () => {
  const today = '2026-07-28'
  const future = newTodo({ title: 'futur', status: 'scheduled', scheduled: { date: '2026-08-10', time: '', durationMinutes: 60 } })
  const dueNow = newTodo({ title: 'aujourdhui', status: 'scheduled', scheduled: SLOT })
  const missed = newTodo({ title: 'raté', status: 'scheduled', scheduled: { date: '2026-07-20', time: '09:00', durationMinutes: 30 } })
  const plain = newTodo({ title: 'ordinaire' })
  const all = [future, dueNow, missed, plain]

  it('« À faire » masque les créneaux à venir mais récupère ceux qui sont échus', () => {
    const shown = visibleTodos(all, { status: 'todo', sort: 'created' }, () => '', today).map((t) => t.title)
    expect(shown).toContain('ordinaire')
    expect(shown).toContain('aujourdhui') // le jour J, elle revient
    expect(shown).toContain('raté') // créneau manqué : elle revient aussi
    expect(shown).not.toContain('futur') // c'est tout l'intérêt : la liste se vide
  })

  it('le filtre « Planifiées » montre tous les créneaux', () => {
    const shown = visibleTodos(all, { status: 'scheduled', sort: 'created' }, () => '', today).map((t) => t.title)
    expect(shown.sort()).toEqual(['aujourdhui', 'futur', 'raté'])
    expect(STATUS_FILTERS).toContain('scheduled')
  })

  it('isSlotDue distingue échu et à venir', () => {
    expect(isSlotDue(dueNow, today)).toBe(true)
    expect(isSlotDue(missed, today)).toBe(true)
    expect(isSlotDue(future, today)).toBe(false)
    expect(isSlotDue(plain, today)).toBe(false)
  })

  it('un créneau passé sans validation remonte en alerte', () => {
    const items = missedSlots(all, today)
    expect(items).toHaveLength(1)
    expect(items[0].label).toContain('raté')
    expect(items[0].label).toContain('2026-07-20')
  })

  it('une tâche planifiée n’est jamais « en panne » (elle a un créneau)', () => {
    const old = Date.now() - 30 * 86400000
    const stale = { ...newTodo({ title: 'planifiée' }), status: 'scheduled', scheduled: SLOT, updatedAt: old }
    expect(stalledTodos([stale])).toHaveLength(0)
    const groups = computeAlerts(null, today, Date.now(), all)
    expect(groups.find((g) => g.source === 'Cockpit').items.map((i) => i.kind)).toContain('creneau')
  })

  it('slotLabel lit comme une phrase', () => {
    expect(slotLabel({ date: today, time: '14:00' }, today)).toBe("Aujourd'hui 14:00")
    expect(slotLabel({ date: '2026-07-29', time: '' }, today)).toBe('Demain')
    expect(slotLabel(null, today)).toBe('')
  })
})
