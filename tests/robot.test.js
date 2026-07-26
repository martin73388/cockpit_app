// Le robot Apps Script (docs/robot-agenda-taches.gs) tourne chez Google, hors
// de portée de vitest. On l'exécute ici tel quel dans un `vm` Node avec des
// stubs Apps Script : c'est le seul filet possible sur du code que l'utilisateur
// copie-colle dans son script, et qui décide de ce qui entre dans son agenda.
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'

const SRC = fs.readFileSync(path.resolve(__dirname, '../docs/robot-agenda-taches.gs'), 'utf8')

const PROPERTY_LIMIT = 9216 // plafond réel d'une propriété de script Apps Script

function makeEnv(file, props = {}) {
  const cal = { events: new Map(), seq: 0 }
  const store = { file: JSON.stringify(file, null, 2), props: { ...props }, writes: 0 }
  const mkEvent = (title, desc) => {
    const id = 'ev' + ++cal.seq
    cal.events.set(id, { id, title, desc, deleted: false })
    return { getId: () => id }
  }
  const scriptProps = {
    getProperty: (k) => (k in store.props ? store.props[k] : null),
    setProperty: (k, v) => {
      if (v.length > PROPERTY_LIMIT) throw new Error('Argument too large: value')
      store.props[k] = v
    },
  }
  const sandbox = {
    Logger: { log: () => {} },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => scriptProps },
    CalendarApp: {
      getDefaultCalendar: () => ({
        createEvent: (t, s, e, o) => mkEvent(t, o && o.description),
        createAllDayEvent: (t, d, o) => mkEvent(t, o && o.description),
        getEventById: (id) => {
          const e = cal.events.get(id)
          return !e || e.deleted ? null : { deleteEvent: () => { e.deleted = true } }
        },
      }),
    },
    // Helpers fournis par la partie « passerelle » du script (déjà en place).
    findFile_: () => ({ getBlob: () => ({ getDataAsString: () => store.file }) }),
    writeTarget_: (name, content) => { store.writes++; store.file = content },
    props_: () => scriptProps,
  }
  vm.createContext(sandbox)
  vm.runInContext(SRC, sandbox)
  return { run: () => sandbox.syncTodos(), store, cal, read: () => JSON.parse(store.file) }
}

const mk = (o) => ({
  notes: '', done: false, doneAt: null, status: 'todo', waiting: null, scheduled: null, estimateMinutes: null,
  calendarEventId: null, calendarSync: 'off', focus: null, priority: 'normale', dueDate: '', projectId: null,
  subtasks: [], order: 1000, createdAt: 1, updatedAt: 1, ...o,
})
const file = (todos, deleted = []) => ({ app: 'cockpit', version: 6, todos, habits: [], inbox: [], deleted })
const FUTURE = { date: '2099-01-01', time: '10:00', durationMinutes: 45 }
const PAST = { date: '2020-01-01', time: '10:00', durationMinutes: 30 }
const pending = (o) => mk({ status: 'scheduled', scheduled: FUTURE, calendarSync: 'pending', ...o })

describe('robot agenda : parcours nominal', () => {
  let env
  beforeEach(() => {
    env = makeEnv(file([pending({ id: 'a', title: 'Devis' })]))
  })

  it('crée l’événement et referme le handshake', () => {
    env.run()
    const t = env.read().todos[0]
    expect(t.calendarSync).toBe('synced')
    expect(t.calendarEventId).toBeTruthy()
    expect(env.cal.events.get(t.calendarEventId).deleted).toBe(false)
    expect(JSON.parse(env.store.props.TODO_EVENTS)[t.id]).toBe(t.calendarEventId)
  })

  it('un second passage ne recrée rien (pas de doublon dans l’agenda)', () => {
    env.run()
    const before = env.store.file
    env.run()
    expect(env.store.file).toBe(before)
    expect(env.cal.events.size).toBe(1)
  })

  it('marque l’événement pour retrouver la tâche', () => {
    env.run()
    const t = env.read().todos[0]
    expect(env.cal.events.get(t.calendarEventId).desc).toContain('[cockpit-todo:a]')
  })

  it('ne touche jamais un fichier qui n’est pas un Cockpit', () => {
    const foreign = makeEnv({ app: 'autre-chose', todos: [pending({ id: 'a' })] })
    foreign.run()
    expect(foreign.store.writes).toBe(0)
    expect(foreign.cal.events.size).toBe(0)
  })
})

