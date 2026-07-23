import { briefStatus } from '../../sync/brief.js'

const SOURCE_DOT = { radar: '📡', carnet: '📓', cockpit: '🧭', gmail: '✉️' }

// Section 2 — daily brief (read-only JSON deposited by the assistant).
export function BriefSection({ brief }) {
  const { status, brief: b } = briefStatus(brief)

  if (status !== 'ok') {
    return (
      <section className="card dash-section" aria-label="Brief du jour">
        <h2>Brief du jour</h2>
        <p className="muted">Pas de brief aujourd'hui — demande ton point du matin à l'assistant.</p>
      </section>
    )
  }

  return (
    <section className="card dash-section brief" aria-label="Brief du jour">
      <div className="row brief-head">
        <h2>Brief du jour</h2>
        {b.countdown && Number.isFinite(b.countdown.days) && (
          <span className="chip countdown" title={b.countdown.label}>
            {b.countdown.label} : J-{b.countdown.days}
          </span>
        )}
      </div>
      {b.headline && <p className="brief-headline">{b.headline}</p>}

      {b.agenda.length > 0 && (
        <div className="brief-block">
          <span className="label">Agenda</span>
          {b.agenda.map((a, i) => (
            <div key={i} className="brief-line">
              <span className="brief-time">{a.time}</span> {a.title}
            </div>
          ))}
        </div>
      )}

      {b.priorities.length > 0 && (
        <div className="brief-block">
          <span className="label">Priorités</span>
          {b.priorities.map((p, i) => (
            <div key={i} className="brief-line">
              <span title={p.source} aria-label={p.source}>{SOURCE_DOT[p.source]}</span> <strong>{p.title}</strong>
              {p.detail && <span className="muted"> — {p.detail}</span>}
            </div>
          ))}
        </div>
      )}

      {b.mails.length > 0 && (
        <div className="brief-block">
          <span className="label">Mails</span>
          {b.mails.map((m, i) => (
            <div key={i} className="brief-line">
              <strong>{m.from}</strong> — {m.subject}
              {m.why && <span className="muted"> ({m.why})</span>}
            </div>
          ))}
        </div>
      )}

      {b.alerts.length > 0 && (
        <div className="brief-block">
          <span className="label">Alertes du brief</span>
          {b.alerts.map((a, i) => (
            <div key={i} className="brief-line alert-line">⚠ {a}</div>
          ))}
        </div>
      )}

      {b.life && b.life.note && <p className="brief-life muted">{b.life.note}</p>}
    </section>
  )
}
