import { store } from '../../data/store.js'
import { useStore } from '../../hooks/useStore.js'
import { todayISO, addDaysISO } from '../../utils/dates.js'
import { scheduledOn } from '../../utils/recurrence.js'

// Section « Hier » — le rattrapage du lendemain matin.
//
// Un créneau se tient le soir (yoga 19h30, ménage 19h…) ; personne ne rouvre
// l'app juste après pour le cocher. Sans ce bloc, les créneaux ne sont jamais
// validés et « Équilibre » reste vide — c'est exactement ce qui se passait.
//
// Fenêtre volontairement d'UN jour : les occurrences d'aujourd'hui sont déjà
// cochables dans « Aujourd'hui », et remonter plus loin transformerait le
// rattrapage en liste de reproches. Rien à rattraper = section absente.
export function YesterdaySection() {
  const habits = useStore((s) => s.habits)
  const yesterday = addDaysISO(todayISO(), -1)

  const missed = habits.filter(
    (h) => h.active && scheduledOn(h, yesterday) && !h.completions.includes(yesterday),
  )
  if (missed.length === 0) return null

  return (
    <section className="card dash-section yesterday" aria-label="Hier">
      <div className="row brief-head">
        <h2>Hier</h2>
        <span className="faint">tu l'as tenu ?</span>
      </div>
      {missed.map((h) => (
        <div key={h.id} className="today-line">
          <input
            type="checkbox"
            className="check check-sm"
            checked={false}
            onChange={() => store.toggleHabitCompletion(h.id, yesterday)}
            aria-label={`${h.title} : tenu hier`}
          />
          <span className="today-title">{h.title}</span>
          {h.schedule.time && <span className="chip">{h.schedule.time}</span>}
        </div>
      ))}
    </section>
  )
}
