import { store } from '../../data/store.js'
import { PILLAR_LABEL, DAY_LABEL } from '../../data/model.js'
import { describeSchedule, scheduledOn, dayCodeOf, addDaysISO } from '../../utils/recurrence.js'
import { todayISO } from '../../utils/dates.js'
import { ConfirmDelete } from '../common/ConfirmDelete.jsx'
import { IconEdit } from '../common/Icons.jsx'

// Calendar-sync indicator is DISPLAY-ONLY. The app never calls a calendar API;
// it only writes calendarSync:"pending". The robot (outside the app) creates/
// updates/removes the recurring event and flips this to "synced" / "off".
const SYNC_VIEW = {
  pending: { symbol: '⏳', label: 'En attente agenda' },
  synced: { symbol: '✓', label: 'Agenda synchronisé' },
  off: { symbol: '—', label: 'Agenda désactivé' },
}

// Rolling 7-day mini-history ending today: done / planned-not-done / not planned.
// No streak counter (v3+).
function HistoryDots({ habit, today }) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(today, i - 6))
  return (
    <div className="history-dots" aria-label="Historique 7 jours">
      {days.map((d) => {
        const done = habit.completions.includes(d)
        const planned = habit.active && scheduledOn(habit, d)
        const cls = done ? 'done' : planned ? 'missed' : 'off'
        const label = `${DAY_LABEL[dayCodeOf(d)]} ${d.slice(8)} : ${done ? 'fait' : planned ? 'prévu, non fait' : 'non prévu'}`
        return <span key={d} className={`dot ${cls} ${d === today ? 'today' : ''}`} title={label} aria-label={label} />
      })}
    </div>
  )
}

export function HabitCard({ habit, onEdit }) {
  const sync = SYNC_VIEW[habit.calendarSync] || SYNC_VIEW.pending
  const today = todayISO()
  const plannedToday = habit.active && scheduledOn(habit, today)
  const doneToday = habit.completions.includes(today)

  return (
    <div className={`card habit-card ${habit.active ? '' : 'paused'}`}>
      <div className="habit-card-head">
        <h3>{habit.title || <span className="faint">(sans titre)</span>}</h3>
        {habit.pillar && <span className="chip pillar-chip">{PILLAR_LABEL[habit.pillar]}</span>}
        <span className={`cal-sync ${habit.calendarSync}`} title={sync.label} aria-label={sync.label}>
          <span aria-hidden="true">{sync.symbol}</span>
        </span>
      </div>

      <div className="habit-recurrence">{describeSchedule(habit.schedule)}</div>
      {habit.notes && <div className="habit-notes">{habit.notes}</div>}

      <HistoryDots habit={habit} today={today} />

      {plannedToday && (
        <label className={`habit-today ${doneToday ? 'done' : ''}`}>
          <input
            type="checkbox"
            className="check check-sm"
            checked={doneToday}
            onChange={() => store.toggleHabitCompletion(habit.id, today)}
          />
          Fait aujourd'hui
        </label>
      )}

      <div className="habit-card-foot">
        <button
          className="switch"
          role="switch"
          aria-checked={habit.active}
          onClick={() => store.toggleHabitActive(habit.id)}
          aria-label={habit.active ? 'Mettre en pause' : 'Activer'}
        />
        <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
          {habit.active ? 'Active' : 'En pause'}
        </span>
        <span className="spacer" />
        <button className="btn btn-ghost btn-icon" onClick={() => onEdit(habit.id)} title="Modifier" aria-label="Modifier">
          <IconEdit />
        </button>
        <ConfirmDelete onConfirm={() => store.deleteHabit(habit.id)} />
      </div>
    </div>
  )
}
