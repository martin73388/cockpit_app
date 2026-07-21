// Sync orchestration. On every cycle (launch / focus / online / manual /
// debounced push) we synchronise against BOTH remotes:
//   pull GitHub -> merge ; pull Drive -> merge ; then push GitHub AND Drive.
// Writes use compare-and-swap; a stale base -> re-pull + merge + re-push.
// A remote whose current file is NOT a Cockpit file is never overwritten.
import * as githubRemote from './github.js'
import * as driveRemote from './drive.js'
import { mergeStates, isCockpitFile, serialize } from './merge.js'
import { SCHEMA_VERSION } from '../data/model.js'
import { ConflictError, AuthError, SyncError } from './errors.js'

const MAX_CONFLICT_RETRIES = 4

// A remote file we must not clobber: it exists, has real content, but isn't ours.
// "Real content" means non-blank raw text OR a parsed non-null body — so a
// gateway that returns already-parsed JSON can't slip a foreign file past us.
function hasContent(r) {
  if (r.raw != null) return r.raw.trim().length > 0
  return r.content != null
}
function isForeign(r) {
  return !!(r && r.exists && hasContent(r) && !isCockpitFile(r.content))
}

// A Cockpit file whose schema is newer than this build understands. We must not
// merge or overwrite it — that would silently downgrade a v2 file to v1.
function isNewerSchema(content) {
  return isCockpitFile(content) && (Number(content.version) || 1) > SCHEMA_VERSION
}
// Remote content we are forbidden to overwrite (foreign OR newer schema).
function isProtected(content) {
  return content != null && (!isCockpitFile(content) || isNewerSchema(content))
}

function classify(e) {
  if (e instanceof AuthError) return 'auth'
  if (e instanceof ConflictError) return 'conflict'
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
  if (e instanceof SyncError && /réseau/i.test(e.message || '')) return 'offline'
  return 'error'
}

