import { store } from '../../data/store.js'
import { useStore } from '../../hooks/useStore.js'
import { todayISO, isOverdue, dueLabel } from '../../utils/dates.js'
import { scheduledOn } from '../../utils/recurrence.js'

// Section 3 — today: overdue todos (red) then due-today, checkable in place;
// habits planned today with a completion check (adds/removes today's date in
// completions), showing their time or "Dans la journée".
export function TodaySection() {
  const todos = useStore((s) => s.todos)
  const habits = useStore((s) => s.habits)
  const today = todayISO()

  const overdue = todos.filter((t) => isOverdue(t, today)).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
  const dueToday = todos.filter((t) => !t.done && t.dueDate === today)
  const plannedHabits = habits.filter((h) => h.active && scheduledOn(h, today))

  const empty = overdue.length === 0 && dueToday.length === 0 && plannedHabits.length === 0

  return (
    <section className="card dash-section" aria-label="Aujourd'hui">
      <h2>Aujourd'hui</h2>
      {empty && <p className="muted">Rien de planifié aujourd'hui.</p>}

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
    </section>
  )
}
