import { useState } from 'react'
import { store } from '../../data/store.js'
import { todoProgress } from '../../utils/todoView.js'
import { reorderList } from '../../utils/reorder.js'
import { IconPlus, IconX, IconGrip } from '../common/Icons.jsx'

// Subtasks: add / check / rename / remove / reorder (drag) + progress bar.
export function SubtaskList({ todo }) {
  const [draft, setDraft] = useState('')
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)
  const { done, total, pct } = todoProgress(todo)

  function add() {
    const t = draft.trim()
    if (!t) return
    store.addSubtask(todo.id, t)
    setDraft('')
  }

  function onDrop(targetId) {
    if (dragId && dragId !== targetId) {
      const next = reorderList(
        todo.subtasks.map((s) => s.id),
        dragId,
        targetId,
      )
      store.reorderSubtasks(todo.id, next)
    }
    setDragId(null)
    setOverId(null)
  }

  return (
    <div className="subtasks">
      {total > 0 && (
        <div className="subtask-progress">
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <span className="pct">
            {done}/{total}
          </span>
        </div>
      )}

      {todo.subtasks.map((st) => (
        <div
          key={st.id}
          className={`subtask ${st.done ? 'done' : ''} ${dragId === st.id ? 'dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setOverId(st.id)
          }}
          onDrop={() => onDrop(st.id)}
          style={overId === st.id && dragId ? { background: 'var(--surface-2)', borderRadius: 8 } : undefined}
        >
          {/* Only the handle is draggable — keeps the title <input> selectable/caret-placeable. */}
          <span
            className="drag-handle"
            draggable
            onDragStart={(e) => {
              setDragId(st.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => {
              setDragId(null)
              setOverId(null)
            }}
            title="Glisser pour réordonner"
            aria-label="Réordonner la sous-tâche"
          >
            <IconGrip width={14} height={14} />
          </span>
          <input
            type="checkbox"
            className="check check-sm"
            checked={st.done}
            onChange={() => store.toggleSubtask(todo.id, st.id)}
            aria-label={`Terminer ${st.title}`}
          />
          <input
            className="subtask-title"
            value={st.title}
            onChange={(e) => store.renameSubtask(todo.id, st.id, e.target.value)}
            aria-label="Sous-tâche"
          />
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            onClick={() => store.removeSubtask(todo.id, st.id)}
            aria-label="Retirer la sous-tâche"
          >
            <IconX width={14} height={14} />
          </button>
        </div>
      ))}

      <div className="subtask-add">
        <input
          className="input"
          placeholder="Ajouter une sous-tâche…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <button type="button" className="btn btn-sm" onClick={add} aria-label="Ajouter la sous-tâche">
          <IconPlus width={16} height={16} />
        </button>
      </div>
    </div>
  )
}
