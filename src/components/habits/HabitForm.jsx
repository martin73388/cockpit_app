import { useState } from 'react'
import { FREQUENCIES, FREQUENCY_LABEL, DAYS, DAY_LABEL, PILLARS, PILLAR_LABEL } from '../../data/model.js'
import { todayISO } from '../../utils/dates.js'
import { TimeSelect } from '../common/TimeSelect.jsx'

const DURATION_PRESETS = [15, 30, 45, 60, 90]

function initialFrom(habit) {
  const s = (habit && habit.schedule) || {}
  return {
    title: habit?.title || '',
    notes: habit?.notes || '',
    pillar: habit?.pillar ?? null,
    frequency: s.frequency || 'daily',
    daysOfWeek: Array.isArray(s.daysOfWeek) ? s.daysOfWeek : [],
    time: s.time || '',
    durationMinutes: Number.isFinite(s.durationMinutes) ? s.durationMinutes : 30,
    anchorDate: s.anchorDate || '',
  }
}

// Reusable habit form for create + edit. onSubmit receives {title, notes, schedule}.
export function HabitForm({ habit, onSubmit, onCancel, submitLabel = 'Enregistrer' }) {
  const [f, setF] = useState(() => initialFrom(habit))
  const [error, setError] = useState('')
  const set = (patch) => setF((prev) => ({ ...prev, ...patch }))

  function toggleDay(d) {
    set({ daysOfWeek: f.daysOfWeek.includes(d) ? f.daysOfWeek.filter((x) => x !== d) : [...f.daysOfWeek, d] })
  }

  function submit() {
    if (!f.title.trim()) return setError('Le titre est requis.')
    const needsDays = f.frequency === 'weekly' || f.frequency === 'biweekly'
    if (needsDays && f.daysOfWeek.length === 0) return setError('Choisissez au moins un jour.')
    setError('')
    onSubmit({
      title: f.title.trim(),
      notes: f.notes.trim(),
      pillar: f.pillar,
      schedule: {
        frequency: f.frequency,
        daysOfWeek: needsDays ? DAYS.filter((d) => f.daysOfWeek.includes(d)) : [],
        time: f.time,
        durationMinutes: Number(f.durationMinutes) || 0,
        // anchorDate is REQUIRED for biweekly (week parity); defaults to today.
        anchorDate: f.frequency === 'biweekly' ? f.anchorDate || todayISO() : '',
      },
    })
  }

  return (
    <div className="form-grid">
      <div>
        <label className="label" htmlFor="habit-title">Titre</label>
        <input id="habit-title" className="input" value={f.title} autoFocus onChange={(e) => set({ title: e.target.value })} placeholder="Ex. Méditation" />
      </div>

      <div className="form-row">
        <div>
          <label className="label" htmlFor="habit-freq">Fréquence</label>
          <select id="habit-freq" className="select" value={f.frequency} onChange={(e) => set({ frequency: e.target.value })}>
            {FREQUENCIES.map((fr) => (
              <option key={fr} value={fr}>{FREQUENCY_LABEL[fr]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="habit-time-h">Heure (optionnel)</label>
          <TimeSelect id="habit-time-h" time={f.time} onChange={(time) => set({ time })} />
        </div>
      </div>

      {(f.frequency === 'weekly' || f.frequency === 'biweekly') && (
        <div>
          <span className="label">Jours</span>
          <div className="day-picker" role="group" aria-label="Jours de la semaine">
            {DAYS.map((d) => (
              <button key={d} type="button" aria-pressed={f.daysOfWeek.includes(d)} onClick={() => toggleDay(d)}>
                {DAY_LABEL[d]}
              </button>
            ))}
          </div>
        </div>
      )}

      {f.frequency === 'biweekly' && (
        <div>
          <label className="label" htmlFor="habit-anchor">À partir du</label>
          <input
            id="habit-anchor"
            type="date"
            className="input"
            value={f.anchorDate || todayISO()}
            onChange={(e) => set({ anchorDate: e.target.value })}
          />
          <p className="faint" style={{ fontSize: 12, margin: '4px 0 0' }}>
            Fixe la parité des semaines (« une semaine sur deux » à partir de cette date).
          </p>
        </div>
      )}

      <div>
        <span className="label">Pilier</span>
        <div className="segmented pillar-picker" role="group" aria-label="Pilier de vie">
          <button type="button" aria-pressed={f.pillar === null} onClick={() => set({ pillar: null })}>
            Aucun
          </button>
          {PILLARS.map((p) => (
            <button key={p} type="button" aria-pressed={f.pillar === p} onClick={() => set({ pillar: p })}>
              {PILLAR_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="habit-duration">Durée (minutes)</label>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input
            id="habit-duration"
            type="number"
            min="0"
            step="5"
            className="input"
            style={{ width: 110 }}
            value={f.durationMinutes}
            onChange={(e) => set({ durationMinutes: e.target.value })}
          />
          <div className="segmented">
            {DURATION_PRESETS.map((m) => (
              <button key={m} type="button" aria-pressed={Number(f.durationMinutes) === m} onClick={() => set({ durationMinutes: m })}>
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="habit-notes">Notes</label>
        <textarea id="habit-notes" className="textarea" value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{error}</p>}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {onCancel && <button className="btn btn-ghost" onClick={onCancel}>Annuler</button>}
        <button className="btn btn-primary" onClick={submit}>{submitLabel}</button>
      </div>
    </div>
  )
}
