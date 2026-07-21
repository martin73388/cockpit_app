// GitHub + Drive configuration, persisted locally only.
// Secrets (token, secret) are stored here and are NEVER written to the synced
// data file nor included in any export.
import { KEYS, load, save } from './persist.js'

export const DEFAULT_GITHUB = { owner: '', repo: 'cockpit_core', branch: 'main', path: 'cockpit-data.json', token: '' }
export const DEFAULT_DRIVE = { execUrl: '', secret: '' }

export function getGithubConfig() {
  return { ...DEFAULT_GITHUB, ...(load(KEYS.github) || {}) }
}
export function setGithubConfig(cfg) {
  save(KEYS.github, { ...DEFAULT_GITHUB, ...cfg })
}
export function getDriveConfig() {
  return { ...DEFAULT_DRIVE, ...(load(KEYS.drive) || {}) }
}
export function setDriveConfig(cfg) {
  save(KEYS.drive, { ...DEFAULT_DRIVE, ...cfg })
}
