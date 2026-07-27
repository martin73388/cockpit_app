import { formatDuration, dueLabel } from '../../utils/dates.js'

// Mini-planning des créneaux de travail — volontairement minuscule.
//
// Deux usages, même composant :
//   • bande de lecture en haut des Todos (onPick absent) : on voit la semaine
//     d'un coup d'œil, une ligne, défilement horizontal ;
//   • sélecteur dans le dialogue « Planifier » (onPick fourni) : on tape un
//     créneau et la tâche se pose dedans, à la suite de ce qui s'y trouve déjà.
//
// Aucun détail : jour, heure, et ce qu'il reste de libre. Rien d'autre.
export function WorkSlots({ slots, today, onPick, selectedKey }) {
  if (!slots || slots.length === 0) return null
  return (
    <div className="work-slots" role={onPick ? 'group' : undefined} aria-label="Créneaux de travail">
      {slots.map((s) => {
        const full = s.free === 0
        const pct = s.durationMinutes > 0 ? Math.min(100, Math.round((s.used / s.durationMinutes) * 100)) : 0
        const label = `${dueLabel(s.date, today)} ${s.time.replace(':', 'h')}`
        const hint = full ? 'complet' : `reste ${formatDuration(s.free)}`
        const inner = (
          <>
            <span className="slot-when">{label}</span>
            <span className="slot-free">{hint}</span>
            <span className="slot-bar" aria-hidden="true">
              <i style={{ width: `${pct}%` }} />
            </span>
          </>
        )
        const cls = `work-slot ${full ? 'full' : ''} ${selectedKey === s.key ? 'on' : ''}`
        return onPick ? (
          <button
            key={s.key}
            type="button"
            className={cls}
            aria-pressed={selectedKey === s.key}
            // Un créneau plein n'est pas sélectionnable : y poser une tâche la
            // ferait démarrer à la seconde où le créneau se termine.
            disabled={full}
            onClick={() => onPick(s)}
            title={`${s.title} — ${formatDuration(s.durationMinutes)}, ${hint}`}
          >
            {inner}
          </button>
        ) : (
          <span key={s.key} className={cls} title={`${s.title} — ${formatDuration(s.durationMinutes)}, ${hint}`}>
            {inner}
          </span>
        )
      })}
    </div>
  )
}
