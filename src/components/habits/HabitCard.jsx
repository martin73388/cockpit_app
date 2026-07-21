import { store } from '../../data/store.js'
import { describeSchedule } from '../../utils/recurrence.js'
import { ConfirmDelete } from '../common/ConfirmDelete.jsx'
import { IconEdit } from '../common/Icons.jsx'

// Calendar-sync indicator is DISPLAY-ONLY. The app never calls a calendar API;
// it only writes calendarSync:"pending". The assistant (outside the app) creates/
// updates/removes the recurring event and flips this to "synced" / "off".
const SYNC_VIEW = {
  pending: { symbol: '⏳', label: 'En attente agenda' },
  synced: { symbol: '✓', label: 'Agenda synchronisé' },
  off: { symbol: '—', label: 'Agenda désactivé' },
}

export function HabitCard({ habit, onEdit }) {
  const sync = SYNC_VIEW[habit.calendarSync] || SYNC_VIEW.pending
  return (
    <div className={`card habit-card ${habit.active ? '' : 'paused'}`}>
      <div className="habit-card-head">
        <h3>{habit.title || <span className="faint">(sans titre)</span>}</h3>
        <span className={`cal-sync ${habit.calendarSync}`} title={sync.label} aria-label={sync.label}>
          <span aria-hidden="true">{sync.symbol}</span>
        </span>
      </div>

      <div className="habit-recurrence">{describeSchedule(habit.schedule)}</div>
      {habit.notes && <div className="habit-notes">{habit.notes}</div>}

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
