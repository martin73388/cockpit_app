// Read-only sources fetched through the Drive gateway, refreshed on EVERY sync
// cycle (launch / focus / online / manual) — not just at launch:
//   radar.json        -> companies[] + contacts[]  (project list + alerts)
//   carnet-data.json  -> projects[]                (project list + alerts)
// Results are cached locally so the UI still works offline; a source that
// fails keeps its cached value and is flagged unavailable (section hidden
// with a discreet note — never a blocking error screen).
import { readFile } from './drive.js'
import { KEYS, load, save } from '../data/persist.js'

const EMPTY = {
  radar: { available: false, companies: [], contacts: [] },
  carnet: { available: false, projects: [] },
}

function extractRadar(content) {
  return {
    available: true,
    companies: (Array.isArray(content && content.companies) ? content.companies : [])
      .filter((c) => c && c.id != null)
      .map((c) => ({
        id: String(c.id),
        name: c.name || '(sans nom)',
        priority: !!c.priority,
        status: c.status || '',
      })),
    contacts: (Array.isArray(content && content.contacts) ? content.contacts : [])
      .filter((c) => c && c.id != null)
      .map((c) => ({
        id: String(c.id),
        name: c.name || '(sans nom)',
        nextFollowUp: c.nextFollowUp ?? null,
      })),
  }
}

function extractCarnet(content) {
  return {
    available: true,
    projects: (Array.isArray(content && content.projects) ? content.projects : [])
      .filter((p) => p && p.id != null)
      .map((p) => ({
        id: String(p.id),
        name: p.name || '(sans nom)',
        status: p.status || '',
        blocker: typeof p.blocker === 'string' ? p.blocker : '',
        dueDate: typeof p.dueDate === 'string' ? p.dueDate : '',
        updatedAt: Number(p.updatedAt) || 0,
      })),
  }
}

export function loadCachedSources() {
  return load(KEYS.sources, EMPTY)
}

// Fetches both files; a failing source falls back to its cached extract but is
// marked unavailable for this cycle. Never throws.
export async function fetchSources(driveCfg) {
  const cached = loadCachedSources()
  if (!driveCfg || !driveCfg.execUrl || !driveCfg.secret) {
    return { radar: { ...cached.radar, available: false }, carnet: { ...cached.carnet, available: false } }
  }

  // A missing file or a file that doesn't have the expected shape is treated
  // exactly like a network failure: keep the cached extract, flag unavailable.
  const [radar, carnet] = await Promise.all([
    readFile(driveCfg, 'radar.json')
      .then((r) =>
        r.exists && r.content && Array.isArray(r.content.companies)
          ? extractRadar(r.content)
          : { ...cached.radar, available: false },
      )
      .catch(() => ({ ...cached.radar, available: false })),
    readFile(driveCfg, 'carnet-data.json')
      .then((r) =>
        r.exists && r.content && Array.isArray(r.content.projects)
          ? extractCarnet(r.content)
          : { ...cached.carnet, available: false },
      )
      .catch(() => ({ ...cached.carnet, available: false })),
  ])

  const sources = { radar, carnet }
  save(KEYS.sources, sources)
  return sources
}

// Project dropdown entries derived from the sources.
export function projectsOf(sources) {
  const s = sources || EMPTY
  return [
    ...s.radar.companies.map((c) => ({ id: c.id, source: 'Radar', label: c.name })),
    ...s.carnet.projects.map((p) => ({ id: p.id, source: 'Carnet', label: p.name })),
  ]
}

// Group into optgroups for the <select>, preserving source order Radar then Carnet.
export function groupBySource(projects) {
  const groups = []
  for (const source of ['Radar', 'Carnet']) {
    const items = projects.filter((p) => p.source === source)
    if (items.length) groups.push({ source, items })
  }
  return groups
}
