// v8 — Rattrapage de la veille et retard réel des piliers.
//
// Constat qui motive tout ça : 6 habitudes, 0 complétion en 8 jours. Les
// habitudes se font le soir et personne ne rouvre l'app pour les cocher, donc
// « Vigilance vie » restait structurellement vide.
import { describe, it, expect } from 'vitest'
import { canonicalize } from '../src/sync/merge.js'
import { createStore } from '../src/data/store.js'
import { newHabit, APP, SCHEMA_VERSION } from '../src/data/model.js'
import { computePillarWeek } from '../src/utils/pillars.js'
import { scheduledOn } from '../src/utils/recurrence.js'
import { addDaysISO } from '../src/utils/dates.js'

function state(habits = []) {
  return { app: APP, version: SCHEMA_VERSION, todos: [], habits, inbox: [], deleted: [] }
}
const daily = (patch = {}) =>
  newHabit({ title: 'quotidienne', schedule: { frequency: 'daily', daysOfWeek: [], time: '19:30', durationMinutes: 60, anchorDate: '' }, ...patch })

// Mercredi 2026-07-29 comme « aujourd'hui » : la semaine court du lundi 27
// au dimanche 2 août, donc 2 jours passés (27, 28) et 4 à venir.
const TODAY = '2026-07-29'
const YESTERDAY = '2026-07-28'

// Ce que fait la section « Hier » : habitude active, prévue hier, non cochée.
function missedYesterday(habits, today) {
  const y = addDaysISO(today, -1)
  return habits.filter((h) => h.active && scheduledOn(h, y) && !h.completions.includes(y))
}

describe('v8 : rattrapage de la veille', () => {
  it('une habitude prévue hier et non cochée remonte', () => {
    const h = canonicalize(state([daily({ title: 'Yoga' })])).habits[0]
    expect(missedYesterday([h], TODAY).map((x) => x.title)).toEqual(['Yoga'])
  })

  it('cocher hier depuis le Dashboard est bien enregistré sur LA VEILLE', () => {
    const st = createStore(canonicalize(state([daily({ title: 'Yoga' })])))
    const id = st.getSnapshot().habits[0].id
    st.toggleHabitCompletion(id, YESTERDAY)
    const h = st.getSnapshot().habits[0]
    expect(h.completions).toEqual([YESTERDAY]) // et surtout pas aujourd'hui
    expect(h.checks[YESTERDAY].on).toBe(true)
    expect(missedYesterday([h], TODAY)).toHaveLength(0) // la ligne disparaît
  })

  it('cocher la veille ne réveille jamais le handshake agenda', () => {
    // Une complétion ne doit pas faire recréer la série d'événements.
    const st = createStore(canonicalize(state([daily({ calendarSync: 'synced', calendarEventId: 'ev1' })])))
    const id = st.getSnapshot().habits[0].id
    st.toggleHabitCompletion(id, YESTERDAY)
    expect(st.getSnapshot().habits[0].calendarSync).toBe('synced')
    expect(st.getSnapshot().habits[0].calendarEventId).toBe('ev1')
  })

  it('rien à rattraper : ni habitude inactive, ni jour non prévu, ni déjà cochée', () => {
    const inactive = canonicalize(state([daily({ title: 'off', active: false })])).habits[0]
    // Prévue le lundi seulement : rien à rattraper un mercredi.
    const monday = canonicalize(
      state([newHabit({ title: 'lundi', schedule: { frequency: 'weekly', daysOfWeek: ['MO'], time: '', durationMinutes: 30, anchorDate: '' } })]),
    ).habits[0]
    const alreadyDone = canonicalize(state([daily({ title: 'faite', completions: [YESTERDAY] })])).habits[0]
    expect(missedYesterday([inactive, monday, alreadyDone], TODAY)).toHaveLength(0)
  })

  it('la veille est bien la veille, même au passage de mois', () => {
    expect(addDaysISO('2026-08-01', -1)).toBe('2026-07-31')
    expect(addDaysISO('2026-01-01', -1)).toBe('2025-12-31')
  })
})

describe('v8 : les piliers distinguent le retard réel du reste à venir', () => {
  const sport = (patch = {}) => daily({ pillar: 'sport', ...patch })

  it('lundi matin, une semaine intacte n’annonce AUCUN retard', () => {
    // Le bug de fond : la semaine entière était comptée en « reste N », donc la
    // section criait au retard avant que la semaine ait commencé.
    const monday = '2026-07-27'
    const [c] = computePillarWeek(canonicalize(state([sport()])).habits, monday)
    expect(c.planned).toBe(7)
    expect(c.late).toBe(0) // rien de passé
    expect(c.remaining).toBe(7)
  })

  it('les jours passés non cochés comptent comme manqués, pas aujourd’hui', () => {
    const [c] = computePillarWeek(canonicalize(state([sport()])).habits, TODAY)
    expect(c.planned).toBe(7)
    expect(c.late).toBe(2) // lundi 27 et mardi 28 ; le 29 n'est pas fini
    expect(c.done).toBe(0)
  })

  it('cocher la veille fait retomber le retard', () => {
    const h = canonicalize(state([sport({ completions: ['2026-07-27', '2026-07-28'] })])).habits[0]
    const [c] = computePillarWeek([h], TODAY)
    expect(c.late).toBe(0)
    expect(c.done).toBe(2)
    expect(c.remaining).toBe(5)
  })

  it('une habitude sans pilier ne compte dans aucune carte', () => {
    // Cas réel : « Créneau de travail projet » a pillar: null.
    expect(computePillarWeek(canonicalize(state([daily({ pillar: null })])).habits, TODAY)).toHaveLength(0)
  })

  it('une habitude en pause sort du calcul', () => {
    expect(computePillarWeek(canonicalize(state([sport({ active: false })])).habits, TODAY)).toHaveLength(0)
  })

  it('une complétion hors planning ne masque pas une occurrence manquée', () => {
    // Habitude du lundi cochée un dimanche : ne doit rien compenser.
    const h = canonicalize(
      state([
        newHabit({
          title: 'lundi', pillar: 'sport', completions: ['2026-07-26'],
          schedule: { frequency: 'weekly', daysOfWeek: ['MO'], time: '', durationMinutes: 30, anchorDate: '' },
        }),
      ]),
    ).habits[0]
    const [c] = computePillarWeek([h], TODAY)
    expect(c.planned).toBe(1)
    expect(c.done).toBe(0)
    expect(c.late).toBe(1) // lundi 27 manqué, malgré la coche du 26
  })
})
