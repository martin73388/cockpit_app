// UI preferences (layout, sort, filters) persisted locally. Not synced.
import { KEYS, load, save } from './persist.js'

const DEFAULT_UI = {
  tab: 'todos', // 'dashboard' is disabled in v1
  layout: 'rows', // 'rows' | 'cards'
  sort: 'manual', // manual | due | priority | created
  status: 'all', // all | todo | done | overdue
  priority: 'all', // all | haute | normale | basse
  theme: 'system', // system | light | dark
}

export function getUi() {
  return { ...DEFAULT_UI, ...(load(KEYS.ui) || {}) }
}
export function setUi(patch) {
  const next = { ...getUi(), ...patch }
  save(KEYS.ui, next)
  return next
}
