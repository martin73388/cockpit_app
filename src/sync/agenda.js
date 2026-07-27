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

// "HH:MM" -> minutes depuis minuit (l'appelant a déjà validé le format).
export function hm(t) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// Durée par défaut quand le robot n'envoie pas d'heure de fin (ancienne version
// du bloc Apps Script) : la timeline reste lisible plutôt que de refuser.
const DEFAULT_MINUTES = 60

export function canonAgenda(a) {
  const events = (Array.isArray(a.events) ? a.events : [])
    .filter((e) => e && typeof e === 'object' && typeof e.title === 'string' && e.title.trim())
    .map((e) => {
      const time = typeof e.time === 'string' && TIME_RE.test(e.time) ? e.time : ''
      const end = typeof e.end === 'string' && TIME_RE.test(e.end) ? e.end : ''
      // Une fin antérieure au début (événement à cheval sur minuit) est
      // ramenée à la fin de journée plutôt que de produire une durée négative.
      let minutes = DEFAULT_MINUTES
      if (time && end) {
        const d = hm(end) - hm(time)
        minutes = d > 0 ? d : 24 * 60 - hm(time)
      }
      return {
        time,
        end,
        durationMinutes: time ? minutes : 0,
        title: e.title.trim(),
        // Un événement « journée entière » n'a pas d'heure et se range en tête.
        allDay: !!e.allDay || !time,
      }
    })
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