export function createEngine({
  store,
  github = githubRemote,
  drive = driveRemote,
  getGithubConfig,
  getDriveConfig,
  onStatus = () => {},
  debounceMs = 1500,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (h) => clearTimeout(h),
}) {
  let running = false
  let queued = false
  let debounceHandle = null
  const listeners = []
  const status = {
    running: false,
    lastReason: null,
    github: { state: 'idle', message: '', at: null },
    drive: { state: 'idle', message: '', at: null },
  }

  function emit() {
    status.running = running
    onStatus({ ...status, github: { ...status.github }, drive: { ...status.drive } })
    listeners.forEach((fn) => fn(status))
  }
  function setRemote(which, state, message = '') {
    status[which] = { state, message, at: state === 'ok' ? Date.now() : status[which].at }
    emit()
  }
  function setRemoteError(which, e) {
    status[which] = { state: classify(e), message: e.message || String(e), at: status[which].at }
    emit()
  }

  // Push with compare-and-swap; on conflict re-pull, merge, retry.
  async function pushCas(remote, cfg, baseVersion) {
    let base = baseVersion
    for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
      const text = serialize(store.getSnapshot())
      try {
        const { version } = await remote.write(cfg, text, base)
        return version
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e
        let remoteContent = e.content
        let remoteVersion = e.version
        if (remoteContent == null) {
          const r = await remote.read(cfg)
          if (isForeign(r)) throw new SyncError('Conflit + fichier distant non-Cockpit: écriture annulée.')
          remoteContent = r.content
          remoteVersion = r.version
        }
        // Guard the conflict-retry path too: a Drive conflict payload can carry a
        // foreign / newer-schema file we must never overwrite.
        if (isProtected(remoteContent)) {
          throw new SyncError('Conflit : fichier distant protégé (non-Cockpit ou schéma plus récent). Écriture annulée.')
        }
        if (remoteContent) {
          store.replaceState(mergeStates(store.getSnapshot(), remoteContent))
        }
        base = remoteVersion
      }
    }
    throw new ConflictError('Conflit persistant après plusieurs tentatives.')
  }

  // Pull one remote and merge it in. Returns { version, foreign, usable }.
  async function pullMerge(which, remote, cfg) {
    setRemote(which, 'syncing')
    try {
      const r = await remote.read(cfg)
      if (isForeign(r)) {
        setRemote(which, 'blocked', 'Fichier distant non-Cockpit: écriture bloquée.')
        return { version: r.version, foreign: true, usable: true }
      }
      if (isNewerSchema(r.content)) {
        setRemote(which, 'blocked', `Schéma distant plus récent (v${r.content.version}) : mettez l'app à jour.`)
        return { version: r.version, foreign: true, usable: true }
      }
      if (r.exists && isCockpitFile(r.content)) {
        store.replaceState(mergeStates(store.getSnapshot(), r.content))
      }
      return { version: r.version, foreign: false, usable: true }
    } catch (e) {
      setRemoteError(which, e)
      return { version: null, foreign: false, usable: false }
    }
  }

  async function runCycle() {
    const ghCfg = getGithubConfig()
    const drCfg = getDriveConfig()
    const ghOn = github.isConfigured(ghCfg)
    const drOn = drive.isConfigured(drCfg)

    if (!ghOn) setRemote('github', 'disabled')
    if (!drOn) setRemote('drive', 'disabled')
    if (!ghOn && !drOn) return

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (ghOn) setRemote('github', 'offline')
      if (drOn) setRemote('drive', 'offline')
      return
    }

    // Phase 1 — pulls + merges.
    let gh = { usable: false, foreign: false, version: null }
    let dr = { usable: false, foreign: false, version: null }
    if (ghOn) gh = await pullMerge('github', github, ghCfg)
    if (drOn) dr = await pullMerge('drive', drive, drCfg)

    // Phase 2 — push both (skip foreign/unusable).
    if (ghOn && gh.usable && !gh.foreign) {
      setRemote('github', 'syncing')
      try {
        await pushCas(github, ghCfg, gh.version)
        setRemote('github', 'ok')
      } catch (e) {
        setRemoteError('github', e)
      }
    }
    if (drOn && dr.usable && !dr.foreign) {
      setRemote('drive', 'syncing')
      try {
        await pushCas(drive, drCfg, dr.version)
        setRemote('drive', 'ok')
      } catch (e) {
        setRemoteError('drive', e)
      }
    }
  }

  async function sync(reason = 'manual') {
    if (running) {
      queued = true
      return status
    }
    running = true
    status.lastReason = reason
    emit()
    try {
      await runCycle()
    } finally {
      running = false
      emit()
      if (queued) {
        queued = false
        schedule(() => sync('coalesced'), 0)
      }
    }
    return status
  }

  function scheduleSync(reason = 'change') {
    if (debounceHandle) cancel(debounceHandle)
    debounceHandle = schedule(() => {
      debounceHandle = null
      sync(reason)
    }, debounceMs)
  }

  let detach = null
  function start() {
    const onOnline = () => sync('online')
    const onFocus = () => sync('focus')
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') sync('visible')
    }
    const unsubChange = store.onLocalChange(() => scheduleSync('change'))
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline)
      window.addEventListener('focus', onFocus)
      document.addEventListener('visibilitychange', onVisible)
    }
    detach = () => {
      unsubChange()
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline)
        window.removeEventListener('focus', onFocus)
        document.removeEventListener('visibilitychange', onVisible)
      }
      if (debounceHandle) cancel(debounceHandle)
    }
    sync('launch')
  }
  function stop() {
    if (detach) detach()
    detach = null
  }

  return {
    sync,
    scheduleSync,
    start,
    stop,
    getStatus: () => status,
    onStatusChange(fn) {
      listeners.push(fn)
      return () => {
        const i = listeners.indexOf(fn)
        if (i >= 0) listeners.splice(i, 1)
      }
    },
  }
}
