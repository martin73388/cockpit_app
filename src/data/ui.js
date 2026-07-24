// UI preferences (layout, sort, filters) persisted locally. Not synced.
import { KEYS, load, save } from './persist.js'

const DEFAULT_UI = {
  tab: 'dashboard', // v2: dashboard is the default tab (not persisted)
  layout: 'rows', // 'rows' | 'cards'
  sort: 'manual', // manual | due | priority | created
  status: 'all', // all | todo | waiting | done | overdue
  priorities: ['haute', 'normale', 'basse'], // puces cochables (multi-choix)
  theme: 'system', // system | light | dark
}

export function getUi() {
  const stored = load(KEYS.ui) || {}
  delete stored.tab // older versions persisted the tab; always open on Dashboard
  // Migration du pref v2 (priority: 'all'|'haute'|…) vers le multi-choix.
  if (typeof stored.priority === 'string') {
    stored.priorities = stored.priority === 'all' ? ['haute', 'normale', 'basse'] : [stored.priority]
    delete stored.priority
  }
  if (!Array.isArray(stored.priorities) || stored.priorities.length === 0) delete stored.priorities
  return { ...DEFAULT_UI, ...stored }
}
export function setUi(patch) {
  const next = { ...getUi(), ...patch }
  // The active tab is session-only: the app always opens on the Dashboard.
  const { tab, ...persisted } = next
  save(KEYS.ui, persisted)
  return next
}
