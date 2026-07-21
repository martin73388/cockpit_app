// Google Drive gateway remote (Apps Script /exec), already deployed.
// Protocol uses ONLY "simple" CORS requests (no preflight):
//   READ  : GET  <url>?secret=<S>&file=<name>
//           -> { ok, exists, version, content }
//   WRITE : POST <url>  body JSON {secret, file, content, baseVersion}
//           with Content-Type: text/plain  (NEVER application/json -> would preflight)
//           -> { ok:true, version }
//            | { ok:false, error:"conflict", version, content }
//            | { ok:false, error:"auth"|"bad-request" }
// `version` plays the role of GitHub's `sha`.
import { ConflictError, AuthError, SyncError } from './errors.js'

export const DATA_FILE = 'cockpit-data.json'

export function isConfigured(cfg) {
  return !!(cfg && cfg.execUrl && cfg.secret)
}

function parseMaybeJson(content) {
  if (content == null) return null
  if (typeof content === 'object') return content
  const text = String(content)
  try {
    return text.trim() ? JSON.parse(text) : null
  } catch {
    return null
  }
}

// Returns { exists, version|null, content(parsed)|null, raw|null }.
export async function readFile(cfg, file = DATA_FILE) {
  const url = `${cfg.execUrl}?secret=${encodeURIComponent(cfg.secret)}&file=${encodeURIComponent(file)}`
  let res
  try {
    res = await fetch(url, { method: 'GET' }) // no custom headers -> simple request
  } catch (e) {
    throw new SyncError(`Drive réseau: ${e.message}`)
  }
  if (!res.ok) throw new SyncError(`Drive GET ${res.status}`, { status: res.status })

  let body
  try {
    body = await res.json()
  } catch (e) {
    throw new SyncError(`Drive: réponse illisible (${e.message})`)
  }
  if (body.ok === false && body.error === 'auth') throw new AuthError('Drive: secret refusé.')
  if (body.ok === false && body.error) throw new SyncError(`Drive: ${body.error}`)
  if (body.exists === false) return { exists: false, version: null, content: null, raw: null }

  return {
    exists: true,
    version: body.version ?? null,
    content: parseMaybeJson(body.content),
    raw: typeof body.content === 'string' ? body.content : null,
  }
}

export function read(cfg) {
  return readFile(cfg, DATA_FILE)
}

// Writes `text` (already-serialized JSON) with CAS against `baseVersion`.
export async function write(cfg, text, baseVersion) {
  const payload = { secret: cfg.secret, file: DATA_FILE, content: text, baseVersion: baseVersion ?? null }
  let res
  try {
    res = await fetch(cfg.execUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, // simple request, avoids preflight
      body: JSON.stringify(payload),
    })
  } catch (e) {
    throw new SyncError(`Drive réseau: ${e.message}`)
  }
  if (!res.ok) throw new SyncError(`Drive POST ${res.status}`, { status: res.status })

  let body
  try {
    body = await res.json()
  } catch (e) {
    throw new SyncError(`Drive: réponse illisible (${e.message})`)
  }
  if (body.ok) return { version: body.version ?? null }

  if (body.error === 'conflict') {
    throw new ConflictError('Drive: baseVersion périmée.', { version: body.version ?? null, content: parseMaybeJson(body.content) })
  }
  if (body.error === 'auth') throw new AuthError('Drive: secret refusé.')
  throw new SyncError(`Drive: ${body.error || 'échec écriture'}`)
}
