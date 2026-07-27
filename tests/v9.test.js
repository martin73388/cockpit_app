// v9 — Créneaux (ex-habitudes), piliers redéfinis, mini-planning de travail,
// agenda du jour déposé par le robot.
import { describe, it, expect } from 'vitest'
import { canonicalize } from '../src/sync/merge.js'
import { newHabit, newTodo, APP, SCHEMA_VERSION, PILLARS, WORK_PILLAR } from '../src/data/model.js'
import { workSlots, toMinutes, fromMinutes } from '../src/utils/slots.js'
import { canonAgenda, agendaForToday, isAgendaFile } from '../src/sync/agenda.js'

function state(partial = {}) {
  return { app: APP, version: SCHEMA_VERSION, todos: [], habits: [], inbox: [], deleted: [], ...partial }
}
// Mercredi 2026-07-29.
const WED = '2026-07-29'
const workHabit = (patch = {}) =>
  newHabit({
    title: 'Créneau de travail projet',
    pillar: WORK_PILLAR,
    schedule: { frequency: 'weekly', daysOfWeek: ['WE'], time: '19:00', durationMinutes: 120, anchorDate: '' },
    ...patch,
  })
const scheduledTodo = (time, mins, date = WED) =>
  newTodo({ title: `t${time}`, status: 'scheduled', scheduled: { date, time, durationMinutes: mins } })

describe('v9 : piliers redéfinis', () => {
  it('la nouvelle liste est en place et « travail » en fait partie', () => {
    expect(PILLARS).toEqual(['travail', 'famille', 'ami', 'argent', 'sport', 'maison'])
    expect(PILLARS).toContain(WORK_PILLAR)
    expect(SCHEMA_VERSION).toBe(8)
  })

  it('un ancien pilier retombe à null au lieu de rester fantôme', () => {
    for (const old of ['sommeil', 'couple', 'proches', 'repas']) {
      const h = canonicalize(state({ habits: [newHabit({ title: 'x', pillar: old })] })).habits[0]
      expect(h.pillar, `ancien pilier « ${old} »`).toBe(null)
    }
    // Et un pilier valide survit.
    expect(canonicalize(state({ habits: [newHabit({ pillar: 'maison' })] })).habits[0].pillar).toBe('maison')
  })
})

describe('v9 : mini-planning des créneaux de travail', () => {
  it('convertit les heures dans les deux sens', () => {
    expect(toMinutes('19:00')).toBe(1140)
    expect(toMinutes('09:30')).toBe(570)
    expect(toMinutes('25:00')).toBe(null)
    expect(toMinutes('')).toBe(null)
    expect(fromMinutes(1140)).toBe('19:00')
    expect(fromMinutes(1185)).toBe('19:45')
  })

  it('un créneau vide est entièrement libre', () => {
    const [s] = workSlots(canonicalize(state({ habits: [workHabit()] })).habits, [], WED, 7)
    expect(s.date).toBe(WED)
    expect(s.time).toBe('19:00')
    expect(s.durationMinutes).toBe(120)
    expect(s.used).toBe(0)
    expect(s.free).toBe(120)
    expect(s.nextStart).toBe('19:00')
    expect(s.tasks).toBe(0)
  })

  it('les tâches posées dedans le remplissent, et la suivante s’enchaîne', () => {
    const habits = canonicalize(state({ habits: [workHabit()] })).habits
    const todos = canonicalize(state({ todos: [scheduledTodo('19:00', 45), scheduledTodo('19:45', 30)] })).todos
    const [s] = workSlots(habits, todos, WED, 7)
    expect(s.used).toBe(75)
    expect(s.free).toBe(45)
    expect(s.nextStart).toBe('20:15') // 19:00 + 75 min
    expect(s.tasks).toBe(2)
  })

  it('une tâche hors de la fenêtre n’est pas comptée', () => {
    const habits = canonicalize(state({ habits: [workHabit()] })).habits
    const dehors = canonicalize(
      state({ todos: [scheduledTodo('18:00', 60), scheduledTodo('21:00', 60), scheduledTodo('19:00', 60, '2026-07-30')] }),
    ).todos
    const [s] = workSlots(habits, dehors, WED, 7)
    expect(s.used).toBe(0)
    expect(s.free).toBe(120)
  })

  it('un créneau saturé affiche 0 libre, sans jamais passer en négatif', () => {
    const habits = canonicalize(state({ habits: [workHabit()] })).habits
    const todos = canonicalize(state({ todos: [scheduledTodo('19:00', 180)] })).todos
    const [s] = workSlots(habits, todos, WED, 7)
    expect(s.used).toBe(180)
    expect(s.free).toBe(0)
    expect(s.nextStart).toBe('21:00') // borné à la fin du créneau
  })

  it('à défaut de durée réservée, l’estimation de la tâche fait foi', () => {
    const habits = canonicalize(state({ habits: [workHabit()] })).habits
    const t = canonicalize(
      state({ todos: [newTodo({ title: 'x', status: 'scheduled', estimateMinutes: 90, scheduled: { date: WED, time: '19:00', durationMinutes: 90 } })] }),
    ).todos
    expect(workSlots(habits, t, WED, 7)[0].used).toBe(90)
  })

  it('ne retient que les créneaux de TRAVAIL, actifs et horodatés', () => {
    const habits = canonicalize(
      state({
        habits: [
          workHabit({ title: 'sport', pillar: 'sport' }), // autre pilier
          workHabit({ title: 'en pause', active: false }), // inactif
          workHabit({
            title: 'sans heure',
            schedule: { frequency: 'weekly', daysOfWeek: ['WE'], time: '', durationMinutes: 120, anchorDate: '' },
          }),
          workHabit({ title: 'le bon' }),
        ],
      }),
    ).habits
    const slots = workSlots(habits, [], WED, 7)
    expect(slots.map((s) => s.title)).toEqual(['le bon'])
  })

  it('couvre bien la semaine et trie par date puis heure', () => {
    const habits = canonicalize(
      state({
        habits: [
          workHabit({ title: 'mer soir' }),
          workHabit({
            title: 'mer matin',
            schedule: { frequency: 'weekly', daysOfWeek: ['WE'], time: '09:00', durationMinutes: 60, anchorDate: '' },
          }),
          workHabit({
            title: 'ven',
            schedule: { frequency: 'weekly', daysOfWeek: ['FR'], time: '10:00', durationMinutes: 60, anchorDate: '' },
          }),
        ],
      }),
    ).habits
    const slots = workSlots(habits, [], WED, 7)
    expect(slots.map((s) => `${s.date} ${s.time}`)).toEqual([
      '2026-07-29 09:00',
      '2026-07-29 19:00',
      '2026-07-31 10:00',
    ])
  })
})

