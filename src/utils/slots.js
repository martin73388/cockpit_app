// Créneaux de travail — le pont entre les créneaux récurrents et les tâches.
//
// Un créneau récurrent portant le pilier « travail » (ex. « Créneau de travail
// projet », mercredi 19h, 2 h) engendre une occurrence par jour où il tombe.
// Les tâches planifiées DANS cette fenêtre horaire l'occupent : on en déduit le
// temps restant, et l'heure à laquelle la prochaine tâche doit commencer.
//
// Le rattachement d'une tâche à un créneau est déduit de l'heure — aucun champ
// de liaison n'est stocké. Deux avantages : rien à migrer, et une tâche
// replanifiée à la main hors du créneau s'en détache d'elle-même.
import { WORK_PILLAR } from '../data/model.js'
import { addDaysISO } from './dates.js'
import { scheduledOn } from './recurrence.js'

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function toMinutes(hhmm) {
  if (typeof hhmm !== 'string' || !TIME_RE.test(hhmm)) return null
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function fromMinutes(mins) {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(mins)))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// Durée qu'une tâche occupe dans un créneau : ce qu'elle a réservé, à défaut
// son estimation, à défaut une heure.
function taskMinutes(t) {
  const d = Number(t.scheduled && t.scheduled.durationMinutes)
  if (Number.isFinite(d) && d > 0) return d
  const e = Number(t.estimateMinutes)
  return Number.isFinite(e) && e > 0 ? e : 60
}

// -> [{ key, habitId, title, date, time, durationMinutes, used, free,
//        nextStart, tasks }] trié par date puis heure.
// `days` jours à partir de `today` inclus.
export function workSlots(habits, todos, today, days = 7) {
  const out = []
  for (let i = 0; i < days; i++) {
    const date = addDaysISO(today, i)
    for (const h of habits || []) {
      if (!h.active || h.pillar !== WORK_PILLAR) continue
      if (!scheduledOn(h, date)) continue
      const start = toMinutes(h.schedule && h.schedule.time)
      if (start == null) continue // sans heure, un créneau n'est pas planifiable
      const total = Number(h.schedule.durationMinutes) > 0 ? Number(h.schedule.durationMinutes) : 60
      const end = start + total

      // Tâches posées dans la fenêtre : on ne compte QUE celles dont le début
      // tombe dedans, pour qu'une tâche ne soit jamais comptée deux fois.
      let used = 0
      let tasks = 0
      for (const t of todos || []) {
        if (t.status !== 'scheduled' || !t.scheduled || t.scheduled.date !== date) continue
        const ts = toMinutes(t.scheduled.time)
        if (ts == null || ts < start || ts >= end) continue
        used += taskMinutes(t)
        tasks++
      }
      const capped = Math.min(used, total)
      out.push({
        key: `${h.id}@${date}`,
        habitId: h.id,
        title: h.title,
        date,
        time: h.schedule.time,
        durationMinutes: total,
        used,
        free: Math.max(0, total - used),
        // Où poser la tâche suivante : après ce qui est déjà là, sans sortir
        // du créneau (un créneau plein empile au dernier moment utile).
        nextStart: fromMinutes(start + capped),
        tasks,
      })
    }
  }
  return out.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : toMinutes(a.time) - toMinutes(b.time),
  )
}
