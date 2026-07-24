// Date helpers. dueDate is a local "YYYY-MM-DD" string.
export function todayISO(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDaysISO(iso, n) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return todayISO(d)
}

// Nombre de jours entiers écoulés depuis un instant epoch-ms.
export function daysSince(epochMs, now = Date.now()) {
  if (!epochMs) return 0
  return Math.max(0, Math.floor((now - epochMs) / 86400000))
}

export function isOverdue(todo, today = todayISO()) {
  return !todo.done && !!todo.dueDate && todo.dueDate < today
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

// "2026-07-24" -> "24 juil." (year shown only when not the current year).
export function formatDueDate(iso, today = todayISO()) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10))
  if (!y || !m || !d) return iso
  const month = MONTHS[m - 1] || ''
  const sameYear = String(y) === today.slice(0, 4)
  return sameYear ? `${d} ${month}` : `${d} ${month} ${y}`
}

// Relative-ish label for due dates, used on rows/cards.
export function dueLabel(iso, today = todayISO()) {
  if (!iso) return ''
  if (iso === today) return "Aujourd'hui"
  // Anchor at noon and increment the calendar day so DST transitions (23h/25h
  // days) can't shift "tomorrow" onto the wrong date.
  const t = new Date(today + 'T12:00:00')
  t.setDate(t.getDate() + 1)
  const tomorrow = todayISO(t)
  if (iso === tomorrow) return 'Demain'
  return formatDueDate(iso, today)
}
