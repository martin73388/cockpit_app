import { describe, it, expect } from 'vitest'
import { mergeStates, canonicalize, serialize } from '../src/sync/merge.js'
import { scheduledOn, describeSchedule, mondayOf, addDaysISO } from '../src/utils/recurrence.js'
import { briefStatus, isBriefFile } from '../src/sync/brief.js'
import { carnetAlerts, radarAlerts, computeAlerts } from '../src/utils/alerts.js'
import { APP, SCHEMA_VERSION } from '../src/data/model.js'

function habit(id, updatedAt, extra = {}) {
  return {
    id,
    title: id,
    notes: '',
    active: true,
    schedule: { frequency: 'daily', daysOfWeek: [], time: '', durationMinutes: 30, anchorDate: '' },
    completions: [],
    pillar: null,
    calendarEventId: null,
    calendarSync: 'pending',
    createdAt: 1,
    updatedAt,
    ...extra,
  }
}
function inboxItem(id, createdAt, extra = {}) {
  return { id, text: id, createdAt, processedAt: null, processedNote: '', updatedAt: createdAt, ...extra }
}
function state(partial = {}) {
  return { app: APP, version: 2, todos: [], habits: [], inbox: [], deleted: [], ...partial }
}

// 2026-07-20 is a Monday.
const MON = '2026-07-20'

describe('scheduledOn', () => {
  it('daily: every day', () => {
    const h = habit('h', 1)
    expect(scheduledOn(h, MON)).toBe(true)
    expect(scheduledOn(h, '2026-07-26')).toBe(true)
  })

  it('weekly: only listed days', () => {
    const h = habit('h', 1, { schedule: { frequency: 'weekly', daysOfWeek: ['MO', 'FR'], time: '', durationMinutes: 30, anchorDate: '' } })
    expect(scheduledOn(h, MON)).toBe(true) // lundi
    expect(scheduledOn(h, '2026-07-21')).toBe(false) // mardi
    expect(scheduledOn(h, '2026-07-24')).toBe(true) // vendredi
  })

  it('biweekly: anchor week is ON, next week OFF, week after ON', () => {
    const sched = { frequency: 'biweekly', daysOfWeek: ['WE'], time: '', durationMinutes: 30, anchorDate: '2026-07-22' } // mercredi
    const h = habit('h', 1, { schedule: sched })
    expect(scheduledOn(h, '2026-07-22')).toBe(true) // anchor Wednesday
    expect(scheduledOn(h, '2026-07-29')).toBe(false) // next week
    expect(scheduledOn(h, '2026-08-05')).toBe(true) // week after
    expect(scheduledOn(h, '2026-07-23')).toBe(false) // thursday of anchor week: not in daysOfWeek
  })

  it('biweekly: anchor day elsewhere in the week anchors the WEEK parity, but never before the anchor', () => {
    // anchor is Friday 2026-07-24: Wednesday of the SAME week (07-22) is BEFORE
    // the anchor -> not scheduled (« à partir du ») ; parity resumes after.
    const sched = { frequency: 'biweekly', daysOfWeek: ['WE'], time: '', durationMinutes: 30, anchorDate: '2026-07-24' }
    const h = habit('h', 1, { schedule: sched })
    expect(scheduledOn(h, '2026-07-22')).toBe(false) // before the anchor date
    expect(scheduledOn(h, '2026-07-29')).toBe(false) // off-parity week
    expect(scheduledOn(h, '2026-08-05')).toBe(true) // same-parity week after the anchor
  })

  it('biweekly parity is stable across a DST transition (Europe: end of Oct)', () => {
    // Anchor Wed 2026-10-21; DST fall-back happens Sun 2026-10-25 in Europe.
    const sched = { frequency: 'biweekly', daysOfWeek: ['WE'], time: '', durationMinutes: 30, anchorDate: '2026-10-21' }
    const h = habit('h', 1, { schedule: sched })
    expect(scheduledOn(h, '2026-10-21')).toBe(true)
    expect(scheduledOn(h, '2026-10-28')).toBe(false) // week crossing the DST change
    expect(scheduledOn(h, '2026-11-04')).toBe(true)
    expect(scheduledOn(h, '2026-11-11')).toBe(false)
  })

  it('week helpers: mondayOf / addDaysISO behave at week and month edges', () => {
    expect(mondayOf('2026-07-26')).toBe(MON) // sunday -> its monday
    expect(mondayOf(MON)).toBe(MON)
    expect(addDaysISO('2026-07-31', 1)).toBe('2026-08-01')
  })

  it('paused/absent day lists never schedule weekly/biweekly', () => {
    const h = habit('h', 1, { schedule: { frequency: 'weekly', daysOfWeek: [], time: '', durationMinutes: 30, anchorDate: '' } })
    expect(scheduledOn(h, MON)).toBe(false)
  })
})

