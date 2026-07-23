// Framework-agnostic state store: single source of local truth.
// - Hydrates from localStorage and persists on every change.
// - Immutable updates (new object references) so React's useSyncExternalStore
//   re-renders precisely.
// - Local mutations bump `updatedAt` (monotone) and notify sync listeners so the
//   engine can debounce a push. `replaceState` (used by the sync engine after a
//   merge) updates the UI WITHOUT scheduling another push — avoids feedback loops.
import { stamp, observe } from './clock.js'
import { emptyState, newTodo, newSubtask, newHabit, newInboxItem, tombstone } from './model.js'
import { canonicalize, stableStringify } from '../sync/merge.js'
import { KEYS, load, save } from './persist.js'

const ORDER_STEP = 1000

function hydrate() {
  const raw = load(KEYS.state)
  const state = raw && raw.app === 'cockpit' ? canonicalize(raw) : emptyState()
  bumpClock(state)
  return state
}

function bumpClock(state) {
  for (const t of state.todos) observe(t.updatedAt)
  for (const h of state.habits) observe(h.updatedAt)
  for (const i of state.inbox) observe(i.updatedAt)
  for (const d of state.deleted) observe(d.at)
}

export function createStore(initial) {
  let state = initial || hydrate()
  const subs = new Set()
  const changeSubs = new Set()

  function commit(next, { local }) {
    state = next
    save(KEYS.state, state)
    subs.forEach((fn) => fn())
    if (local) changeSubs.forEach((fn) => fn())
  }

  // Local mutation: recompute nothing global, just swap in the produced state.
  function mutate(producer) {
    const next = producer(state)
    if (next && next !== state) commit(next, { local: true })
  }

  const store = {
    getSnapshot: () => state,
    subscribe(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    // Called after each local mutation — the sync engine debounces on this.
    onLocalChange(fn) {
      changeSubs.add(fn)
      return () => changeSubs.delete(fn)
    },
    // Sync engine entry point: adopt a merged state without re-triggering a push.
    replaceState(next) {
      const canon = canonicalize(next)
      bumpClock(canon)
      commit(canon, { local: false })
      return canon
    },

    // ---------- Todos ----------
    addTodo(title) {
      const t = (title || '').trim()
      if (!t) return null
      const maxOrder = state.todos.reduce((m, x) => Math.max(m, x.order || 0), 0)
      const todo = newTodo({ title: t, order: maxOrder + ORDER_STEP })
      mutate((s) => ({ ...s, todos: [...s.todos, todo] }))
      return todo.id
    },
    updateTodo(id, patch) {
      mutate((s) => ({
        ...s,
        todos: s.todos.map((x) => (x.id === id ? { ...x, ...patch, updatedAt: stamp() } : x)),
      }))
    },
    toggleTodoDone(id) {
      mutate((s) => ({
        ...s,
        todos: s.todos.map((x) => {
          if (x.id !== id) return x
          const done = !x.done
          // Parent -> children: (un)completing the todo (un)checks every subtask.
          const subtasks = x.subtasks.map((st) => ({ ...st, done }))
          return { ...x, done, doneAt: done ? stamp() : null, subtasks, updatedAt: stamp() }
        }),
      }))
    },
    duplicateTodo(id) {
      mutate((s) => {
        const src = s.todos.find((x) => x.id === id)
        if (!src) return s
        const maxOrder = s.todos.reduce((m, x) => Math.max(m, x.order || 0), 0)
        const copy = newTodo({
          title: `${src.title} (copie)`,
          notes: src.notes,
          priority: src.priority,
          dueDate: src.dueDate,
          projectId: src.projectId,
          order: maxOrder + ORDER_STEP,
          subtasks: src.subtasks.map((st) => newSubtask({ title: st.title, done: false })),
        })
        return { ...s, todos: [...s.todos, copy] }
      })
    },
    deleteTodo(id) {
      mutate((s) => {
        if (!s.todos.some((x) => x.id === id)) return s
        return {
          ...s,
          todos: s.todos.filter((x) => x.id !== id),
          deleted: [...s.deleted, tombstone(id, 'todo')],
        }
      })
    },
    // Reassign manual order from a fully-ordered id list; bump only what moved.
    setManualOrder(orderedIds) {
      mutate((s) => {
        const rank = new Map(orderedIds.map((id, i) => [id, (i + 1) * ORDER_STEP]))
        let changed = false
        const todos = s.todos.map((x) => {
          const next = rank.get(x.id)
          if (next == null || next === x.order) return x
          changed = true
          return { ...x, order: next, updatedAt: stamp() }
        })
        return changed ? { ...s, todos } : s
      })
    },

    // ---------- Subtasks ----------
    addSubtask(todoId, title) {
      const t = (title || '').trim()
      if (!t) return
      mutate((s) => ({
        ...s,
        todos: s.todos.map((x) =>
          x.id === todoId
            ? reconcileParent({ ...x, subtasks: [...x.subtasks, newSubtask({ title: t })], updatedAt: stamp() })
            : x,
        ),
      }))
    },
    toggleSubtask(todoId, subId) {
      mutate((s) => ({
        ...s,
        todos: s.todos.map((x) => {
          if (x.id !== todoId) return x
          const subtasks = x.subtasks.map((st) => (st.id === subId ? { ...st, done: !st.done } : st))
          return reconcileParent({ ...x, subtasks, updatedAt: stamp() })
        }),
      }))
    },
    renameSubtask(todoId, subId, title) {
      mutate((s) => ({
        ...s,
        todos: s.todos.map((x) =>
          x.id === todoId
            ? { ...x, subtasks: x.subtasks.map((st) => (st.id === subId ? { ...st, title } : st)), updatedAt: stamp() }
            : x,
        ),
      }))
    },
    removeSubtask(todoId, subId) {
      mutate((s) => ({
        ...s,
        todos: s.todos.map((x) =>
          x.id === todoId
            ? reconcileParent({ ...x, subtasks: x.subtasks.filter((st) => st.id !== subId), updatedAt: stamp() })
            : x,
        ),
      }))
    },
    reorderSubtasks(todoId, orderedSubIds) {
      mutate((s) => ({
        ...s,
        todos: s.todos.map((x) => {
          if (x.id !== todoId) return x
          const byId = new Map(x.subtasks.map((st) => [st.id, st]))
          const subtasks = orderedSubIds.map((id) => byId.get(id)).filter(Boolean)
          if (subtasks.length !== x.subtasks.length) return x
          return { ...x, subtasks, updatedAt: stamp() }
        }),
      }))
    },

    // ---------- Habits ----------
    addHabit(data) {
      const habit = newHabit({ ...data, calendarSync: 'pending', calendarEventId: null })
      mutate((s) => ({ ...s, habits: [...s.habits, habit] }))
      return habit.id
    },
    updateHabit(id, patch) {
      // Only a SCHEDULE change (anchorDate included) re-opens the calendar
      // handshake — title/notes/pillar edits keep the current sync status.
      // (Active/pause is handled by toggleHabitActive, which always re-opens.)
      mutate((s) => ({
        ...s,
        habits: s.habits.map((h) => {
          if (h.id !== id) return h
          const scheduleChanged =
            patch.schedule != null && stableStringify(patch.schedule) !== stableStringify(h.schedule)
          const next = { ...h, ...patch, updatedAt: stamp() }
          if (scheduleChanged) next.calendarSync = 'pending'
          return next
        }),
      }))
    },
    toggleHabitActive(id) {
      mutate((s) => ({
        ...s,
        habits: s.habits.map((h) =>
          h.id === id ? { ...h, active: !h.active, calendarSync: 'pending', updatedAt: stamp() } : h,
        ),
      }))
    },
    // Check off / un-check today's (or any day's) completion. Does NOT touch
    // calendarSync: only schedule/active changes re-open the calendar handshake.
    toggleHabitCompletion(id, date) {
      mutate((s) => ({
        ...s,
        habits: s.habits.map((h) => {
          if (h.id !== id) return h
          const has = h.completions.includes(date)
          const t = stamp()
          // checks is the per-date CRDT source of truth; completions is derived.
          const checks = { ...h.checks, [date]: { on: !has, at: t } }
          const completions = has
            ? h.completions.filter((d) => d !== date)
            : [...h.completions, date].sort()
          return { ...h, checks, completions, updatedAt: t }
        }),
      }))
    },
    deleteHabit(id) {
      mutate((s) => {
        if (!s.habits.some((h) => h.id === id)) return s
        return {
          ...s,
          habits: s.habits.filter((h) => h.id !== id),
          deleted: [...s.deleted, tombstone(id, 'habit')],
        }
      })
    },

    // ---------- Inbox (quick capture) ----------
    addInboxItem(text) {
      const t = (text || '').trim()
      if (!t) return null
      const item = newInboxItem(t)
      mutate((s) => ({ ...s, inbox: [...s.inbox, item] }))
      return item.id
    },
    // Convert an inbox item into a todo; the item stays visible in the
    // "recently processed" block with its note.
    processInboxToTodo(id) {
      let todoId = null
      mutate((s) => {
        const item = s.inbox.find((i) => i.id === id)
        if (!item || item.processedAt != null) return s
        const maxOrder = s.todos.reduce((m, x) => Math.max(m, x.order || 0), 0)
        const todo = newTodo({ title: item.text, order: maxOrder + ORDER_STEP })
        todoId = todo.id
        return {
          ...s,
          todos: [...s.todos, todo],
          inbox: s.inbox.map((i) =>
            i.id === id ? { ...i, processedAt: stamp(), processedNote: 'Converti en todo', updatedAt: stamp() } : i,
          ),
        }
      })
      return todoId
    },
    deleteInboxItem(id) {
      mutate((s) => {
        if (!s.inbox.some((i) => i.id === id)) return s
        return {
          ...s,
          inbox: s.inbox.filter((i) => i.id !== id),
          deleted: [...s.deleted, tombstone(id, 'inbox')],
        }
      })
    },
    // Silently tombstone processed items older than 30 days to bound file size.
    purgeProcessedInbox(now = Date.now()) {
      const cutoff = now - 30 * 86400000
      mutate((s) => {
        const stale = s.inbox.filter((i) => i.processedAt != null && i.processedAt < cutoff)
        if (!stale.length) return s
        return {
          ...s,
          inbox: s.inbox.filter((i) => !(i.processedAt != null && i.processedAt < cutoff)),
          deleted: [...s.deleted, ...stale.map((i) => tombstone(i.id, 'inbox'))],
        }
      })
    },
  }

  return store
}

// Keep a todo's own done flag consistent with its subtasks:
// all subtasks done -> todo done; any subtask undone -> todo not done.
function reconcileParent(todo) {
  if (!todo.subtasks.length) return todo
  const allDone = todo.subtasks.every((st) => st.done)
  if (allDone && !todo.done) return { ...todo, done: true, doneAt: stamp() }
  if (!allDone && todo.done) return { ...todo, done: false, doneAt: null }
  return todo
}

export const store = createStore()
