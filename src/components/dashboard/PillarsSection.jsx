import { useStore } from '../../hooks/useStore.js'
import { PILLAR_LABEL } from '../../data/model.js'
import { todayISO } from '../../utils/dates.js'
import { computePillarWeek } from '../../utils/pillars.js'

// Équilibre de la semaine (lun→dim) : une carte par pilier porté par au moins
// un créneau actif — occurrences prévues vs tenues, et surtout ce qui a été
// réellement manqué (jours déjà passés).
export function PillarsSection() {
  const habits = useStore((s) => s.habits)
  const cards = computePillarWeek(habits, todayISO())

  return (
    <section className="card dash-section" aria-label="Équilibre">
      <h2>Équilibre</h2>
      {cards.length === 0 ? (
        <p className="muted">
          Assigne un <strong>pilier</strong> à tes créneaux (Travail, Famille, Ami, Argent,
          Sport, Maison) pour suivre ton équilibre de la semaine ici.
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
