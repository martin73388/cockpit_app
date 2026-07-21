import { useMemo, useState } from 'react'
import { store } from '../../data/store.js'
import { useStore } from '../../hooks/useStore.js'
import { STATUS_FILTERS, STATUS_LABEL, SORTS, SORT_LABEL, PRIORITIES, PRIORITY_LABEL, LAYOUTS } from '../../data/model.js'
import { visibleTodos } from '../../utils/todoView.js'
import { reorderList } from '../../utils/reorder.js'
import { TodoItem } from './TodoItem.jsx'
import { TodoEditModal } from './TodoEditModal.jsx'
import { IconPlus, IconSearch } from '../common/Icons.jsx'

export function TodosView({ projects, ui, onUi }) {
  const todos = useStore((s) => s.todos)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [editId, setEditId] = useState(null)
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const projectLabelOf = (id) => (id ? projectsById.get(id)?.label : '')

  const filters = { query, status: ui.status, priority: ui.priority, sort: ui.sort }
  const shown = useMemo(
    () => visibleTodos(todos, filters, projectLabelOf),
    [todos, query, ui.status, ui.priority, ui.sort, projectsById],
  )

  const sortable = ui.sort === 'manual' && !query.trim() && ui.status === 'all' && ui.priority === 'all'
  const editTodo = editId ? todos.find((t) => t.id === editId) : null

  function addTodo() {
    const id = store.addTodo(draft)
    if (id) setDraft('')
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
            </button>
          ))}
        </div>

        <select className="select" style={{ width: 'auto' }} value={ui.priority} onChange={(e) => onUi({ priority: e.target.value })} aria-label="Filtrer par priorité">
          <option value="all">Toutes priorités</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
          ))}
        </select>

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
            />
          ))}
        </div>
      )}

      {!sortable && ui.sort === 'manual' && (query || ui.status !== 'all' || ui.priority !== 'all') && (
        <p className="faint" style={{ marginTop: 12, fontSize: 13 }}>
          Le glisser-déposer est actif en tri Manuel sans filtre ni recherche.
        </p>
      )}

      {editTodo && <TodoEditModal todo={editTodo} projects={projects} onClose={() => setEditId(null)} />}
    </div>
  )
}