describe('v9 : agenda du jour', () => {
  const raw = {
    app: 'cockpit-agenda',
    date: WED,
    generatedAt: 1,
    events: [
      { time: '19:00', title: 'Créneau de travail projet', allDay: false },
      { time: '', title: 'Vacances', allDay: true },
      { time: '09:00', title: 'Point équipe' },
      { time: 'nawak', title: 'Heure illisible' },
      { time: '10:00', title: '   ' }, // titre vide : rejeté
      { title: 'Sans champ time' },
    ],
  }

  it('reconnaît le fichier et rejette tout le reste', () => {
    expect(isAgendaFile(raw)).toBe(true)
    expect(isAgendaFile({ app: 'cockpit' })).toBe(false)
    expect(isAgendaFile(null)).toBe(false)
  })

  it('trie journée entière en tête puis par heure, et jette les entrées vides', () => {
    const a = canonAgenda(raw)
    expect(a.events.map((e) => e.title)).toEqual([
      'Vacances',
      'Heure illisible',
      'Sans champ time',
      'Point équipe',
      'Créneau de travail projet',
    ])
    // Une heure illisible devient « journée entière » plutôt qu'une heure fausse.
    expect(a.events.find((e) => e.title === 'Heure illisible')).toMatchObject({ time: '', allDay: true })
  })

  it('un agenda d’hier n’est jamais présenté comme celui du jour', () => {
    expect(agendaForToday(canonAgenda(raw), WED)).toBeTruthy()
    expect(agendaForToday(canonAgenda(raw), '2026-07-30')).toBe(null)
    expect(agendaForToday(null, WED)).toBe(null)
  })

  it('canonAgenda est idempotent', () => {
    const once = canonAgenda(raw)
    expect(canonAgenda(once)).toEqual(once)
  })
})

describe('v10 : durées pour la timeline', () => {
  const ev = (o) => canonAgenda({ app: 'cockpit-agenda', date: WED, events: [o] }).events[0]

  it('l’heure de fin donne la durée du bloc', () => {
    expect(ev({ time: '09:00', end: '10:30', title: 'Point' }).durationMinutes).toBe(90)
  })

  it('sans heure de fin, on retombe sur une heure — pas sur zéro', () => {
    // Ancienne version du bloc Apps Script : la timeline doit rester lisible.
    expect(ev({ time: '09:00', title: 'Point' }).durationMinutes).toBe(60)
    expect(ev({ time: '09:00', end: 'nawak', title: 'Point' }).durationMinutes).toBe(60)
  })

  it('une fin avant le début court jusqu’à la fin de journée, jamais en négatif', () => {
    expect(ev({ time: '23:00', end: '01:00', title: 'Nuit' }).durationMinutes).toBe(60)
  })

  it('un événement journée entière n’a pas de durée à placer', () => {
    const e = ev({ time: '', title: 'Vacances', allDay: true })
    expect(e.allDay).toBe(true)
    expect(e.durationMinutes).toBe(0)
  })

  it('reste idempotent avec les nouveaux champs', () => {
    const once = canonAgenda({
      app: 'cockpit-agenda', date: WED,
      events: [{ time: '09:00', end: '10:30', title: 'Point' }, { time: '', title: 'Vacances', allDay: true }],
    })
    expect(canonAgenda(once)).toEqual(once)
  })
})
