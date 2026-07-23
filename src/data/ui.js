// UI preferences (layout, sort, filters) persisted locally. Not synced.
import { KEYS, load, save } from './persist.js'

const DEFAULT_UI = {
  tab: 'dashboard', // v2: dashboard is the default tab (not persisted)
  layout: 'rows', // 'rows' | 'cards'
  sort: 'manual', // manual | due | priority | created
  status: 'all', // all | todo | done | overdue
  priority: 'all', // all | haute | normale | basse
  theme: 'system', // system | light | dark
}

export function getUi() {
  const stored = load(KEYS.ui) || {}
  delete stored.tab // older versions persisted the tab; always open on Dashboard
  return { ...DEFAULT_UI, ...stored }
}
export function setUi(patch) {
  const next = { ...getUi(), ...patch }
  // The active tab is session-only: the app always opens on the Dashboard.
  const { tab, ...persisted } = next
  save(KEYS.ui, persisted)
  return next
}
