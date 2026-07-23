// Life-vigilance week computation (Dashboard section 4).
// For each pillar carried by at least one ACTIVE habit: planned occurrences in
// the current week (Mon→Sun) vs done. An occurrence counts as done only when
// the completion falls on a SCHEDULED day — off-schedule completions (leftover
// from a schedule edit, or merged from another device) don't inflate the count
// nor mask a genuinely missed occurrence.
import { PILLARS } from '../data/model.js'
import { scheduledOn, mondayOf, addDaysISO } from './recurrence.js'

export function weekOf(today) {
  const monday = mondayOf(today)
  return Array.from({ length: 7 }, (_, i) => addDaysISO(monday, i))
}

// -> [{ pillar, planned, done, remaining }] for pillars present on ≥1 active habit.
export function computePillarWeek(habits, today) {
  const weekDays = weekOf(today)
  const cards = []
  for (const pillar of PILLARS) {
    const withPillar = habits.filter((h) => h.pillar === pillar && h.active)
    if (!withPillar.length) continue
    let planned = 0
    let done = 0
    for (const h of withPillar) {
      for (const day of weekDays) {
        if (!scheduledOn(h, day)) continue
        planned++
        if (h.completions.includes(day)) done++
      }
    }
    cards.push({ pillar, planned, done, remaining: Math.max(0, planned - done) })
  }
  return cards
}
