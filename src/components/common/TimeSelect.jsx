// Heure en deux <select> (heure + minutes). time est "HH:MM" ou "" (pas d'heure).
// Deux <select> plutôt qu'un input type="time" : le sélecteur natif Android
// s'affiche sans bouton de validation sur certains appareils (Jelly Star 2).
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTE_STEPS = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']

export function TimeSelect({ time, onChange, id, emptyLabel = '— aucune' }) {
  const [h, m] = time ? time.split(':') : ['', '00']
  // Une valeur de minutes hors pas de 5 (fichier édité à la main) reste affichable.
  const minutes = m && !MINUTE_STEPS.includes(m) ? [...MINUTE_STEPS, m].sort() : MINUTE_STEPS
  return (
    <div className="row">
      <select
        id={id}
        className="select"
        value={h}
        onChange={(e) => onChange(e.target.value === '' ? '' : `${e.target.value}:${m || '00'}`)}
        aria-label="Heure"
      >
        <option value="">{emptyLabel}</option>
        {HOURS.map((hh) => (
          <option key={hh} value={hh}>{hh} h</option>
        ))}
      </select>
      <select
        className="select"
        value={m}
        disabled={h === ''}
        onChange={(e) => onChange(`${h}:${e.target.value}`)}
        aria-label="Minutes"
      >
        {minutes.map((mm) => (
          <option key={mm} value={mm}>{mm}</option>
        ))}
      </select>
    </div>
  )
}
