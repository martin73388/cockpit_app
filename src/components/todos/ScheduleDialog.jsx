import { useEffect, useState } from 'react'
import { store } from '../../data/store.js'
import { SLOT_DURATIONS } from '../../data/model.js'
import { todayISO, addDaysISO, formatDueDate } from '../../utils/dates.js'
import { TimeSelect } from '../common/TimeSelect.jsx'
import { IconX } from '../common/Icons.jsx'

// « Planifier » : réserver un créneau. La tâche sort de À faire et le robot
// dépose l'événement dans l'agenda — la validation reste manuelle, le jour venu.
export function ScheduleDialog({ todo, onClose }) {
  const today = todayISO()
  const s = todo.scheduled
  const [date, setDate] = useState(s?.date || today)
  const [time, setTime] = useState(s?.time || '')
  // À défaut de créneau existant, on part du temps estimé de la tâche : le
  // créneau réservé colle alors à ce qu'elle demande vraiment.
  const [durationMinutes, setDuration] = useState(s?.durationMinutes || todo.estimateMinutes || 60)

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Raccourcis : sur petit écran, taper une date au clavier est pénible.
  const presets = [
    { label: "Aujourd'hui", value: today },
    { label: 'Demain', value: addDaysISO(today, 1) },
    { label: formatDueDate(addDaysISO(today, 7), today), value: addDaysISO(today, 7) },
  ]

  function confirm() {
    if (!date) return
    store.scheduleTodo(todo.id, { date, time, durationMinutes })
    onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Planifier la tâche">
        <div className="modal-head">
          <h2>📅 Planifier</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Fermer">
            <IconX />
          </button>
        </div>
        <div className="modal-body form-grid">
          <p className="muted" style={{ margin: 0 }}>
            « {todo.title} » quitte la liste À faire et prend un créneau dans ton agenda.
            Elle revient dans « Aujourd'hui » le jour venu — c'est toi qui la valides.
          </p>

          <div>
            <span className="label">Quand ?</span>
            <div className="slot-presets" role="group" aria-label="Raccourcis de date">
              {presets.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className="chip"
                  aria-pressed={date === p.value}
                  onClick={() => setDate(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="date"
              className="input"
              style={{ marginTop: 8 }}
              autoFocus
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Date du créneau"
            />
          </div>

          <div className="form-row">
            <div>
              <label className="label" htmlFor="slot-time-h">Heure (optionnel)</label>
              <TimeSelect id="slot-time-h" time={time} onChange={setTime} emptyLabel="— journée" />
            </div>
            <div>
              <label className="label" htmlFor="slot-duration">Durée</label>
              <select
                id="slot-duration"
                className="select"
                value={durationMinutes}
                disabled={!time}
                onChange={(e) => setDuration(Number(e.target.value))}
              >
                {/* Une durée hors presets (fichier édité à la main) reste
                    affichable : sinon le <select> mentirait sur l'état réel. */}
                {(SLOT_DURATIONS.includes(durationMinutes)
                  ? SLOT_DURATIONS
                  : [...SLOT_DURATIONS, durationMinutes].sort((a, b) => a - b)
                ).map((d) => (
                  <option key={d} value={d}>{d} min</option>
                ))}
              </select>
            </div>
          </div>

          <p className="faint" style={{ fontSize: 12, margin: 0 }}>
            Sans heure, l'événement est posé sur la journée entière. Si le créneau passe
            sans que tu valides, la tâche remonte en alerte.
          </p>
        </div>
        <div className="modal-foot">
          {todo.scheduled && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                store.unscheduleTodo(todo.id)
                onClose()
              }}
            >
              Déplanifier
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={confirm} disabled={!date}>
            Planifier
          </button>
        </div>
      </div>
    </div>
  )
}
