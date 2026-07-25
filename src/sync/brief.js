// daily-brief.json — READ ONLY. Deposited by the assistant in the same Drive
// folder; the app NEVER writes it. Refreshed on every sync cycle.
//
// States surfaced to the UI:
//   { status: 'ok', brief }        — present and dated today
//   { status: 'stale', brief }     — present but date ≠ today
//   { status: 'missing' }          — file absent, unreadable, or not a brief
// An unreadable / foreign file is silently treated as missing (never an error).
import { readFile } from './drive.js'
import { KEYS, load, save, remove } from '../data/persist.js'
import { todayISO } from '../utils/dates.js'

export function isBriefFile(obj) {
  return !!obj && obj.app === 'cockpit-brief'
}

const WEATHER_ICONS = ['sun', 'cloud', 'rain', 'storm', 'snow', 'fog', 'partly']

// weather est optionnel ; summary est le seul sous-champ requis. Un bloc
// invalide est simplement ignoré (null -> rien d'affiché).
function canonWeather(w) {
  if (!w || typeof w !== 'object' || typeof w.summary !== 'string' || !w.summary.trim()) return null
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)
  return {
    location: typeof w.location === 'string' ? w.location : '',
    summary: w.summary.trim(),
    tempMin: num(w.tempMin),
    tempMax: num(w.tempMax),
    unit: typeof w.unit === 'string' && w.unit ? w.unit : 'C',
    rainChance: w.rainChance == null ? null : Math.max(0, Math.min(100, num(w.rainChance) ?? 0)),
    icon: WEATHER_ICONS.includes(w.icon) ? w.icon : null,
  }
}

// Normalize the consumed schema defensively; extra fields are ignored.
export function canonBrief(b) {
  return {
    date: typeof b.date === 'string' ? b.date : '',
    generatedAt: b.generatedAt ?? null,
    headline: typeof b.headline === 'string' ? b.headline : '',
    countdown:
      b.countdown && typeof b.countdown === 'object'
        ? { label: b.countdown.label || '', days: Number(b.countdown.days) }
        : null,
    agenda: (Array.isArray(b.agenda) ? b.agenda : []).map((a) => ({ time: a.time || '', title: a.title || '' })),
    priorities: (Array.isArray(b.priorities) ? b.priorities : []).map((p) => ({
      title: p.title || '',
      source: ['radar', 'carnet', 'cockpit', 'gmail'].includes(p.source) ? p.source : 'cockpit',
      detail: p.detail || '',
    })),
    mails: (Array.isArray(b.mails) ? b.mails : []).map((m) => ({ from: m.from || '', subject: m.subject || '', why: m.why || '' })),
    alerts: (Array.isArray(b.alerts) ? b.alerts : []).filter((x) => typeof x === 'string'),
    life: b.life && typeof b.life === 'object' ? { note: b.life.note || '' } : null,
    weather: canonWeather(b.weather),
  }
}

export function briefStatus(brief, today = todayISO()) {
  if (!brief) return { status: 'missing' }
  if (brief.date !== today) return { status: 'stale', brief }
  return { status: 'ok', brief }
}

export function loadCachedBrief() {
  return load(KEYS.brief, null)
}

// Never throws. Falls back to the cached brief when the gateway is unreachable.
export async function fetchBrief(driveCfg) {
  if (!driveCfg || !driveCfg.execUrl || !driveCfg.secret) return loadCachedBrief()
  try {
    const r = await readFile(driveCfg, 'daily-brief.json')
    if (!r.exists || !isBriefFile(r.content)) {
      // The gateway answered: the brief is genuinely absent (or foreign).
      // Clear the cache so the UI shows 'missing' — the cached fallback is
      // reserved for cycles where the gateway itself is unreachable.
      remove(KEYS.brief)
      return null
    }
    const brief = canonBrief(r.content)
    save(KEYS.brief, brief)
    return brief
  } catch {
    return loadCachedBrief()
  }
}
