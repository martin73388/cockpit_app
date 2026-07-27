import { agendaForToday, hm } from '../../sync/agenda.js'

// Agenda du jour — une timeline horizontale, pas une liste.
//
// L'échelle est fixe (PX_PER_HOUR) et la bande défile : à hauteur variable, un
// rendez-vous de 30 min deviendrait illisible sur un écran de 240 px. On ne
// dessine que les heures utiles — de la première à la dernière occupation,
// élargies à l'heure pleine — plutôt que 00h→24h aux trois quarts vides.
const PX_PER_HOUR = 56
const MIN_SPAN_H = 6

function pad(n) {
  return String(n).padStart(2, '0')
}

export function AgendaSection({ agenda, now = new Date() }) {
  const a = agendaForToday(agenda)
  if (!a || a.events.length === 0) return null

  const timed = a.events.filter((e) => !e.allDay)
  const allDay = a.events.filter((e) => e.allDay)

  // Fenêtre affichée, calée sur les heures pleines.
  let fromH = 8
  let toH = 20
  if (timed.length) {
    const starts = timed.map((e) => hm(e.time))
    const ends = timed.map((e) => hm(e.time) + e.durationMinutes)
    fromH = Math.floor(Math.min(...starts) / 60)
    toH = Math.ceil(Math.max(...ends) / 60)
  }
  // L'heure courante reste dans le cadre : sinon le repère « maintenant »
  // sortirait de la bande et on ne saurait plus où on en est.
  const nowMin = now.getHours() * 60 + now.getMinutes()
  fromH = Math.max(0, Math.min(fromH, Math.floor(nowMin / 60)))
  toH = Math.min(24, Math.max(toH, Math.ceil(nowMin / 60)))
  if (toH - fromH < MIN_SPAN_H) toH = Math.min(24, fromH + MIN_SPAN_H)

  const spanMin = (toH - fromH) * 60
  const width = ((toH - fromH) * PX_PER_HOUR)
  const x = (min) => ((min - fromH * 60) / spanMin) * width
  const hours = Array.from({ length: toH - fromH + 1 }, (_, i) => fromH + i)
  const nowInside = nowMin >= fromH * 60 && nowMin <= toH * 60

  return (
    <section className="card dash-section agenda" aria-label="Agenda">
      <h2>Agenda</h2>

      {allDay.length > 0 && (
        <div className="agenda-allday">
          {allDay.map((e, i) => (
            <span key={i} className="chip">{e.title}</span>
          ))}
        </div>
      )}

      {timed.length > 0 && (
        <div className="agenda-scroll">
          <div className="agenda-timeline" style={{ width }}>
            <div className="agenda-hours" aria-hidden="true">
              {hours.map((h) => (
                <span key={h} className="agenda-tick" style={{ left: x(h * 60) }}>
                  {pad(h)}h
                </span>
              ))}
            </div>

            <div className="agenda-track">
              {timed.map((e, i) => {
                const left = x(hm(e.time))
                const w = Math.max(18, (e.durationMinutes / spanMin) * width)
                return (
                  <span
                    key={i}
                    className="agenda-block"
                    style={{ left, width: w }}
                    title={`${e.time}${e.end ? `–${e.end}` : ''} · ${e.title}`}
                  >
                    <b>{e.title}</b>
                    <i>{e.time}</i>
                  </span>
                )
              })}
              {nowInside && (
                <span className="agenda-now" style={{ left: x(nowMin) }} aria-label="maintenant" />
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
