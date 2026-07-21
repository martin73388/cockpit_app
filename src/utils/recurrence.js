// Human-readable recurrence for a habit schedule.
import { DAYS, DAY_LABEL } from '../data/model.js'

function daysText(daysOfWeek) {
  const ordered = DAYS.filter((d) => daysOfWeek.includes(d))
  if (ordered.length === 0) return 'Aucun jour'
  if (ordered.length === 7) return 'Tous les jours'
  if (ordered.length === 5 && !ordered.includes('SA') && !ordered.includes('SU')) return 'En semaine'
  if (ordered.length === 2 && ordered.includes('SA') && ordered.includes('SU')) return 'Le week-end'
  return ordered.map((d) => DAY_LABEL[d]).join(', ')
}

function durationText(min) {
  if (!min || min <= 0) return ''
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m}` : `${h} h`
}

// e.g. "Tous les jours · 09:00 · 30 min" or "Lun, Mer, Ven · 30 min"
export function describeSchedule(schedule) {
  const s = schedule || {}
  const base = s.frequency === 'weekly' ? daysText(s.daysOfWeek || []) : 'Tous les jours'
  const parts = [base]
  if (s.time) parts.push(s.time)
  const dur = durationText(s.durationMinutes)
  if (dur) parts.push(dur)
  return parts.join(' · ')
}
