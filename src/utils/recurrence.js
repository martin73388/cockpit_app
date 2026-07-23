// Habit scheduling: is a habit planned on a given date, and human-readable
// recurrence text.
import { DAYS, DAY_LABEL } from '../data/model.js'
import { addDaysISO } from './dates.js'
export { addDaysISO }

// "YYYY-MM-DD" -> day code MO..SU (local-date safe: parsed at noon).
export function dayCodeOf(iso) {
  const d = new Date(iso + 'T12:00:00')
  return DAYS[(d.getDay() + 6) % 7] // JS getDay: 0=Sun -> our order is Mon-first
}

// Monday (as "YYYY-MM-DD") of the week containing the given date.
export function mondayOf(iso) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Week parity between two dates, comparing the Mondays of their weeks.
// Math.round on the /7-days division absorbs DST-induced 23h/25h days.
function sameWeekParity(isoA, isoB) {
  const a = new Date(mondayOf(isoA) + 'T12:00:00').getTime()
  const b = new Date(mondayOf(isoB) + 'T12:00:00').getTime()
  const weeks = Math.round((a - b) / (7 * 86400000))
  return ((weeks % 2) + 2) % 2 === 0
}

// Is this habit planned on `date` ("YYYY-MM-DD")?
//   daily    -> every day
//   weekly   -> date's day ∈ daysOfWeek
//   biweekly -> day ∈ daysOfWeek AND week parity matches anchorDate's week
export function scheduledOn(habit, date) {
  const s = (habit && habit.schedule) || {}
  if (s.frequency === 'daily') return true
  const day = dayCodeOf(date)
  if (!Array.isArray(s.daysOfWeek) || !s.daysOfWeek.includes(day)) return false
  if (s.frequency === 'weekly') return true
  if (s.frequency === 'biweekly') {
    if (!s.anchorDate) return true // malformed biweekly: fail open as weekly
    if (date < s.anchorDate) return false // « à partir du » : never before the anchor
    return sameWeekParity(date, s.anchorDate)
  }
  return false
}

function daysText(daysOfWeek) {
  const ordered = DAYS.filter((d) => daysOfWeek.includes(d))
  if (ordered.length === 0) return 'Aucun jour'
  if (ordered.length === 7) return 'Tous les jours'
  if (ordered.length === 5 && !ordered.includes('SA') && !ordered.includes('SU')) return 'En semaine'
  if (ordered.length === 2 && ordered.includes('SA') && ordered.includes('SU')) return 'Le week-end'
  return ordered.map((d) => DAY_LABEL[d]).join(', ')
}

const DAY_FULL = { MO: 'lundi', TU: 'mardi', WE: 'mercredi', TH: 'jeudi', FR: 'vendredi', SA: 'samedi', SU: 'dimanche' }

function durationText(min) {
  if (!min || min <= 0) return ''
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m}` : `${h} h`
}

function frDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}`
}

// e.g. "Tous les jours · 09:00 · 30 min", "Lun, Mer, Ven · 30 min",
// "Un mercredi sur deux à 20h00 (à partir du 29/07)".
export function describeSchedule(schedule) {
  const s = schedule || {}
  if (s.frequency === 'biweekly') {
    const ordered = DAYS.filter((d) => (s.daysOfWeek || []).includes(d))
    const dayPart =
      ordered.length === 1
        ? `Un ${DAY_FULL[ordered[0]]} sur deux`
        : `${daysText(s.daysOfWeek || [])}, une semaine sur deux`
    const timePart = s.time ? ` à ${s.time.replace(':', 'h')}` : ''
    const durPart = durationText(s.durationMinutes)
    const anchorPart = s.anchorDate ? ` (à partir du ${frDate(s.anchorDate)})` : ''
    return `${dayPart}${timePart}${durPart ? ' · ' + durPart : ''}${anchorPart}`
  }
  const base = s.frequency === 'weekly' ? daysText(s.daysOfWeek || []) : 'Tous les jours'
  const parts = [base]
  if (s.time) parts.push(s.time)
  const dur = durationText(s.durationMinutes)
  if (dur) parts.push(dur)
  return parts.join(' · ')
}
