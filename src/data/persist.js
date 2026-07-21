// localStorage helpers. All keys are prefixed `cockpit-`.
// Secrets (GitHub token, Drive secret) live here and are NEVER put into the
// synced data file or any export.
const PREFIX = 'cockpit-'

export const KEYS = {
  state: PREFIX + 'state',
  github: PREFIX + 'github-config',
  drive: PREFIX + 'drive-config',
  ui: PREFIX + 'ui',
  projects: PREFIX + 'projects-cache',
}

function available() {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

export function load(key, fallback = null) {
  if (!available()) return fallback
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function save(key, value) {
  if (!available()) return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota / private mode — local persistence is best-effort */
  }
}

export function remove(key) {
  if (!available()) return
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}
