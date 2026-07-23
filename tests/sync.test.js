import { describe, it, expect, beforeEach } from 'vitest'
import { createEngine } from '../src/sync/engine.js'
import { mergeStates, canonicalize, serialize, isCockpitFile } from '../src/sync/merge.js'
import { ConflictError } from '../src/sync/errors.js'
import { APP, SCHEMA_VERSION } from '../src/data/model.js'

// ---- helpers ----
function todo(id, updatedAt, extra = {}) {
  return { id, title: id, notes: '', done: false, doneAt: null, priority: 'normale', dueDate: '', projectId: null, order: updatedAt, subtasks: [], createdAt: 1, updatedAt, ...extra }
}
function state({ todos = [], habits = [], deleted = [] } = {}) {
  return { app: APP, version: SCHEMA_VERSION, todos, habits, deleted }
}
function fakeStore(initial) {
  let s = canonicalize(initial || state())
  return {
    getSnapshot: () => s,
    replaceState: (next) => (s = canonicalize(next)),
    onLocalChange: () => () => {},
    subscribe: () => () => {},
  }
}
// Configurable fake remote with a compare-and-swap "server".
function fakeRemote(opts = {}) {
  let content = opts.content ? JSON.parse(JSON.stringify(opts.content)) : null
  let version = content ? 'v1' : null
  let counter = content ? 1 : 0
  const style = opts.style || 'github'
  let injectConflict = opts.injectConflict || null
  const calls = { reads: 0, writes: 0 }
  const conflict = (withContent) =>
    style === 'drive'
      ? new ConflictError('conflict', { version, content: withContent ? JSON.parse(JSON.stringify(content)) : null })
      : new ConflictError('conflict', { version: null, content: null })
  return {
    calls,
    peek: () => content,
    isConfigured: () => opts.configured !== false,
    async read() {
      calls.reads++
      if (content == null) return { exists: false, version: null, content: null, raw: null }
      return { exists: true, version, content: JSON.parse(JSON.stringify(content)), raw: JSON.stringify(content) }
    },
    async write(cfg, text, base) {
      calls.writes++
      if (injectConflict && calls.writes === 1 && version != null) {
        content = injectConflict(content) // a competing device wrote first
        counter++; version = 'v' + counter
        injectConflict = null
        throw conflict(true)
      }
      if (version != null && base !== version) throw conflict(true)
      content = JSON.parse(text)
      counter++; version = 'v' + counter
      return { version }
    },
  }
}
function engineWith(store, github, drive, onStatus = () => {}) {
  return createEngine({ store, github, drive, getGithubConfig: () => ({}), getDriveConfig: () => ({}), onStatus })
}

beforeEach(() => {
  if (typeof navigator !== 'undefined') Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})

describe('dual-remote push', () => {
  it('pushes local state to BOTH remotes and both end identical', async () => {
    const store = fakeStore(state({ todos: [todo('t1', 5)] }))
    const gh = fakeRemote()
    const dr = fakeRemote()
    await engineWith(store, gh, dr).sync('test')

    expect(gh.calls.writes).toBeGreaterThanOrEqual(1)
    expect(dr.calls.writes).toBeGreaterThanOrEqual(1)
    expect(isCockpitFile(gh.peek())).toBe(true)
    expect(serialize(gh.peek())).toBe(serialize(store.getSnapshot()))
    expect(serialize(dr.peek())).toBe(serialize(store.getSnapshot()))
  })

  it('pulls newer remote data, merges, and pushes the union back', async () => {
    const store = fakeStore(state({ todos: [todo('local', 5)] }))
    const gh = fakeRemote({ content: state({ todos: [todo('remote', 9)] }) })
    const dr = fakeRemote()
    await engineWith(store, gh, dr).sync('test')

    const local = store.getSnapshot()
    expect(local.todos.map((t) => t.id).sort()).toEqual(['local', 'remote'])
    // Both remotes converge to the merged state.
    expect(serialize(gh.peek())).toBe(serialize(local))
    expect(serialize(dr.peek())).toBe(serialize(local))
  })
})

