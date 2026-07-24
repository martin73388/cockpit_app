import { useState } from 'react'
import { store } from '../../data/store.js'
import { PRIORITY_LABEL } from '../../data/model.js'
import { isOverdue, dueLabel, todayISO, daysSince } from '../../utils/dates.js'
import { todoProgress } from '../../utils/todoView.js'
import { SubtaskList } from './SubtaskList.jsx'
import { ConfirmDelete } from '../common/ConfirmDelete.jsx'
import { IconCopy, IconEdit, IconGrip, IconCalendar } from '../common/Icons.jsx'

export function TodoItem({ todo, projectsById, layout, sortable, drag, onOpenModal, onToggleDone, onWait }) {
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(todo.title)
  const [open, setOpen] = useState(false)

  const overdue = isOverdue(todo)
  const progress = todoProgress(todo)
  const projectLabel = todo.projectId ? projectsById.get(todo.projectId)?.label : null

  function commitTitle() {
    const t = draftTitle.trim()
    if (t && t !== todo.title) store.updateTodo(todo.id, { title: t })
    else setDraftTitle(todo.title)
    setEditing(false)
  }

  // Show the drop indicator on the side the item will actually land: after the
  // target when dragging downward, before it when dragging upward.
  let dropClass = ''
  if (drag.overId === todo.id && drag.dragId && drag.dragId !== todo.id) {
    dropClass = drag.orderOf(drag.dragId) < drag.orderOf(todo.id) ? 'drop-after' : 'drop-before'
  }

  return (
    <div
      className={`card todo-item ${layout} ${todo.done ? 'done' : ''} ${drag.dragId === todo.id ? 'dragging' : ''} ${dropClass}`}
      onDragOver={sortable ? (e) => { e.preventDefault(); drag.setOverId(todo.id) } : undefined}
      onDrop={sortable ? () => drag.onDropOn(todo.id) : undefined}
    >
      {sortable && (
        <span
          className="drag-handle"
          draggable
          onDragStart={(e) => {
            drag.setDragId(todo.id)
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', todo.id)
          }}
          onDragEnd={() => drag.reset()}
          title="Glisser pour réordonner"
          aria-label="Réordonner"
        >
          <IconGrip />
        </span>
      )}

      <input
        type="checkbox"
        className="check"
        checked={todo.done}
        onChange={() => (onToggleDone ? onToggleDone() : store.toggleTodoDone(todo.id))}
        aria-label={todo.done ? 'Marquer à faire' : 'Marquer comme fait'}
      />

      <div className="todo-main">
        <div className="todo-title-row">
          {editing ? (
            <input
              className="input"
              value={draftTitle}
              autoFocus
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTitle()
                if (e.key === 'Escape') {
                  setDraftTitle(todo.title)
                  setEditing(false)
                }
              }}
            />
          ) : (
            <span
              className="todo-title"
              onClick={() => {
                setDraftTitle(todo.title)
                setEditing(true)
              }}
              title="Cliquer pour renommer"
            >
              {todo.title || <span className="faint">(sans titre)</span>}
            </span>
          )}
          {todo.priority !== 'normale' && (
            <span className={`chip prio-${todo.priority}`}>{PRIORITY_LABEL[todo.priority]}</span>
          )}
        </div>

        {layout === 'cards' && todo.notes && <div className="todo-notes">{todo.notes}</div>}

        <div className="todo-meta">
          {todo.status === 'waiting' && todo.waiting && (
            <span
              className={`chip waiting-chip ${
                (todo.waiting.followUpDate && todo.waiting.followUpDate <= todayISO()) ||
                (!todo.waiting.followUpDate && daysSince(todo.waiting.since) > 7)
                  ? 'overdue'
                  : ''
              }`}
              title={todo.waiting.followUpDate ? `Relance le ${todo.waiting.followUpDate}` : 'Pas de date de relance'}
            >
              📩 {todo.waiting.note || 'En attente'} — {daysSince(todo.waiting.since)} j
            </span>
          )}
          {todo.dueDate && (
            <span className={`chip ${overdue ? 'overdue' : ''}`}>
              <IconCalendar width={13} height={13} /> {dueLabel(todo.dueDate)}
            </span>
          )}
          {projectLabel && <span className="chip">{projectLabel}</span>}
          {progress.total > 0 && (
            <button className="chip" onClick={() => setOpen((o) => !o)} type="button">
              ☑ {progress.done}/{progress.total}
            </button>
          )}
          {progress.total === 0 && (
            <button className="chip" onClick={() => setOpen((o) => !o)} type="button">
              + sous-tâches
            </button>
          )}
        </div>

        {open && <SubtaskList todo={todo} />}
      </div>

      <div className="todo-actions">
        {todo.status === 'waiting' ? (
          <button className="btn btn-sm" onClick={() => store.resumeTodo(todo.id)} title="La réponse est arrivée : reprendre">
            Reprendre
          </button>
        ) : (
          !todo.done &&
          onWait && (
            <button className="btn btn-ghost btn-icon" onClick={onWait} title="Mettre en attente" aria-label="Mettre en attente">
              <span aria-hidden="true">📩</span>
            </button>
          )
        )}
        <button className="btn btn-ghost btn-icon" onClick={() => store.duplicateTodo(todo.id)} title="Dupliquer" aria-label="Dupliquer">
          <IconCopy />
        </button>
        <button className="btn btn-ghost btn-icon" onClick={() => onOpenModal(todo.id)} title="Modifier" aria-label="Modifier">
          <IconEdit />
        </button>
        <ConfirmDelete onConfirm={() => store.deleteTodo(todo.id)} />
      </div>
    </div>
  )
}
