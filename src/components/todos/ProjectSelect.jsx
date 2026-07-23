import { groupBySource } from '../../sync/sources.js'

// Grouped <select> for projectId. Projects come from Radar + Carnet (read-only).
export function ProjectSelect({ value, projects, onChange, id }) {
  const groups = groupBySource(projects)
  const known = projects.some((p) => p.id === value)
  return (
    <select
      id={id}
      className="select"
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">Aucun projet</option>
      {/* Keep a dangling reference visible if the linked project is gone. */}
      {value && !known && <option value={value}>Projet lié (introuvable)</option>}
      {groups.map((g) => (
        <optgroup key={g.source} label={g.source}>
          {g.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
