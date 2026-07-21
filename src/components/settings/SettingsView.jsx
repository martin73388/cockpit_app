import { useState } from 'react'
import { getGithubConfig, setGithubConfig, getDriveConfig, setDriveConfig, DEFAULT_DRIVE } from '../../data/config.js'
import { IconSync } from '../common/Icons.jsx'

const STATE_TEXT = {
  idle: 'Prêt',
  syncing: 'Synchronisation…',
  ok: 'À jour',
  offline: 'Hors ligne',
  auth: 'Authentification refusée',
  conflict: 'Conflit persistant',
  blocked: 'Fichier distant non-Cockpit (écriture bloquée)',
  disabled: 'Non configuré',
  error: 'Erreur',
}

function StatusLine({ remote }) {
  const when = remote.at ? new Date(remote.at).toLocaleTimeString('fr-FR') : null
  return (
    <div className="row" style={{ gap: 8, marginTop: 4 }}>
      <span className={`sync-dot ${remote.state}`} />
      <span className="muted" style={{ fontSize: 13 }}>
        {STATE_TEXT[remote.state] || remote.state}
        {remote.state === 'ok' && when ? ` · ${when}` : ''}
        {remote.message && remote.state !== 'ok' && remote.state !== 'disabled' ? ` — ${remote.message}` : ''}
      </span>
    </div>
  )
}

export function SettingsView({ status, onSyncNow, onConfigChanged, theme, onTheme }) {
  const [gh, setGh] = useState(getGithubConfig)
  const [dr, setDr] = useState(getDriveConfig)
  const [saved, setSaved] = useState('')

  function saveGithub() {
    setGithubConfig(gh)
    flash('GitHub enregistré')
    onConfigChanged()
  }
  function saveDrive() {
    setDriveConfig(dr)
    flash('Drive enregistré')
    onConfigChanged()
  }
  function disconnectDrive() {
    setDriveConfig(DEFAULT_DRIVE)
    setDr(getDriveConfig())
    flash('Drive déconnecté')
    onConfigChanged()
  }
  function flash(msg) {
    setSaved(msg)
    setTimeout(() => setSaved(''), 1800)
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 18 }}>Réglages</h2>
        <div className="segmented" role="group" aria-label="Thème">
          {['system', 'light', 'dark'].map((t) => (
            <button key={t} aria-pressed={theme === t} onClick={() => onTheme(t)}>
              {t === 'system' ? 'Auto' : t === 'light' ? 'Clair' : 'Sombre'}
            </button>
          ))}
        </div>
      </div>

      {/* ---- GitHub ---- */}
      <section className="card settings-section">
        <h2>GitHub</h2>
        <p className="hint">
          Dépôt privé <code>cockpit_core</code>, fichier <code>cockpit-data.json</code>. Jeton fine-grained
          (Contents : lecture/écriture sur ce seul dépôt). Le jeton reste local — jamais synchronisé ni exporté.
        </p>
        <div className="settings-grid">
          <div className="form-row">
            <div>
              <label className="label" htmlFor="gh-owner">Propriétaire</label>
              <input id="gh-owner" className="input" value={gh.owner} onChange={(e) => setGh({ ...gh, owner: e.target.value.trim() })} placeholder="mon-compte" />
            </div>
            <div>
              <label className="label" htmlFor="gh-repo">Dépôt</label>
              <input id="gh-repo" className="input" value={gh.repo} onChange={(e) => setGh({ ...gh, repo: e.target.value.trim() })} placeholder="cockpit_core" />
            </div>
          </div>
          <div className="form-row">
            <div>
              <label className="label" htmlFor="gh-branch">Branche</label>
              <input id="gh-branch" className="input" value={gh.branch} onChange={(e) => setGh({ ...gh, branch: e.target.value.trim() })} placeholder="main" />
            </div>
            <div>
              <label className="label" htmlFor="gh-path">Fichier</label>
              <input id="gh-path" className="input" value={gh.path} onChange={(e) => setGh({ ...gh, path: e.target.value.trim() })} placeholder="cockpit-data.json" />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="gh-token">Jeton (fine-grained)</label>
            <input id="gh-token" type="password" autoComplete="off" className="input" value={gh.token} onChange={(e) => setGh({ ...gh, token: e.target.value.trim() })} placeholder="github_pat_…" />
          </div>
          <div className="row">
            <button className="btn btn-primary" onClick={saveGithub}>Enregistrer GitHub</button>
            <StatusLine remote={status.github} />
          </div>
        </div>
      </section>

      {/* ---- Drive ---- */}
      <section className="card settings-section">
        <h2>Synchronisation Drive (Cockpit)</h2>
        <p className="hint">
          Passerelle Apps Script (URL <code>/exec</code>) + secret. Même fichier <code>cockpit-data.json</code> sur
          Google Drive. Le secret reste local — jamais synchronisé ni exporté.
        </p>
        <div className="settings-grid">
          <div>
            <label className="label" htmlFor="dr-url">URL /exec</label>
            <input id="dr-url" className="input" value={dr.execUrl} onChange={(e) => setDr({ ...dr, execUrl: e.target.value.trim() })} placeholder="https://script.google.com/macros/s/…/exec" />
          </div>
          <div>
            <label className="label" htmlFor="dr-secret">Secret</label>
            <input id="dr-secret" type="password" autoComplete="off" className="input" value={dr.secret} onChange={(e) => setDr({ ...dr, secret: e.target.value.trim() })} placeholder="secret partagé" />
          </div>
          <StatusLine remote={status.drive} />
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={saveDrive}>Enregistrer Drive</button>
            <button className="btn" onClick={onSyncNow}>
              <IconSync width={16} height={16} /> Synchroniser maintenant
            </button>
            <button className="btn btn-ghost" onClick={disconnectDrive}>Déconnexion</button>
          </div>
        </div>
      </section>

      {saved && <div className="toast">{saved}</div>}
    </div>
  )
}