describe('robot agenda : complétion', () => {
  function complete(env) {
    const f = env.read()
    Object.assign(f.todos[0], { status: 'done', done: true, doneAt: Date.now(), calendarSync: 'pending' })
    env.store.file = JSON.stringify(f)
    env.run()
  }

  it('créneau à venir : l’événement est retiré', () => {
    const env = makeEnv(file([pending({ id: 'a' })]))
    env.run()
    const ev = env.read().todos[0].calendarEventId
    complete(env)
    expect(env.cal.events.get(ev).deleted).toBe(true)
    expect(env.read().todos[0].calendarSync).toBe('off')
    expect(env.read().todos[0].calendarEventId).toBe(null)
  })

  it('créneau déjà passé : l’événement est conservé comme trace', () => {
    const env = makeEnv(file([pending({ id: 'a', scheduled: PAST })]))
    env.run()
    const ev = env.read().todos[0].calendarEventId
    complete(env)
    expect(env.cal.events.get(ev).deleted).toBe(false)
    expect(env.read().todos[0].calendarEventId).toBe(ev)
  })
})

describe('robot agenda : nettoyage', () => {
  it('une tâche supprimée voit son événement retiré', () => {
    const env = makeEnv(file([pending({ id: 'a' })]))
    env.run()
    const ev = env.read().todos[0].calendarEventId
    env.store.file = JSON.stringify(file([], [{ id: 'a', at: Date.now(), kind: 'todo' }]))
    env.run()
    expect(env.cal.events.get(ev).deleted).toBe(true)
    expect(JSON.parse(env.store.props.TODO_EVENTS).a).toBeUndefined()
  })

  // Défaut confirmé par la revue : une propriété de script est plafonnée à
  // 9 ko. Sans élagage, le registre finissait par faire échouer setProperty —
  // et avec lui TOUTE la synchro agenda, silencieusement.
  it('un registre hérité saturé ne casse pas la synchro (élagage)', () => {
    const fat = {}
    for (let i = 0; i < 300; i++) {
      fat[`id-fantome-${String(i).padStart(4, '0')}-0123456789abcdef`] = `evenement-fantome-${i}@google.com`
    }
    expect(JSON.stringify(fat).length).toBeGreaterThan(PROPERTY_LIMIT)
    const env = makeEnv(file([pending({ id: 'a' })]), { TODO_EVENTS: JSON.stringify(fat) })
    expect(() => env.run()).not.toThrow()
    expect(Object.keys(JSON.parse(env.store.props.TODO_EVENTS))).toEqual(['a'])
    expect(env.read().todos[0].calendarSync).toBe('synced')
  })
})

// Défaut confirmé par la revue : calendarEventId n'est écrit que par le robot,
// mais la fusion reste un LWW objet entier — un appareil resté hors ligne peut
// faire reculer ce champ vers un événement déjà supprimé, laissant le vrai
// événement orphelin dans l'agenda pour toujours.
describe('robot agenda : réparation d’un lien périmé (LWW)', () => {
  it('le registre fait foi et répare, sans perdre l’édition de l’utilisateur', () => {
    const env = makeEnv(file([pending({ id: 'a', title: 'x' })]))
    env.run()
    const ev1 = env.read().todos[0].calendarEventId

    // Le créneau bouge : ev1 supprimé, ev2 créé.
    const moved = env.read()
    moved.todos[0].scheduled = { ...FUTURE, time: '16:00' }
    moved.todos[0].calendarSync = 'pending'
    env.store.file = JSON.stringify(moved)
    env.run()
    const ev2 = env.read().todos[0].calendarEventId
    expect(ev2).not.toBe(ev1)
    expect(env.cal.events.get(ev1).deleted).toBe(true)

    // Un appareil hors ligne revient, gagne le LWW, et ramène ev1 périmé.
    const stale = env.read()
    stale.todos[0].calendarEventId = ev1
    stale.todos[0].title = 'x renommée hors ligne'
    env.store.file = JSON.stringify(stale)
    env.run()

    const t = env.read().todos[0]
    expect(t.calendarEventId).toBe(ev2) // réparé
    expect(env.cal.events.get(ev2).deleted).toBe(false) // pas d'orphelin
    expect(t.title).toBe('x renommée hors ligne') // édition préservée
  })

  it('ne ressuscite pas un lien mort sur une tâche déplanifiée', () => {
    const env = makeEnv(
      file([mk({ id: 'a', title: 'x', calendarSync: 'off', calendarEventId: null })]),
      { TODO_EVENTS: JSON.stringify({ a: 'ev-mort' }) },
    )
    env.run()
    expect(env.read().todos[0].calendarEventId).toBe(null)
    expect(JSON.parse(env.store.props.TODO_EVENTS).a).toBeUndefined()
  })
})
