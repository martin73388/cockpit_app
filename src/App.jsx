import { useEffect, useMemo, useRef, useState } from 'react'
import { store } from './data/store.js'
import { getUi, setUi } from './data/ui.js'
import { getGithubConfig, getDriveConfig } from './data/config.js'
import { createEngine } from './sync/engine.js'
import { fetchSources, loadCachedSources, projectsOf } from './sync/sources.js'
import { fetchBrief, loadCachedBrief } from './sync/brief.js'
import { Header } from './components/Header.jsx'
import { TodosView } from './components/todos/TodosView.jsx'
import { HabitsView } from './components/habits/HabitsView.jsx'
import { DashboardView } from './components/dashboard/DashboardView.jsx'
import { SettingsView } from './components/settings/SettingsView.jsx'

function applyTheme(theme) {
  const root = document.documentElement
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme)
  else root.removeAttribute('data-theme')
}

export default function App() {
  const [ui, setUiState] = useState(getUi)
  const [status, setStatus] = useState(() => ({
    running: false,
    github: { state: 'idle', message: '', at: null },
    drive: { state: 'idle', message: '', at: null },
  }))
  const [sources, setSources] = useState(loadCachedSources)
  const [brief, setBrief] = useState(loadCachedBrief)
  const [updateReady, setUpdateReady] = useState(false)
  const engineRef = useRef(null)

  // Persisted UI prefs helper (the active tab itself is session-only).
  // Merge over the in-memory state — NOT over getUi(), whose tab is always the
  // 'dashboard' default: rebuilding from storage would yank the user out of
  // their current tab on any pref change (layout, sort, theme…).
  function updateUi(patch) {
    setUiState((prev) => {
      const next = { ...prev, ...patch }
      setUi(next) // persists everything except the tab
      return next
    })
  }

  // Theme.
  useEffect(() => applyTheme(ui.theme), [ui.theme])

  // Refresh the read-only sources (Radar + Carnet + daily brief) — called on
  // EVERY sync cycle (launch / focus / online / manual), not just at launch.
  const refreshSources = useMemo(
    () => () => {
      const cfg = getDriveConfig()
      fetchSources(cfg).then(setSources).catch(() => {})
      fetchBrief(cfg).then(setBrief).catch(() => {})
    },
    [],
  )

  // Sync engine — a SINGLE instance (created once), reused across mounts.
  // Creating it per-effect would spawn two concurrent engines under StrictMode's
  // double-mount; a single instance lets its internal mutex coalesce the two
  // launch syncs instead. It reads config live each cycle.
  if (!engineRef.current) {
    engineRef.current = createEngine({
      store,
      getGithubConfig,
      getDriveConfig,
      onStatus: setStatus,
      onCycleEnd: refreshSources,
    })
  }
  useEffect(() => {
    const engine = engineRef.current
    engine.start()
    store.purgeProcessedInbox() // silent 30-day purge of processed inbox items
    return () => engine.stop()
  }, [])

  // New service worker took control -> offer a refresh (avoids serving the old
  // version indefinitely).
  useEffect(() => {
    const onUpdated = () => setUpdateReady(true)
    window.addEventListener('cockpit:sw-updated', onUpdated)
    return () => window.removeEventListener('cockpit:sw-updated', onUpdated)
  }, [])

  function syncNow() {
    engineRef.current?.sync('manual')
  }
  function onConfigChanged() {
    // Config lives in localStorage and is read live by the engine; just re-sync.
    engineRef.current?.sync('config')
  }

  const projects = useMemo(() => projectsOf(sources), [sources])

  const tab = ui.tab
  function setTab(t) {
    updateUi({ tab: t })
  }

  return (
    <div className="app-shell">
      <Header
        tab={tab}
        onTab={setTab}
        status={status}
        onSyncNow={syncNow}
        onOpenSettings={() => setTab('settings')}
      />
      <main className="container">
        {tab === 'dashboard' && <DashboardView sources={sources} brief={brief} />}
        {tab === 'todos' && <TodosView projects={projects} ui={ui} onUi={updateUi} />}
        {tab === 'habits' && <HabitsView />}
        {tab === 'settings' && (
          <SettingsView
            status={status}
            onSyncNow={syncNow}
            onConfigChanged={onConfigChanged}
            theme={ui.theme}
            onTheme={(t) => updateUi({ theme: t })}
          />
        )}
      </main>
      {updateReady && (
        <div className="toast update-toast" role="status">
          Nouvelle version disponible
          <button className="btn btn-sm btn-primary" onClick={() => window.location.reload()}>
            Recharger
          </button>
        </div>
      )}
    </div>
  )
}
