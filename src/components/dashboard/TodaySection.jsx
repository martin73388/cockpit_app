import { useState } from 'react'
import { store } from '../../data/store.js'
import { useStore } from '../../hooks/useStore.js'
import { todayISO, isOverdue, dueLabel, daysSince, slotLabel, formatDuration } from '../../utils/dates.js'
import { scheduledOn } from '../../utils/recurrence.js'

// Temps estimé + sous-tâches cochables, directement dans le plan du jour :
// on doit pouvoir avancer une tâche sans quitter le Dashboard.
function Estimate({ todo }) {
  if (!(todo.estimateMinutes > 0)) return null
  return <span className="chip estimate-chip" title="Temps estimé">⏱ {formatDuration(todo.estimateMinutes)}</span>
}

function TodaySubtasks({ todo }) {
  if (!todo.subtasks.length) return null
  return (
    <ul className="today-subtasks">
      {todo.subtasks.map((st) => (
        <li key={st.id} className={st.done ? 'done' : ''}>
          <label>
            <input
              type="checkbox"
              className="check check-sm"
              checked={st.done}
              onChange={() => store.toggleSubtask(todo.id, st.id)}
            />
            <span>{st.title}</span>
          </label>
        </li>
      ))}
    </ul>
  )
}

// Section 3 — today: scheduled slots that have come due, overdue todos (red)
// then due-today, checkable in place; waiting todos whose follow-up date is due
// surface as « à relancer » ; habits planned today with a completion check.
// A collapsible « En attente (n) » block keeps every waiting subject visible
// (age + ⚠ guard after 7 days without a follow-up date) — the anti-oubli net.
export function TodaySection() {
  const todos = useStore((s) => s.todos)
  const habits = useStore((s) => s.habits)
  const [waitingOpen, setWaitingOpen] = useState(false)
  const today = todayISO()

  const focusToday = todos.filter((t) => t.status === 'todo' && t.focus && t.focus.date === today)
  const focusIds = new Set(focusToday.map((t) => t.id))
  // Créneaux arrivés à échéance : le jour J (ou un créneau manqué), la tâche
  // planifiée revient d'elle-même sous les yeux, triée par heure.
  const slotDue = todos
    .filter((t) => t.status === 'scheduled' && t.scheduled && t.scheduled.date <= today)
    .sort(
      (a, b) =>
        (a.scheduled.date < b.scheduled.date ? -1 : a.scheduled.date > b.scheduled.date ? 1 : 0) ||
        (a.scheduled.time || '99:99').localeCompare(b.scheduled.time || '99:99'),
    )
  // Une tâche planifiée est exclue des « en retard » : son plan, c'est son
  // créneau — elle remontera le jour dit, même si son échéance est dépassée.
  const overdue = todos
    .filter((t) => t.status !== 'waiting' && t.status !== 'scheduled' && !focusIds.has(t.id) && isOverdue(t, today))
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
  const dueToday = todos.filter((t) => t.status === 'todo' && !focusIds.has(t.id) && t.dueDate === today)
  const waiting = todos.filter((t) => t.status === 'waiting')
  const followUps = waiting.filter((t) => t.waiting?.followUpDate && t.waiting.followUpDate <= today)
  const plannedHabits = habits.filter((h) => h.active && scheduledOn(h, today))

  const empty =
    focusToday.length === 0 &&
    slotDue.length === 0 &&
    overdue.length === 0 &&
    dueToday.length === 0 &&
    followUps.length === 0 &&
    plannedHabits.length === 0

  return (
    <section className="card dash-section" aria-label="Aujourd'hui">
      <h2>Aujourd'hui</h2>
      {empty && waiting.length === 0 && <p className="muted">Rien de planifié aujourd'hui.</p>}
      {empty && waiting.length > 0 && <p className="muted">Rien à faire — {waiting.length} sujet{waiting.length > 1 ? 's' : ''} en attente ci-dessous.</p>}

      {focusToday.map((t) => (
        <div key={t.id} className={`today-line ${isOverdue(t, today) ? 'overdue' : ''}`}>
          <input
            type="checkbox"
            className="check check-sm"
            checked={false}
            onChange={() => store.toggleTodoDone(t.id)}
            aria-label={`Terminer ${t.title}`}
          />
          <span className="today-title">⭐ {t.title}</span>
          {t.focus.count > 0 && (
            <span className={`chip rollover-chip ${t.focus.count >= 4 ? 'overdue' : ''}`} title={t.focus.count >= 4 ? 'Reportée 4 fois — tranche : attente, échéance ou retirer du focus' : ''}>
              ↻ ×{t.focus.count}
            </span>
          )}
          <Estimate todo={t} />
          {t.dueDate && <span className={`chip ${isOverdue(t, today) ? 'overdue' : ''}`}>{dueLabel(t.dueDate, today)}</span>}
          <TodaySubtasks todo={t} />
        </div>
      ))}

      {slotDue.map((t) => (
        <div key={t.id} className={`today-line ${t.scheduled.date < today ? 'overdue' : ''}`}>
          <input
            type="checkbox"
            className="check check-sm"
            checked={false}
            onChange={() => store.toggleTodoDone(t.id)}
            aria-label={`Terminer ${t.title}`}
          />
          <span className="today-title">📅 {t.title}</span>
          <span className={`chip ${t.scheduled.date < today ? 'overdue' : ''}`}>
            {slotLabel(t.scheduled, today)}
          </span>
          <Estimate todo={t} />
          <TodaySubtasks todo={t} />
        </div>
      ))}

      {followUps.map((t) => (
        <div key={t.id} className={`today-line ${t.waiting.followUpDate < today ? 'overdue' : ''}`}>
          <span aria-hidden="true">📩</span>
          <span className="today-title">
            Relancer : {t.title}
            {t.waiting.note && <span className="muted"> — {t.waiting.note}</span>}
          </span>
          <button className="btn btn-sm" onClick={() => store.resumeTodo(t.id)} title="Reprendre la tâche">
            Reprendre
          </button>
        </div>
      ))}

      {[...overdue, ...dueToday].map((t) => (
        <div key={t.id} className={`today-line ${isOverdue(t, today) ? 'overdue' : ''}`}>
          <input
            type="checkbox"
            className="check check-sm"
            checked={t.done}
            onChange={() => store.toggleTodoDone(t.id)}
            aria-label={`Terminer ${t.title}`}
          />
          <span className="today-title">{t.title}</span>
          <span className={`chip ${isOverdue(t, today) ? 'overdue' : ''}`}>{dueLabel(t.dueDate, today)}</span>
          <Estimate todo={t} />
          <TodaySubtasks todo={t} />
        </div>
      ))}

      {plannedHabits.map((h) => {
        const done = h.completions.includes(today)
        return (
          <div key={h.id} className={`today-line habit ${done ? 'done' : ''}`}>
            <input
              type="checkbox"
              className="check check-sm"
              checked={done}
              onChange={() => store.toggleHabitCompletion(h.id, today)}
              aria-label={`Fait aujourd'hui : ${h.title}`}
            />
            <span className="today-title">{h.title}</span>
            <span className="chip">{h.schedule.time || 'Dans la journée'}</span>
          </div>
        )
      })}

      {waiting.length > 0 && (
        <div className="waiting-block">
          <button className="btn btn-ghost btn-sm" onClick={() => setWaitingOpen((o) => !o)} aria-expanded={waitingOpen}>
            📩 En attente ({waiting.length}) {waitingOpen ? '▾' : '▸'}
          </button>
          {waitingOpen &&
            waiting.map((t) => {
              const stale = !t.waiting.followUpDate && daysSince(t.waiting.since) > 7
              return (
                <div key={t.id} className="today-line waiting">
                  <span className="today-title">
                    {t.title}
                    {t.waiting.note && <span className="muted"> — {t.waiting.note}</span>}
                  </span>
                  <span className={`chip ${stale ? 'overdue' : ''}`} title={stale ? 'Plus de 7 jours sans date de relance' : ''}>
                    {stale ? '⚠ ' : ''}
                    {daysSince(t.waiting.since)} j
                  </span>
                  <button className="btn btn-sm btn-ghost" onClick={() => store.resumeTodo(t.id)} title="Reprendre">
                    Reprendre
                  </button>
                </div>
              )
            })}
        </div>
      )}
    </section>
  )
}
