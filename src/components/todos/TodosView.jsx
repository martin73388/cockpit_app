import { useEffect, useMemo, useRef, useState } from 'react'
import { store } from '../../data/store.js'
import { useStore } from '../../hooks/useStore.js'
import { STATUS_FILTERS, STATUS_LABEL, SORTS, SORT_LABEL, PRIORITIES, PRIORITY_LABEL, LAYOUTS } from '../../data/model.js'
import { visibleTodos } from '../../utils/todoView.js'
import { reorderList } from '../../utils/reorder.js'
import { TodoItem } from './TodoItem.jsx'
import { TodoEditModal } from './TodoEditModal.jsx'
import { WaitingDialog } from './WaitingDialog.jsx'
import { IconPlus, IconSearch } from '../common/Icons.jsx'

const ALL_PRIORITIES = ['haute', 'normale', 'basse']

export function TodosView({ projects, ui, onUi }) {
  const todos = useStore((s) => s.todos)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [editId, setEditId] = useState(null)
  const [waitingId, setWaitingId] = useState(null)
  const [justDone, setJustDone] = useState(null) // { id, title } -> toast « En attente d'une suite ? »
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)
  const doneTimer = useRef(null)

  useEffect(() => () => clearTimeout(doneTimer.current), [])

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const projectLabelOf = (id) => (id ? projectsById.get(id)?.label : '')

  const priorities = ui.priorities || ALL_PRIORITIES
  const filters = { query, status: ui.status, priorities, sort: ui.sort }
  const shown = useMemo(
    () => visibleTodos(todos, filters, projectLabelOf),
    [todos, query, ui.status, priorities, ui.sort, projectsById],
  )

  const waitingCount = todos.filter((t) => t.status === 'waiting').length
  const allPrios = priorities.length === 3
  const sortable = ui.sort === 'manual' && !query.trim() && ui.status === 'all' && allPrios
  const editTodo = editId ? todos.find((t) => t.id === editId) : null
  const waitingTodo = waitingId ? todos.find((t) => t.id === waitingId) : null

  function addTodo() {
    const id = store.addTodo(draft)
    if (id) setDraft('')
  }

  function togglePriority(p) {
    const next = priorities.includes(p) ? priorities.filter((x) => x !== p) : [...priorities, p]
    if (next.length === 0) return // au moins une priorité visible
    onUi({ priorities: next })
  }

  // Cocher termine tout de suite ; un toast propose quelques secondes de basculer
  // le sujet « En attente d'une suite » (le geste rapide reste fluide).
  function handleToggleDone(todo) {
    const wasDone = todo.status === 'done'
    store.toggleTodoDone(todo.id)
    if (!wasDone) {
      setJustDone({ id: todo.id, title: todo.title })
      clearTimeout(doneTimer.current)
      doneTimer.current = setTimeout(() => setJustDone(null), 6000)
    }
  }

  function waitFromToast() {
    const t = todos.find((x) => x.id === justDone.id)
    if (t) {
      if (t.status === 'done') store.toggleTodoDone(t.id) // annule le done
      setWaitingId(t.id) // le dialogue posera note + date puis passera en attente
    }
    clearTimeout(doneTimer.current)
    setJustDone(null)
  }

  const drag = {
    dragId,
    overId,
    setDragId,
    setOverId,
    orderOf: (id) => shown.findIndex((t) => t.id === id),
    reset: () => {
      setDragId(null)
      setOverId(null)
    },
    onDropOn(targetId) {
      if (dragId && dragId !== targetId) {
        const next = reorderList(shown.map((t) => t.id), dragId, targetId)
        store.setManualOrder(next)
      }
      setDragId(null)
      setOverId(null)
    },
  }

  return (
    <div>
      <div className="quick-add">
        <input
          className="input"
          placeholder="Ajouter une tâche… (Entrée)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTodo()}
          aria-label="Nouvelle tâche"
        />
        <button className="btn btn-primary" onClick={addTodo}>
          <IconPlus width={16} height={16} /> Ajouter
        </button>
      </div>

      <div className="toolbar">
        <div className="search row" style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 10, color: 'var(--text-faint)', pointerEvents: 'none' }}>
            <IconSearch width={16} height={16} />
          </span>
          <input
            className="input"
            style={{ paddingLeft: 34 }}
            placeholder="Rechercher…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Rechercher dans les tâches"
          />
        </div>

        <div className="segmented" role="group" aria-label="Mise en page">
          {LAYOUTS.map((l) => (
            <button key={l} aria-pressed={ui.layout === l} onClick={() => onUi({ layout: l })}>
              {l === 'rows' ? 'Lignes' : 'Cartes'}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-row">
        <div className="segmented" role="group" aria-label="Statut">
          {STATUS_FILTERS.map((s) => (
            <button key={s} aria-pressed={ui.status === s} onClick={() => onUi({ status: s })}>
              {STATUS_LABEL[s]}
              {s === 'waiting' && waitingCount > 0 ? ` (${waitingCount})` : ''}
            </button>
          ))}
        </div>

        {/* Priorités en multi-choix : décocher « Basse » = haute + normale seulement. */}
        <div className="segmented prio-picker" role="group" aria-label="Priorités affichées">
          {PRIORITIES.map((p) => (
            <button key={p} aria-pressed={priorities.includes(p)} onClick={() => togglePriority(p)}>
              {PRIORITY_LABEL[p]}
            </button>
          ))}
        </div>

        <select className="select" style={{ width: 'auto' }} value={ui.sort} onChange={(e) => onUi({ sort: e.target.value })} aria-label="Trier">
          {SORTS.map((s) => (
            <option key={s} value={s}>Tri : {SORT_LABEL[s]}</option>
          ))}
        </select>

        <span className="count-hint">{shown.length} tâche{shown.length > 1 ? 's' : ''}</span>
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <h3>Rien ici</h3>
          <p className="muted">
            {todos.length === 0 ? 'Ajoutez votre première tâche ci-dessus.' : 'Aucune tâche ne correspond aux filtres.'}
          </p>
        </div>
      ) : (
        <div className={`todo-list ${ui.layout}`}>
          {shown.map((t) => (
            <TodoItem
              key={t.id}
              todo={t}
              projectsById={projectsById}
              layout={ui.layout}
              sortable={sortable}
              drag={drag}
              onOpenModal={setEditId}
              onToggleDone={() => handleToggleDone(t)}
              onWait={() => setWaitingId(t.id)}
            />
          ))}
        </div>
      )}

      {!sortable && ui.sort === 'manual' && (query || ui.status !== 'all' || !allPrios) && (
        <p className="faint" style={{ marginTop: 12, fontSize: 13 }}>
          Le glisser-déposer est actif en tri Manuel sans filtre ni recherche.
        </p>
      )}

      {editTodo && <TodoEditModal todo={editTodo} projects={projects} onClose={() => setEditId(null)} />}
      {waitingTodo && <WaitingDialog todo={waitingTodo} onClose={() => setWaitingId(null)} />}

      {justDone && (
        <div className="toast done-toast" role="status">
          ✓ « {justDone.title.slice(0, 32)} » terminée
          <button className="btn btn-sm" onClick={waitFromToast}>📩 En attente d'une suite ?</button>
        </div>
      )}
    </div>
  )
}
