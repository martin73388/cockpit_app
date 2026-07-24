import { computeAlerts } from '../../utils/alerts.js'
import { useStore } from '../../hooks/useStore.js'
import { todayISO } from '../../utils/dates.js'

// Section 5 — app-computed alerts from Radar / Carnet sources + Cockpit's own
// stalled subjects, grouped by source. An unavailable source shows a discreet
// note — never a blocking error.
export function AlertsSection({ sources }) {
  const todos = useStore((s) => s.todos)
  const groups = computeAlerts(sources, todayISO(), Date.now(), todos)
  const allEmpty = groups.every((g) => g.items !== null && g.items.length === 0)

  return (
    <section className="card dash-section" aria-label="Alertes">
      <h2>Alertes</h2>
      {allEmpty && <p className="muted">Aucune alerte — tout est propre. ✨</p>}
      {groups.map((g) => {
        if (g.items === null) {
          return (
            <p key={g.source} className="faint alert-unavailable">
              {g.source} indisponible pour l'instant.
            </p>
          )
        }
        if (g.items.length === 0) return null
        return (
          <div key={g.source} className="alert-group">
            <div className="row alert-group-head">
              <span className="label">{g.source}</span>
              {g.url && (
                <a href={g.url} target="_blank" rel="noopener noreferrer" className="alert-open">
                  Ouvrir {g.source} ↗
                </a>
              )}
            </div>
            {g.items.map((a, i) => (
              <div key={i} className={`alert-line kind-${a.kind}`}>
                {a.label}
              </div>
            ))}
          </div>
        )
      })}
    </section>
  )
}
