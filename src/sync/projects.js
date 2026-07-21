// Project list for the todo `projectId` dropdown.
// Read-only, via the Drive gateway:
//   GET ?file=radar.json        -> companies[] -> { id, source:'Radar',  label:name }
//   GET ?file=carnet-data.json  -> projects[]  -> { id, source:'Carnet', label:name }
// Results are cached locally so the dropdown still works offline.
import { readFile } from './drive.js'
import { KEYS, load, save } from '../data/persist.js'

function mapRadar(content) {
  const companies = content && Array.isArray(content.companies) ? content.companies : []
  return companies
    .filter((c) => c && c.id != null)
    .map((c) => ({ id: String(c.id), source: 'Radar', label: c.name || '(sans nom)' }))
}

function mapCarnet(content) {
  const projects = content && Array.isArray(content.projects) ? content.projects : []
  return projects
    .filter((p) => p && p.id != null)
    .map((p) => ({ id: String(p.id), source: 'Carnet', label: p.name || '(sans nom)' }))
}

export function loadCachedProjects() {
  return load(KEYS.projects, [])
}

// Fetches both files; tolerates one source failing (returns whatever it got,
// falling back to cache for a source that errors). Never throws.
export async function fetchProjects(driveCfg) {
  if (!driveCfg || !driveCfg.execUrl || !driveCfg.secret) return loadCachedProjects()
  const cached = loadCachedProjects()
  const cachedBySource = {
    Radar: cached.filter((p) => p.source === 'Radar'),
    Carnet: cached.filter((p) => p.source === 'Carnet'),
  }

  const [radar, carnet] = await Promise.all([
    readFile(driveCfg, 'radar.json').then((r) => mapRadar(r.content)).catch(() => cachedBySource.Radar),
    readFile(driveCfg, 'carnet-data.json').then((r) => mapCarnet(r.content)).catch(() => cachedBySource.Carnet),
  ])

  const merged = [...radar, ...carnet]
  save(KEYS.projects, merged)
  return merged
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
