import { SyncBadge } from './common/SyncBadge.jsx'
import { IconGear } from './common/Icons.jsx'

const TABS = [
  { id: 'dashboard', label: 'Dashboard', disabled: true },
  { id: 'todos', label: 'Todos' },
  { id: 'habits', label: 'Habitudes' },
]

export function Header({ tab, onTab, status, onSyncNow, onOpenSettings }) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" />
          Cockpit
        </div>
        <span className="header-spacer" />
        <SyncBadge status={status} onClick={onSyncNow} />
        <button
          className="tab"
          aria-current={tab === 'settings' ? 'page' : undefined}
          onClick={onOpenSettings}
          title="Réglages"
          aria-label="Réglages"
        >
          <IconGear />
        </button>
      </div>
      <nav className="nav-tabs" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            className="tab"
            disabled={t.disabled}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => !t.disabled && onTab(t.id)}
          >
            {t.label}
            {t.disabled && <span className="badge badge-soon">Bientôt</span>}
          </button>
        ))}
      </nav>
    </header>
  )
}
