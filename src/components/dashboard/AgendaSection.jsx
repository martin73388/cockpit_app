import { agendaForToday } from '../../sync/agenda.js'

// Agenda du jour — le cadre fixe de la journée, déposé par le robot.
// Rien à valider ici : c'est de la lecture. Absent ou périmé = section absente,
// pour ne jamais faire passer la journée d'hier pour celle d'aujourd'hui.
export function AgendaSection({ agenda }) {
  const a = agendaForToday(agenda)
  if (!a || a.events.length === 0) return null

  return (
    <section className="card dash-section agenda" aria-label="Agenda">
      <h2>Agenda</h2>
      {a.events.map((e, i) => (
        <div key={i} className="today-line agenda-line">
          <span className="agenda-time">{e.allDay ? 'journée' : e.time}</span>
          <span className="today-title">{e.title}</span>
        </div>
      ))}
    </section>
  )
}
