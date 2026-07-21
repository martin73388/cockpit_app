import { useEffect, useMemo, useRef, useState } from 'react'
import { store } from './data/store.js'
import { getUi, setUi } from './data/ui.js'
import { getGithubConfig, getDriveConfig } from './data/config.js'
import { createEngine } from './sync/engine.js'
import { fetchProjects, loadCachedProjects } from './sync/projects.js'
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
  const [projects, setProjects] = useState(loadCachedProjects)
  const engineRef = useRef(null)

  // Persisted UI prefs helper.
  function updateUi(patch) {
    setUiState(setUi(patch))
  }

  // Theme.
  useEffect(() => applyTheme(ui.theme), [ui.theme])

  // Refresh the project dropdown from Radar + Carnet via the Drive gateway.
  const refreshProjects = useMemo(
    () => () => {
      fetchProjects(getDriveConfig()).then(setProjects).catch(() => {})
    },
    [],
  )

  // Sync engine — a SINGLE instance (created once), reused across mounts.
  // Creating it per-effect would spawn two concurrent engines under StrictMode's
  // double-mount; a single instance lets its internal mutex coalesce the two
  // launch syncs instead. It reads config live each cycle.
  if (!engineRef.current) {
    engineRef.current = createEngine({ store, getGithubConfig, getDriveConfig, onStatus: setStatus })
  }
  useEffect(() => {
    const engine = engineRef.current
    engine.start()
    refreshProjects()
    return () => engine.stop()
  }, [refreshProjects])

  function syncNow() {
    engineRef.current?.sync('manual').then(refreshProjects)
  }
  function onConfigChanged() {
    // Config lives in localStorage and is read live by the engine; just re-sync.
    engineRef.current?.sync('config').then(refreshProjects)
  }

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
        {tab === 'dashboard' && <DashboardView />}
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
    </div>
  )
}
