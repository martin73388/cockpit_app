// Framework-agnostic state store: single source of local truth.
// - Hydrates from localStorage and persists on every change.
// - Immutable updates (new object references) so React's useSyncExternalStore
//   re-renders precisely.
// - Local mutations bump `updatedAt` (monotone) and notify sync listeners so the
//   engine can debounce a push. `replaceState` (used by the sync engine after a
//   merge) updates the UI WITHOUT scheduling another push — avoids feedback loops.
import { stamp, observe } from './clock.js'
import { todayISO } from '../utils/dates.js'
import { childrenByParent, ancestorsOf, canMoveUnder, reorderNeighbour, ROOT } from '../utils/tree.js'
import { emptyState, newTodo, newSubtask, newHabit, newInboxItem, tombstone, TIMER_CAP_MINUTES } from './model.js'
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
      // v9 — `priority` est la projection du rang. Si l'onglet Todos la change
      // a la main sans toucher au rang, la projection l'ecraserait au prochain
      // enregistrement, en silence. Poser une priorite libere donc le rang :
      // le dernier geste fait foi, quel que soit l'ecran d'ou il vient.
      const p = patch.priority != null && patch.rank === undefined ? { ...patch, rank: null } : patch
      mutate((s) => ({
        ...s,
        todos: s.todos.map((x) => (x.id === id ? { ...x, ...p, updatedAt: stamp() } : x)),
      }))
    },

    // Classer une tache de 1 (le plus prioritaire) a 5. null = declassee.
    setRank(id, rank) {
      const r = Math.round(Number(rank))
      const value = Number.isFinite(r) && r >= 1 && r <= 5 ? r : null
      mutate((s) => ({
        ...s,
        todos: s.todos.map((x) => (x.id === id && x.rank !== value ? { ...x, rank: value, updatedAt: stamp() } : x)),
      }))
    },
    toggleTodoDone(id) {
      mutate((s) => ({
        ...s,
        todos: s.todos.map((x) => {
          if (x.id !== id) return x
          const done = x.status !== 'done'
          // Parent -> children: (un)completing the todo (un)checks every subtask.
          const subtasks = x.subtasks.map((st) => ({ ...st, done }))
          // Rouvrir une tâche qui gardait un créneau ENCORE VALABLE la remet
          // « planifiée » ; un créneau périmé est simplement abandonné.
          const reopened = done ? null : reopenSlot(x)
          return {
            ...x,
            done,
            status: done ? 'done' : reopened.status,
            scheduled: done ? x.scheduled : reopened.scheduled,
            waiting: null, // terminer ou reprendre clôt l'attente en cours
            focus: done ? null : x.focus, // terminée -> sort du plan du jour
            doneAt: done ? stamp() : null,
            // Le robot tranche : créneau à venir -> événement retiré ; créneau
            // déjà passé -> conservé comme trace de ce qui a été fait.
            calendarSync: needsCalendarSync(x) ? 'pending' : x.calendarSync,
            subtasks,
            updatedAt: stamp(),
          }
        }),
      }))
    },
    // Réserve un créneau : la tâche sort de « À faire » et part dans l'agenda
    // (l'app ne fait que demander — c'est le robot Apps Script qui écrit).
    scheduleTodo(id, { date, time = '', durationMinutes = 60 } = {}) {
      if (!date) return
      mutate((s) => ({
        ...s,
        todos: s.todos.map((x) => {
          if (x.id !== id) return x
          const slot = { date, time, durationMinutes }
          // Reconfirmer le même créneau doit aussi pouvoir RÉPARER : si aucun
          // événement n'est rattaché, on relance le robot même sans changement.
          const changed =
            stableStringify(slot) !== stableStringify(x.scheduled) ||
            x.status !== 'scheduled' ||
            (!x.calendarEventId && x.calendarSync !== 'pending')
          return {
            ...x,
            done: false,
            doneAt: null,
            status: 'scheduled',
            scheduled: slot,
            waiting: null, // un créneau réservé clôt l'attente
            focus: null, // le créneau remplace l'épingle du jour
            calendarSync: changed ? 'pending' : x.calendarSync,
            updatedAt: stamp(),
          }
        }),
      }))
    },
    // Retire le créneau : retour dans « À faire », événement supprimé par le robot.
    unscheduleTodo(id) {
      mutate((s) => ({
        ...s,
        todos: s.todos.map((x) =>
          x.id === id && (x.scheduled || x.status === 'scheduled')
            ? {
                ...x,
                status: x.status === 'done' ? 'done' : 'todo',
                scheduled: null,
                calendarSync: needsCalendarSync(x) ? 'pending' : x.calendarSync,
                updatedAt: stamp(),
              }
            : x,
        ),
      }))
    },
    // Passe une tâche « En attente » (d'une réponse, d'un événement…).
    // note = de quoi/qui on attend ; followUpDate = relance optionnelle.
    setTodoWaiting(id, { note = '', followUpDate = '' } = {}) {
      mutate((s) => ({
        ...s,
        todos: s.todos.map((x) =>
          x.id === id
            ? {
                ...x,
                done: false,
                doneAt: null,
                status: 'waiting',
                waiting: { note, since: stamp(), followUpDate },
                // Attendre quelqu'un annule le créneau : sinon l'événement
                // resterait orphelin dans l'agenda pour une tâche qu'on ne
                // peut plus faire à l'heure dite.
                scheduled: null,
                calendarSync: needsCalendarSync(x) ? 'pending' : x.calendarSync,
                focus: null,
                updatedAt: stamp(),
              }
            : x,
        ),
      }))
    },
    // Épingle / retire une tâche du plan du jour (⭐ Focus).
    toggleFocus(id, today) {
      mutate((s) => ({
        ...s,
        todos: s.todos.map((x) =>
          x.id === id
            ? { ...x, focus: x.focus ? null : { date: today, count: 0 }, updatedAt: stamp() }
            : x,
        ),
      }))
    },
    // Report à la Sunsama : au premier passage d'un nouveau jour, les tâches
    // épinglées non terminées roulent vers aujourd'hui (count + 1). Idempotent.
    rolloverFocus(today) {
      mutate((s) => {
        let changed = false
        const todos = s.todos.map((x) => {
          // Seules les tâches réellement « à faire » roulent : une tâche en
          // attente ou déjà planifiée n'a rien à faire dans le plan du jour.
          if (x.status !== 'todo' || !x.focus || x.focus.date >= today) return x
          changed = true
          return { ...x, focus: { date: today, count: x.focus.count + 1 }, updatedAt: stamp() }
        })
        return changed ? { ...s, todos } : s
      })
    },
    // « Créer la suite » : nouvelle tâche héritant du projet et de la priorité.
    addFollowUpTodo(sourceId, { title, dueDate = '' } = {}) {
      const t = (title || '').trim()
      if (!t) return null
      let created = null
      mutate((s) => {
        const src = s.todos.find((x) => x.id === sourceId)
        const maxOrder = s.todos.reduce((m, x) => Math.max(m, x.order || 0), 0)
        created = newTodo({
          title: t,
          dueDate,
          priority: src ? src.priority : 'normale',
          projectId: src ? src.projectId : null,
          order: maxOrder + ORDER_STEP,
        })
        return { ...s, todos: [...s.todos, created] }
      })
      return created ? created.id : null
    },
    // La réponse est arrivée : la tâche redevient « À faire ».
    resumeTodo(id) {
      mutate((s) => ({
        ...s,
        todos: s.todos.map((x) =>
          x.id === id && x.status === 'waiting'
            ? { ...x, status: 'todo', waiting: null, updatedAt: stamp() }
            : x,
        ),
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

    // ---------- v9 : l'arbre de la page Plan ----------

    // Une etape sous un sujet. Un seul objet ecrit : le parent n'est pas touche,
    // donc creer une etape ne peut pas entrer en conflit avec une modification
    // faite au meme moment sur le sujet depuis l'autre appareil.
    addChildTodo(parentId, title) {
      const t = (title || '').trim()
      if (!t) return null
      const created = newTodo({ title: t, parentId: parentId || null })
      let ok = false
      mutate((s) => {
        if (parentId && !s.todos.some((x) => x.id === parentId)) return s
        ok = true
        return { ...s, todos: [...s.todos, created] }
      })
      return ok ? created.id : null
    },

    // Ranger sous la ligne du dessus (fleche ->). Le glisser-deposer n'existe
    // pas au doigt sur Android Chrome — verifie : aucun gestionnaire pointer ou
    // touch dans le projet — donc c'est ce geste-la, ou rien, sur le telephone.
    indentTodo(id) {
      mutate((s) => {
        const map = childrenByParent(s.todos)
        const self = s.todos.find((x) => x.id === id)
        if (!self) return s
        const key = self.parentId && s.todos.some((x) => x.id === self.parentId) ? self.parentId : ROOT
        const siblings = map.get(key) || []
        const i = siblings.findIndex((x) => x.id === id)
        if (i <= 0) return s // premier de sa fratrie : rien au-dessus pour l'accueillir
        const target = siblings[i - 1].id
        if (!canMoveUnder(s.todos, id, target)) return s
        return { ...s, todos: s.todos.map((x) => (x.id === id ? { ...x, parentId: target, updatedAt: stamp() } : x)) }
      })
    },

    // Ressortir d'un niveau (fleche <-) : on devient le frere de son parent.
    outdentTodo(id) {
      mutate((s) => {
        const self = s.todos.find((x) => x.id === id)
        if (!self || !self.parentId) return s
        const parent = s.todos.find((x) => x.id === self.parentId)
        const next = parent ? parent.parentId || null : null
        if (!canMoveUnder(s.todos, id, next)) return s
        return { ...s, todos: s.todos.map((x) => (x.id === id ? { ...x, parentId: next, updatedAt: stamp() } : x)) }
      })
    },

    // Monter / descendre une tache DANS SA FRATRIE, a rang egal.
    // On echange les `order` : deux objets ecrits, et rien d'autre ne bouge.
    // A rang different, le tri redescendrait la tache aussitot — le geste est
    // donc refuse ici, et le bouton desactive dans la vue.
    moveWithinSiblings(id, dir) {
      mutate((s) => {
        const other = reorderNeighbour(s.todos, id, dir)
        if (!other) return s
        const self = s.todos.find((x) => x.id === id)
        const a = Number(self.order) || 0
        const b = Number(other.order) || 0
        // Ordres identiques (creees dans la meme milliseconde) : l'echange ne
        // ferait rien. On decale d'un cran plutot que de ne pas reagir.
        const [na, nb] = a === b ? [dir < 0 ? b - 1 : b + 1, b] : [b, a]
        return {
          ...s,
          todos: s.todos.map((x) => {
            if (x.id === id) return { ...x, order: na, updatedAt: stamp() }
            if (x.id === other.id) return { ...x, order: nb, updatedAt: stamp() }
            return x
          }),
        }
      })
    },

    // Cocher depuis le Plan. Deux differences avec toggleTodoDone :
    //   - un sujet dont une etape reste ouverte ne se coche pas (sa case est
    //     inerte dans la vue, et refusee ici aussi : une action du store ne se
    //     repose jamais sur l'interface pour faire respecter sa regle) ;
    //   - la derniere etape cochee fait basculer le sujet tout seul, en
    //     remontant la chaine. La remontee s'arrete des qu'un ancetre ne change
    //     pas d'etat : a 2-3 niveaux, c'est au plus deux objets ecrits.
    togglePlanDone(id) {
      mutate((s) => {
        const map = childrenByParent(s.todos)
        const self = s.todos.find((x) => x.id === id)
        if (!self) return s
        const kids = map.get(id) || []
        const done = self.status !== 'done'
        if (done && kids.length > 0 && !kids.every((k) => k.status === 'done')) return s

        const patched = new Map([[id, applyDone(self, done)]])
        for (const anc of ancestorsOf(s.todos, id)) {
          const sibs = (map.get(anc.id) || []).map((k) => patched.get(k.id) || k)
          const all = sibs.length > 0 && sibs.every((k) => k.status === 'done')
          if (all === (anc.status === 'done')) break
          patched.set(anc.id, applyDone(anc, all))
        }
        return { ...s, todos: s.todos.map((x) => patched.get(x.id) || x) }
      })
    },

    // Lancer le chrono sur une tache. Un seul tourne a la fois : en demarrer un
    // arrete le precedent ET lui compte son temps, plutot que de le perdre.
    // (La regle est tenue localement. Une fusion peut faire coexister deux
    // chronos partis de deux appareils — chacun reste arretable la ou il se
    // voit, rien n'est perdu.)
    startTimer(id, now = Date.now()) {
      mutate((s) => {
        if (!s.todos.some((x) => x.id === id)) return s
        return {
          ...s,
          todos: s.todos.map((x) => {
            if (x.id === id) return { ...x, timerStart: now, updatedAt: stamp() }
            if (!x.timerStart) return x
            return { ...bankTimer(x, now), updatedAt: stamp() }
          }),
        }
      })
    },

    // Arreter le chrono et verser le temps mesure dans spentMinutes.
    // Retourne les minutes versees (0 si rien ne tournait) pour que l'interface
    // puisse pre-remplir la question du temps.
    stopTimer(id, now = Date.now()) {
      let added = 0
      mutate((s) => {
        const t = s.todos.find((x) => x.id === id)
        if (!t || !t.timerStart) return s
        const before = Number(t.spentMinutes) || 0
        const next = bankTimer(t, now)
        added = (Number(next.spentMinutes) || 0) - before
        return { ...s, todos: s.todos.map((x) => (x.id === id ? { ...next, updatedAt: stamp() } : x)) }
      })
      return added
    },

    // Le temps qu'on PREVOIT d'y passer. C'est lui qui declenche la question
    // du temps reel a la coche : sans estimation, Cockpit ne demande rien.
    setEstimate(id, minutes) {
      const m = Math.round(Number(minutes))
      const value = Number.isFinite(m) && m > 0 ? m : null
      mutate((s) => ({
        ...s,
        todos: s.todos.map((x) => (x.id === id && x.estimateMinutes !== value ? { ...x, estimateMinutes: value, updatedAt: stamp() } : x)),
      }))
    },

    // Le temps reellement passe sur CETTE tache. Propose au moment de cocher,
    // jamais impose : une valeur absente est une information (« pas mesure »),
    // un zero force n'en serait pas une.
    setSpentMinutes(id, minutes) {
      const m = Math.round(Number(minutes))
      const value = Number.isFinite(m) && m > 0 ? m : null
      mutate((s) => ({
        ...s,
        todos: s.todos.map((x) => (x.id === id && x.spentMinutes !== value ? { ...x, spentMinutes: value, updatedAt: stamp() } : x)),
      }))
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

// Children -> parent, one direction only: unchecking a subtask REOPENS a
// completed parent. The reverse (auto-completing the parent when every subtask
// is checked) was removed on purpose: completing stays an explicit gesture, so
// the « En attente d'une suite ? » flow is never bypassed and nothing closes
// itself behind the user's back.
// Verse le temps d'un chrono en cours dans spentMinutes et l'arrete.
// Un chrono oublie est plafonne : au-dela de TIMER_CAP_MINUTES, le temps
// retenu n'est plus une mesure mais une convention — l'interface le signale
// pour qu'un chiffre invente ne passe jamais pour un chiffre constate.
function bankTimer(todo, now) {
  if (!todo.timerStart) return todo
  const raw = Math.round((now - todo.timerStart) / 60000)
  const minutes = Math.max(0, Math.min(raw, TIMER_CAP_MINUTES))
  const total = (Number(todo.spentMinutes) || 0) + minutes
  return { ...todo, timerStart: null, spentMinutes: total > 0 ? total : null }
}

// Les champs que « fait / pas fait » entraine, factorises pour que le Plan et
// l'onglet Todos ne divergent pas en silence. Le robot d'agenda tranche ensuite :
// creneau a venir -> evenement retire, creneau deja passe -> garde comme trace.
function applyDone(todo, done) {
  const reopened = done ? null : reopenSlot(todo)
  return {
    ...todo,
    done,
    status: done ? 'done' : reopened.status,
    scheduled: done ? todo.scheduled : reopened.scheduled,
    waiting: null,
    focus: done ? null : todo.focus,
    doneAt: done ? stamp() : null,
    calendarSync: needsCalendarSync(todo) ? 'pending' : todo.calendarSync,
    updatedAt: stamp(),
  }
}

function reconcileParent(todo) {
  if (!todo.subtasks.length) return todo
  const allDone = todo.subtasks.every((st) => st.done)
  if (!allDone && todo.done) {
    return {
      ...todo,
      done: false,
      ...reopenSlot(todo),
      doneAt: null,
      // Rouvrir par une sous-tâche doit rouvrir le handshake comme le ferait
      // toggleTodoDone : sinon l'événement supprimé à la complétion ne serait
      // jamais recréé et le créneau existerait sans rien dans l'agenda.
      calendarSync: needsCalendarSync(todo) ? 'pending' : todo.calendarSync,
    }
  }
  return todo
}

// Ne réveiller le handshake agenda que s'il y a réellement un événement à créer
// ou à supprimer — sinon chaque complétion de tâche ordinaire réveillerait le
// robot pour rien (et ferait tourner la synchro à vide).
function needsCalendarSync(todo) {
  return !!(todo.scheduled || todo.calendarEventId)
}

// Rouvrir une tâche terminée : on ne restaure son créneau que s'il a encore un
// sens. Un créneau passé ressusciterait un événement antidaté dans l'agenda et
// une alerte « créneau manqué » que rien ne viendrait jamais éteindre.
function reopenSlot(todo, today = todayISO()) {
  return todo.scheduled && todo.scheduled.date >= today
    ? { status: 'scheduled', scheduled: todo.scheduled }
    : { status: 'todo', scheduled: null }
}

export const store = createStore()
