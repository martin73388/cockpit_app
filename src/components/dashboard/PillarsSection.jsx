import { useStore } from '../../hooks/useStore.js'
import { PILLAR_LABEL } from '../../data/model.js'
import { todayISO } from '../../utils/dates.js'
import { computePillarWeek } from '../../utils/pillars.js'

// Section 4 — life vigilance: current week (Mon→Sun), one card per pillar
// present on at least one habit: planned occurrences this week vs done,
// remaining count, "À jour" when nothing left.
export function PillarsSection() {
  const habits = useStore((s) => s.habits)
  const cards = computePillarWeek(habits, todayISO())

  return (
    <section className="card dash-section" aria-label="Vigilance vie">
      <h2>Vigilance vie</h2>
      {cards.length === 0 ? (
        <p className="muted">
          Assigne un <strong>pilier</strong> à tes habitudes (Sommeil, Sport, Couple, Proches, Repas)
          pour suivre ton équilibre de la semaine ici.
        </p>
      ) : (
        <div className="pillar-grid">
          {cards.map((c) => (
            <div
              key={c.pillar}
              className={`pillar-card ${c.late > 0 ? 'late' : c.remaining === 0 ? 'ok' : ''}`}
            >
              <span className="pillar-name">{PILLAR_LABEL[c.pillar]}</span>
              <span className="pillar-count">
                {c.done}/{c.planned}
              </span>
              {/* Le retard prime : c'est le seul chiffre sur lequel agir.
                  Sinon on annonce ce qui reste à venir, sans dramatiser. */}
              <span className="pillar-hint">
                {c.late > 0
                  ? `${c.late} manqué${c.late > 1 ? 's' : ''}`
                  : c.remaining === 0
                    ? 'À jour'
                    : `reste ${c.remaining}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