describe('describeSchedule (v2)', () => {
  it('biweekly single day with time and anchor', () => {
    expect(
      describeSchedule({ frequency: 'biweekly', daysOfWeek: ['WE'], time: '20:00', durationMinutes: 0, anchorDate: '2026-07-29' }),
    ).toBe('Un mercredi sur deux à 20h00 (à partir du 29/07)')
  })
  it('biweekly multiple days', () => {
    expect(
      describeSchedule({ frequency: 'biweekly', daysOfWeek: ['MO', 'TH'], time: '', durationMinutes: 30, anchorDate: '2026-07-20' }),
    ).toBe('Lun, Jeu, une semaine sur deux · 30 min (à partir du 20/07)')
  })
})

describe('migration v1 -> v2', () => {
  const v1 = {
    app: APP,
    version: 1,
    todos: [],
    habits: [
      {
        id: 'h1', title: 'Méditation', notes: '', active: true,
        schedule: { frequency: 'weekly', daysOfWeek: ['TU'], time: '20:00', durationMinutes: 30 },
        calendarEventId: 'evt1', calendarSync: 'synced', createdAt: 1, updatedAt: 2,
      },
    ],
    deleted: [{ id: 'x', at: 5, kind: 'todo' }],
  }

  it('adds defaults and rewrites version to current schema', () => {
    const m = canonicalize(v1)
    expect(m.version).toBe(SCHEMA_VERSION)
    expect(m.inbox).toEqual([])
    expect(m.habits[0].completions).toEqual([])
    expect(m.habits[0].pillar).toBe(null)
    expect(m.habits[0].schedule.anchorDate).toBe('')
    // untouched fields survive
    expect(m.habits[0].calendarEventId).toBe('evt1')
    expect(m.habits[0].calendarSync).toBe('synced')
    expect(m.deleted).toEqual([{ id: 'x', at: 5, kind: 'todo' }])
  })

  it('is idempotent', () => {
    const once = canonicalize(v1)
    expect(canonicalize(once)).toEqual(once)
    expect(serialize(once)).toBe(serialize(canonicalize(once)))
  })
})

describe('merge: completions union', () => {
  it('unions dates even when LWW picks the other side, updatedAt = max', () => {
    const a = state({ habits: [habit('h1', 10, { title: 'nouveau titre', completions: ['2026-07-20'] })] })
    const b = state({ habits: [habit('h1', 5, { title: 'vieux titre', completions: ['2026-07-21', '2026-07-19'] })] })
    const m = mergeStates(a, b)
    expect(m.habits[0].title).toBe('nouveau titre') // LWW fields from newer
    expect(m.habits[0].completions).toEqual(['2026-07-19', '2026-07-20', '2026-07-21']) // union, sorted
    expect(m.habits[0].updatedAt).toBe(10)
  })

  it('is commutative and idempotent', () => {
    const a = state({ habits: [habit('h1', 10, { completions: ['2026-07-20'] })] })
    const b = state({ habits: [habit('h1', 5, { completions: ['2026-07-21'] })] })
    expect(mergeStates(a, b)).toEqual(mergeStates(b, a))
    const m = mergeStates(a, b)
    expect(mergeStates(m, m)).toEqual(m)
    // re-merging against an original side must not lose the union
    expect(mergeStates(m, a).habits[0].completions).toEqual(['2026-07-20', '2026-07-21'])
    expect(mergeStates(m, b).habits[0].completions).toEqual(['2026-07-20', '2026-07-21'])
  })

  it('drops malformed dates and dedupes', () => {
    const a = state({ habits: [habit('h1', 5, { completions: ['2026-07-20', 'garbage', '2026-07-20'] })] })
    expect(canonicalize(a).habits[0].completions).toEqual(['2026-07-20'])
  })
})

