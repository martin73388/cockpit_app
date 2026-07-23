import { describe, it, expect } from 'vitest'
import { createStore } from '../src/data/store.js'
import { newHabit } from '../src/data/model.js'
import { canonicalize } from '../src/sync/merge.js'

function storeWithHabit(habitPatch = {}) {
  const habit = newHabit({ title: 'Sport', calendarSync: 'synced', calendarEventId: 'evt1', ...habitPatch })
  const st = createStore(canonicalize({ app: 'cockpit', version: 2, todos: [], habits: [habit], inbox: [], deleted: [] }))
  return { st, id: habit.id }
}

describe('updateHabit — seul un changement de schedule rouvre le handshake', () => {
  it('titre/notes/pilier seuls : calendarSync reste synced', () => {
    const { st, id } = storeWithHabit()
    const schedule = st.getSnapshot().habits[0].schedule
    st.updateHabit(id, { title: 'Sport matinal', notes: 'salle', pillar: 'sport', schedule: { ...schedule } })
    const h = st.getSnapshot().habits[0]
    expect(h.title).toBe('Sport matinal')
    expect(h.calendarSync).toBe('synced') // pas de re-pending
    expect(h.calendarEventId).toBe('evt1')
  })

  it('changement de schedule (heure) : repasse à pending', () => {
    const { st, id } = storeWithHabit()
    const schedule = { ...st.getSnapshot().habits[0].schedule, time: '07:30' }
    st.updateHabit(id, { title: 'Sport', schedule })
    expect(st.getSnapshot().habits[0].calendarSync).toBe('pending')
  })

  it("changement d'anchorDate : repasse à pending (anchorDate inclus dans schedule)", () => {
    const { st, id } = storeWithHabit({
      schedule: { frequency: 'biweekly', daysOfWeek: ['WE'], time: '', durationMinutes: 30, anchorDate: '2026-07-22' },
    })
    const schedule = { ...st.getSnapshot().habits[0].schedule, anchorDate: '2026-07-29' }
    st.updateHabit(id, { schedule })
    expect(st.getSnapshot().habits[0].calendarSync).toBe('pending')
  })

  it('toggleHabitCompletion ne touche jamais calendarSync', () => {
    const { st, id } = storeWithHabit()
    st.toggleHabitCompletion(id, '2026-07-23')
    let h = st.getSnapshot().habits[0]
    expect(h.completions).toEqual(['2026-07-23'])
    expect(h.calendarSync).toBe('synced')
    st.toggleHabitCompletion(id, '2026-07-23') // un-check
    h = st.getSnapshot().habits[0]
    expect(h.completions).toEqual([])
    expect(h.checks['2026-07-23'].on).toBe(false) // trace CRDT du retrait
    expect(h.calendarSync).toBe('synced')
  })

  it('toggleHabitActive rouvre toujours le handshake', () => {
    const { st, id } = storeWithHabit()
    st.toggleHabitActive(id)
    expect(st.getSnapshot().habits[0].calendarSync).toBe('pending')
  })
})
