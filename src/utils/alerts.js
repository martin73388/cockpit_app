// App-computed alerts from the read-only Radar / Carnet sources.
// Grouped by source; each line carries an external "open app" link.
import { todayISO, addDaysISO } from './dates.js'

export const RADAR_URL = 'https://martin73388.github.io/radar_app/'
export const CARNET_URL = 'https://martin73388.github.io/carnet-app/'

const SLEEP_DAYS = 21
const DUE_SOON_DAYS = 7

// Carnet rules:
//   - blocker non-empty AND status !== "termine"            -> "bloqué"
//   - now - updatedAt > 21 days AND status !== "termine"    -> "en sommeil"
//   - dueDate non-empty AND <= today+7d AND not terminated  -> "échéance proche"
export function carnetAlerts(carnet, today = todayISO(), now = Date.now()) {
  if (!carnet || !carnet.available) return null // source unavailable -> hide section
  const out = []
  const horizon = addDaysISO(today, DUE_SOON_DAYS)
  for (const p of carnet.projects) {
    if (p.status === 'termine') continue
    if (p.blocker) out.push({ kind: 'bloque', label: `${p.name} — bloqué : ${p.blocker}` })
    if (p.updatedAt && now - p.updatedAt > SLEEP_DAYS * 86400000) {
      const days = Math.floor((now - p.updatedAt) / 86400000)
      out.push({ kind: 'sommeil', label: `${p.name} — en sommeil depuis ${days} j` })
    }
    if (p.dueDate && p.dueDate <= horizon) {
      out.push({
        kind: 'echeance',
        label: p.dueDate < today ? `${p.name} — échéance dépassée (${p.dueDate})` : `${p.name} — échéance le ${p.dueDate}`,
      })
    }
  }
  return out
}

// Radar rules:
//   - contacts[].nextFollowUp non-null AND < today  -> "relance dépassée"
//   - companies[] priority:true AND status:"to_contact" -> "prioritaire jamais contacté"
export function radarAlerts(radar, today = todayISO()) {
  if (!radar || !radar.available) return null
  const out = []
  for (const c of radar.contacts) {
    if (c.nextFollowUp == null) continue
    // nextFollowUp may be "YYYY-MM-DD" or an ISO datetime — compare the date part.
    const d = String(c.nextFollowUp).slice(0, 10)
    if (d && d < today) out.push({ kind: 'relance', label: `${c.name} — relance dépassée (${d})` })
  }
  for (const c of radar.companies) {
    if (c.priority && c.status === 'to_contact') {
      out.push({ kind: 'prioritaire', label: `${c.name} — prioritaire, jamais contacté` })
    }
  }
  return out
}

// -> [{ source:'Radar'|'Carnet', url, items|null }] ; items===null means the
// source is unavailable this cycle (render a discreet note, never an error).
export function computeAlerts(sources, today = todayISO(), now = Date.now()) {
  return [
    { source: 'Radar', url: RADAR_URL, items: radarAlerts(sources && sources.radar, today) },
    { source: 'Carnet', url: CARNET_URL, items: carnetAlerts(sources && sources.carnet, today, now) },
  ]
}