describe('merge: inbox', () => {
  it('unions items by id, LWW per item', () => {
    const a = state({ inbox: [inboxItem('i1', 1), inboxItem('i2', 2)] })
    const processed = { ...inboxItem('i1', 1), processedAt: 9, processedNote: 'Converti en todo', updatedAt: 9 }
    const b = state({ inbox: [processed] })
    const m = mergeStates(a, b)
    expect(m.inbox.map((i) => i.id)).toEqual(['i1', 'i2'])
    expect(m.inbox[0].processedNote).toBe('Converti en todo') // newer wins
  })

  it('tombstones (kind inbox) suppress items and prevent resurrection', () => {
    const a = state({ inbox: [inboxItem('i1', 1)] })
    const b = state({ deleted: [{ id: 'i1', at: 10, kind: 'inbox' }] })
    const m = mergeStates(a, b)
    expect(m.inbox).toEqual([])
    expect(m.deleted).toEqual([{ id: 'i1', at: 10, kind: 'inbox' }])
    expect(mergeStates(m, a).inbox).toEqual([]) // old copy re-merged: stays dead
  })

  it('canonical order: inbox sorted by createdAt then id; identical devices -> identical bytes', () => {
    const a = state({ inbox: [inboxItem('b', 2), inboxItem('a', 1)] })
    const b = state({ inbox: [inboxItem('a', 1), inboxItem('b', 2)] })
    expect(serialize(a)).toBe(serialize(b))
    expect(canonicalize(a).inbox.map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('brief states', () => {
  it('ok when dated today', () => {
    const r = briefStatus({ date: '2026-07-23', headline: 'x' }, '2026-07-23')
    expect(r.status).toBe('ok')
  })
  it('stale when dated another day', () => {
    expect(briefStatus({ date: '2026-07-22' }, '2026-07-23').status).toBe('stale')
  })
  it('missing when absent', () => {
    expect(briefStatus(null).status).toBe('missing')
  })
  it('foreign or unreadable file is not a brief', () => {
    expect(isBriefFile({ app: 'cockpit' })).toBe(false)
    expect(isBriefFile(null)).toBe(false)
    expect(isBriefFile({ app: 'cockpit-brief' })).toBe(true)
  })
})

describe('alerts', () => {
  const today = '2026-07-23'
  const now = new Date('2026-07-23T12:00:00Z').getTime()

  it('carnet: blocked, sleeping, due soon — but never for terminated projects', () => {
    const carnet = {
      available: true,
      projects: [
        { id: '1', name: 'Bloqué', status: 'en_cours', blocker: 'attente devis', dueDate: '', updatedAt: now },
        { id: '2', name: 'Dormant', status: 'en_cours', blocker: '', dueDate: '', updatedAt: now - 25 * 86400000 },
        { id: '3', name: 'Pressé', status: 'en_cours', blocker: '', dueDate: '2026-07-28', updatedAt: now },
        { id: '4', name: 'Lointain', status: 'en_cours', blocker: '', dueDate: '2026-09-01', updatedAt: now },
        { id: '5', name: 'Fini', status: 'termine', blocker: 'x', dueDate: '2026-07-24', updatedAt: 1 },
      ],
    }
    const out = carnetAlerts(carnet, today, now)
    const kinds = out.map((a) => a.kind).sort()
    expect(kinds).toEqual(['bloque', 'echeance', 'sommeil'])
    expect(out.find((a) => a.label.includes('Fini'))).toBeUndefined()
    expect(out.find((a) => a.label.includes('Lointain'))).toBeUndefined()
  })

  it('radar: overdue follow-up and priority never contacted', () => {
    const radar = {
      available: true,
      companies: [
        { id: 'c1', name: 'ACME', priority: true, status: 'to_contact' },
        { id: 'c2', name: 'Beta', priority: false, status: 'to_contact' },
        { id: 'c3', name: 'Gamma', priority: true, status: 'contacted' },
      ],
      contacts: [
        { id: 'p1', name: 'Alice', nextFollowUp: '2026-07-20' },
        { id: 'p2', name: 'Bob', nextFollowUp: '2026-08-01' },
        { id: 'p3', name: 'Chloé', nextFollowUp: null },
      ],
    }
    const out = radarAlerts(radar, today)
    expect(out.map((a) => a.kind).sort()).toEqual(['prioritaire', 'relance'])
    expect(out.find((a) => a.label.includes('Alice'))).toBeTruthy()
    expect(out.find((a) => a.label.includes('Bob'))).toBeUndefined()
  })

  it('unavailable source -> items === null (section hidden, never an error)', () => {
    const groups = computeAlerts({ radar: { available: false, companies: [], contacts: [] }, carnet: { available: true, projects: [] } }, today, now)
    expect(groups.find((g) => g.source === 'Radar').items).toBe(null)
    expect(groups.find((g) => g.source === 'Carnet').items).toEqual([])
  })
})

// ---- Régressions de la revue adverse v2 ----

import { computePillarWeek } from '../src/utils/pillars.js'
import { newInboxItem, newHabit } from '../src/data/model.js'

describe('completions CRDT (checks) — un-check durable', () => {
  it("un-check plus récent gagne sur une copie distante qui a encore la date", () => {
    // local: user un-checked 07-22 at t=100 ; remote: previous push with the date (t=50)
    const local = state({
      habits: [habit('h1', 100, { completions: [], checks: { '2026-07-22': { on: false, at: 100 } } })],
    })
    const remote = state({ habits: [habit('h1', 50, { completions: ['2026-07-22'] })] })
    const m1 = mergeStates(local, remote)
    expect(m1.habits[0].completions).toEqual([]) // un-check sticks
    expect(mergeStates(m1, remote).habits[0].completions).toEqual([]) // and keeps sticking
    expect(mergeStates(local, remote)).toEqual(mergeStates(remote, local)) // commutative
  })

  it('une coche faite sur un autre appareil est toujours conservée (garantie spec)', () => {
    const a = state({ habits: [habit('h1', 10, { title: 'edit', completions: [] })] })
    const b = state({ habits: [habit('h1', 5, { completions: ['2026-07-21'] })] }) // legacy, no checks
    const m = mergeStates(a, b)
    expect(m.habits[0].completions).toEqual(['2026-07-21'])
    expect(m.habits[0].title).toBe('edit')
  })

  it('re-coche après un un-check : le plus récent gagne, dans les deux sens', () => {
    const unchecked = state({ habits: [habit('h1', 100, { checks: { '2026-07-22': { on: false, at: 100 } } })] })
    const rechecked = state({ habits: [habit('h1', 200, { checks: { '2026-07-22': { on: true, at: 200 } } })] })
    expect(mergeStates(unchecked, rechecked).habits[0].completions).toEqual(['2026-07-22'])
    const unchecked2 = state({ habits: [habit('h1', 300, { checks: { '2026-07-22': { on: false, at: 300 } } })] })
    expect(mergeStates(rechecked, unchecked2).habits[0].completions).toEqual([])
  })

  it('migration : completions v1 sans checks sont ensemencées et dérivées à l’identique', () => {
    const v1ish = state({ habits: [habit('h1', 7, { completions: ['2026-07-20', '2026-07-21'] })] })
    const c = canonicalize(v1ish)
    expect(c.habits[0].completions).toEqual(['2026-07-20', '2026-07-21'])
    expect(c.habits[0].checks['2026-07-20']).toEqual({ on: true, at: 7 })
    expect(canonicalize(c)).toEqual(c) // idempotent
  })
})

describe('canonicalize === mergeStates(a, a), même avec conflit tombstone interne', () => {
  it('supprime les items enterrés et purge les tombstones périmés, comme mergeStates', () => {
    const a = state({
      inbox: [{ id: 'i1', text: 'x', createdAt: 100 }], // no updatedAt (raw legacy shape)
      deleted: [{ id: 'i1', at: 50, kind: 'inbox' }],
    })
    expect(mergeStates(a, a)).toEqual(canonicalize(a))
  })
  it('newInboxItem porte un updatedAt (LWW immédiat)', () => {
    const i = newInboxItem('test')
    expect(typeof i.updatedAt).toBe('number')
    expect(i.updatedAt).toBeGreaterThan(0)
  })
  it('newHabit initialise checks', () => {
    expect(newHabit().checks).toEqual({})
  })
})

describe('biweekly : jamais planifié avant son anchorDate (« à partir du »)', () => {
  it('les semaines de même parité AVANT l’ancre ne sont pas planifiées', () => {
    const sched = { frequency: 'biweekly', daysOfWeek: ['WE'], time: '', durationMinutes: 30, anchorDate: '2026-08-05' }
    const h = habit('h', 1, { schedule: sched })
    expect(scheduledOn(h, '2026-07-22')).toBe(false) // même parité mais avant l'ancre
    expect(scheduledOn(h, '2026-08-05')).toBe(true)
    expect(scheduledOn(h, '2026-08-19')).toBe(true)
  })
})

describe('piliers : seules les occurrences planifiées comptent comme faites', () => {
  // semaine du lundi 2026-07-20
  it('une complétion hors-planning ne masque pas une occurrence manquée', () => {
    const h = habit('h1', 1, {
      pillar: 'sport',
      schedule: { frequency: 'weekly', daysOfWeek: ['SU'], time: '', durationMinutes: 30, anchorDate: '' },
      completions: ['2026-07-21'], // mardi : hors planning
    })
    const [card] = computePillarWeek([h], '2026-07-23')
    expect(card).toEqual({ pillar: 'sport', planned: 1, done: 0, remaining: 1 }) // pas « À jour »
  })
  it('planifié ∧ fait compte, les habitudes en pause sont ignorées', () => {
    const done = habit('h1', 1, {
      pillar: 'sommeil',
      schedule: { frequency: 'weekly', daysOfWeek: ['MO'], time: '', durationMinutes: 30, anchorDate: '' },
      completions: ['2026-07-20'],
    })
    const paused = habit('h2', 1, { pillar: 'sommeil', active: false })
    const [card] = computePillarWeek([done, paused], '2026-07-23')
    expect(card).toEqual({ pillar: 'sommeil', planned: 1, done: 1, remaining: 0 })
  })
})
