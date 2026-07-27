// agenda.json — LECTURE SEULE. Écrit par le robot Apps Script (syncAgenda,
// toutes les 10 min) dans le même dossier Drive ; l'app ne l'écrit JAMAIS.
//
// L'app est une page web sans identifiants Google : elle ne peut pas lire
// Google Agenda elle-même. Le robot, lui, tourne chez Google avec l'accord de
// Martin — il dépose donc ce que l'app se contente d'afficher.
//
// Rafraîchi à chaque cycle de synchro, comme le brief et les sources.
import { readFile } from './drive.js'
import { KEYS, load, save, remove } from '../data/persist.js'
import { todayISO } from '../utils/dates.js'

export function isAgendaFile(obj) {
  return !!obj && obj.app === 'cockpit-agenda'
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function canonAgenda(a) {
  const events = (Array.isArray(a.events) ? a.events : [])
    .filter((e) => e && typeof e === 'object' && typeof e.title === 'string' && e.title.trim())
    .map((e) => ({
      time: typeof e.time === 'string' && TIME_RE.test(e.time) ? e.time : '',
      title: e.title.trim(),
      // Un événement « journée entière » n'a pas d'heure et se range en tête.
      allDay: !!e.allDay || !(typeof e.time === 'string' && TIME_RE.test(e.time)),
    }))
    .sort((x, y) => (x.allDay === y.allDay ? x.time.localeCompare(y.time) : x.allDay ? -1 : 1))
  return {
    date: typeof a.date === 'string' ? a.date : '',
    generatedAt: a.generatedAt ?? null,
    events,
  }
}

// L'agenda n'a de sens que pour aujourd'hui : périmé = rien à afficher, plutôt
// que d'afficher la journée d'hier en la faisant passer pour celle du jour.
export function agendaForToday(agenda, today = todayISO()) {
  if (!agenda || agenda.date !== today) return null
  return agenda
}

export function loadCachedAgenda() {
  return load(KEYS.agenda, null)
}

// Ne lève jamais. Repli sur le cache quand la passerelle est injoignable.
export async function fetchAgenda(driveCfg) {
  if (!driveCfg || !driveCfg.execUrl || !driveCfg.secret) return loadCachedAgenda()
  try {
    const r = await readFile(driveCfg, 'agenda.json')
    if (!r.exists || !isAgendaFile(r.content)) {
      remove(KEYS.agenda)
      return null
    }
    const agenda = canonAgenda(r.content)
    save(KEYS.agenda, agenda)
    return agenda
  } catch {
    return loadCachedAgenda()
  }
}
