// GitHub Contents remote — compare-and-swap via the file `sha`.
//   read()  -> GET  /repos/{owner}/{repo}/contents/{path}?ref={branch}
//   write() -> PUT  same path, body carries base64 content + the base `sha`
// A stale sha yields 409/422 -> ConflictError -> caller re-pulls, merges, retries.
import { ConflictError, AuthError, SyncError } from './errors.js'
import { utf8ToBase64, base64ToUtf8 } from './base64.js'

const API = 'https://api.github.com'

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

function contentsUrl({ owner, repo, path }) {
  const segs = String(path).split('/').map(encodeURIComponent).join('/')
  return `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${segs}`
}

export function isConfigured(cfg) {
  return !!(cfg && cfg.owner && cfg.repo && cfg.path && cfg.token)
}

// GitHub reuses 403 for BOTH permission errors and rate limiting. Only call a
// dropped/insufficient token an AuthError; treat rate limits as retriable.
function raiseAuthOrRate(res) {
  if (res.status === 401) throw new AuthError('GitHub: jeton refusé ou droits insuffisants.')
  const remaining = res.headers.get('x-ratelimit-remaining')
  const retryAfter = res.headers.get('retry-after')
  if (remaining === '0' || retryAfter) throw new SyncError('GitHub: limite de débit atteinte, réessai plus tard.', { status: 403 })
  throw new AuthError('GitHub: jeton refusé ou droits insuffisants.')
}

// Returns { exists, version(sha)|null, content(parsed)|null, raw(text)|null }.
export async function read(cfg) {
  const url = `${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch || 'main')}`
  let res
  try {
    res = await fetch(url, { headers: headers(cfg.token) })
  } catch (e) {
    throw new SyncError(`GitHub réseau: ${e.message}`)
  }
  if (res.status === 404) return { exists: false, version: null, content: null, raw: null }
  if (res.status === 401 || res.status === 403) raiseAuthOrRate(res)
  if (!res.ok) throw new SyncError(`GitHub GET ${res.status}`, { status: res.status })

  const body = await res.json()
  const text = base64ToUtf8(body.content || '')
  let parsed = null
  try {
    parsed = text.trim() ? JSON.parse(text) : null
  } catch {
    parsed = null // present but not JSON we understand; guard in engine decides what to do
  }
  return { exists: true, version: body.sha, content: parsed, raw: text }
}

// Writes `text` with CAS against `baseSha` (null/undefined => create new file).
export async function write(cfg, text, baseSha) {
  const url = contentsUrl(cfg)
  const payload = {
    message: `cockpit: sync ${new Date().toISOString()}`,
    content: utf8ToBase64(text),
    branch: cfg.branch || 'main',
  }
  if (baseSha) payload.sha = baseSha

  let res
  try {
    res = await fetch(url, { method: 'PUT', headers: { ...headers(cfg.token), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  } catch (e) {
    throw new SyncError(`GitHub réseau: ${e.message}`)
  }
  if (res.status === 409 || res.status === 422) {
    // sha mismatch — someone else wrote first. Surface as conflict; engine re-pulls.
    throw new ConflictError('GitHub: sha périmé (compare-and-swap).', { version: null, content: null })
  }
  if (res.status === 401 || res.status === 403) raiseAuthOrRate(res)
  if (!res.ok) throw new SyncError(`GitHub PUT ${res.status}`, { status: res.status })

  const body = await res.json()
  return { version: body.content && body.content.sha }
}
