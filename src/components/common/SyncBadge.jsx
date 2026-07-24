import { IconSync } from './Icons.jsx'

const STATE_LABEL = {
  idle: 'Prêt',
  syncing: 'Synchro…',
  ok: 'À jour',
  offline: 'Hors ligne',
  auth: 'Auth',
  conflict: 'Conflit',
  blocked: 'Bloqué',
  disabled: 'Inactif',
  error: 'Erreur',
}

// Combine both remotes into one worst-case dot + label.
function summarize(status) {
  const states = [status.github.state, status.drive.state]
  const rank = ['error', 'auth', 'conflict', 'blocked', 'offline', 'syncing', 'ok', 'disabled', 'idle']
  if (status.running || states.includes('syncing')) return 'syncing'
  for (const s of rank) if (states.includes(s)) return s
  return 'idle'
}

export function SyncBadge({ status, onClick }) {
  const state = summarize(status)
  const label = STATE_LABEL[state] || state
  return (
    <button className="sync-pill" onClick={onClick} title="Synchroniser maintenant" type="button">
      <span className={`sync-dot ${state}`} />
      <IconSync width={14} height={14} />
      <span className="sync-label">{label}</span>
    </button>
  )
}