describe('compare-and-swap conflict handling', () => {
  it('drive conflict (carries content): re-merges from payload and retries', async () => {
    const store = fakeStore(state({ todos: [todo('mine', 5)] }))
    const dr = fakeRemote({
      style: 'drive',
      content: state({ todos: [todo('base', 1)] }),
      injectConflict: (c) => mergeStates(c, state({ todos: [todo('other', 20)] })),
    })
    await engineWith(store, fakeRemote({ configured: false }), dr).sync('test')

    const ids = dr.peek().todos.map((t) => t.id).sort()
    expect(ids).toEqual(['base', 'mine', 'other']) // no lost update
    expect(dr.calls.writes).toBe(2) // first conflicted, second succeeded
  })

  it('github conflict (no content): re-pulls, merges, retries', async () => {
    const store = fakeStore(state({ todos: [todo('mine', 5)] }))
    const gh = fakeRemote({
      style: 'github',
      content: state({ todos: [todo('base', 1)] }),
      injectConflict: (c) => mergeStates(c, state({ todos: [todo('other', 20)] })),
    })
    await engineWith(store, gh, fakeRemote({ configured: false })).sync('test')

    const ids = gh.peek().todos.map((t) => t.id).sort()
    expect(ids).toEqual(['base', 'mine', 'other'])
    expect(gh.calls.reads).toBeGreaterThanOrEqual(2) // initial pull + conflict re-read
  })
})

describe('foreign-file guard', () => {
  it('never overwrites a remote that is not a Cockpit file', async () => {
    const foreign = { companies: [{ id: 'c1', name: 'ACME' }], contacts: [] } // radar.json shape
    const store = fakeStore(state({ todos: [todo('t1', 5)] }))
    const gh = fakeRemote({ content: foreign })
    let status
    await engineWith(store, gh, fakeRemote({ configured: false }), (s) => (status = s)).sync('test')

    expect(gh.calls.writes).toBe(0)
    expect(gh.peek()).toEqual(foreign) // untouched
    expect(status.github.state).toBe('blocked')
  })

  it('does NOT overwrite a remote whose conflict payload is a foreign file', async () => {
    // Drive conflict carries the competing content; if that content is foreign
    // we must abort the write, not clobber it.
    const store = fakeStore(state({ todos: [todo('mine', 5)] }))
    const dr = fakeRemote({
      style: 'drive',
      content: state({ todos: [todo('base', 1)] }),
      injectConflict: () => ({ app: 'radar', companies: [] }), // competing device wrote a foreign file
    })
    let status
    await engineWith(store, fakeRemote({ configured: false }), dr, (s) => (status = s)).sync('test')
    expect(dr.peek()).toEqual({ app: 'radar', companies: [] }) // untouched
    expect(dr.calls.writes).toBe(1) // only the attempt that conflicted; no overwrite
    expect(status.drive.state).toBe('error')
  })

  it('blocks even when the gateway returns already-parsed (raw null) content', async () => {
    const foreign = { app: 'carnet', projects: [{ id: 'p1', name: 'X' }] }
    let writes = 0
    const drive = {
      isConfigured: () => true,
      async read() {
        return { exists: true, version: 'v1', content: foreign, raw: null } // parsed, no raw text
      },
      async write() {
        writes++
        return { version: 'v2' }
      },
    }
    const store = fakeStore(state({ todos: [todo('t1', 5)] }))
    let status
    await engineWith(store, fakeRemote({ configured: false }), drive, (s) => (status = s)).sync('test')
    expect(writes).toBe(0)
    expect(status.drive.state).toBe('blocked')
  })
})

describe('schema-version guard', () => {
  it('never merges or overwrites a newer-schema (v3) remote', async () => {
    const v3 = { app: 'cockpit', version: 3, todos: [todo('future', 9)], habits: [], deleted: [] }
    const store = fakeStore(state({ todos: [todo('mine', 5)] }))
    const gh = fakeRemote({ content: v3 })
    let status
    await engineWith(store, gh, fakeRemote({ configured: false }), (s) => (status = s)).sync('test')
    expect(gh.calls.writes).toBe(0)
    expect(gh.peek().version).toBe(3) // untouched
    expect(store.getSnapshot().todos.map((t) => t.id)).toEqual(['mine']) // v3 data not pulled in
    expect(status.github.state).toBe('blocked')
  })
})

describe('offline', () => {
  it('does no network when offline and reports offline status', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    const store = fakeStore(state({ todos: [todo('t1', 5)] }))
    const gh = fakeRemote()
    const dr = fakeRemote()
    let status
    await engineWith(store, gh, dr, (s) => (status = s)).sync('test')

    expect(gh.calls.reads + gh.calls.writes).toBe(0)
    expect(dr.calls.reads + dr.calls.writes).toBe(0)
    expect(status.github.state).toBe('offline')
    expect(status.drive.state).toBe('offline')
  })
})
