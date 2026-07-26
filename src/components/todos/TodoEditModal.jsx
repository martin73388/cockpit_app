import { useEffect } from 'react'
import { store } from '../../data/store.js'
import { PRIORITIES, PRIORITY_LABEL, ESTIMATES } from '../../data/model.js'
import { formatDuration } from '../../utils/dates.js'
import { ProjectSelect } from './ProjectSelect.jsx'
import { SubtaskList } from './SubtaskList.jsx'
import { IconX } from '../common/Icons.jsx'

// Full-field edit in a modal (title, notes, priority, due date, project, subtasks).
export function TodoEditModal({ todo, projects, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!todo) return null

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Modifier la tâche">
        <div className="modal-head">
          <h2>Modifier la tâche</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Fermer">
            <IconX />
          </button>
        </div>
        <div className="modal-body form-grid">
          <div>
            <label className="label" htmlFor="edit-title">Titre</label>
            <input
              id="edit-title"
              className="input"
              value={todo.title}
              autoFocus
              onChange={(e) => store.updateTodo(todo.id, { title: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="edit-notes">Notes</label>
            <textarea
              id="edit-notes"
              className="textarea"
              value={todo.notes}
              onChange={(e) => store.updateTodo(todo.id, { notes: e.target.value })}
            />
          </div>
          <div className="form-row">
            <div>
              <label className="label" htmlFor="edit-prio">Priorité</label>
              <select
                id="edit-prio"
                className="select"
                value={todo.priority}
                onChange={(e) => store.updateTodo(todo.id, { priority: e.target.value })}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="edit-due">Échéance</label>
              <input
                id="edit-due"
                type="date"
                className="input"
                value={todo.dueDate}
                onChange={(e) => store.updateTodo(todo.id, { dueDate: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="edit-estimate">Temps estimé</label>
            <select
              id="edit-estimate"
              className="select"
              value={todo.estimateMinutes ?? ''}
              onChange={(e) =>
                store.updateTodo(todo.id, { estimateMinutes: e.target.value === '' ? null : Number(e.target.value) })
              }
            >
              <option value="">— non estimé</option>
              {/* Une valeur hors presets (fichier édité à la main) reste
                  affichable : le <select> ne doit jamais mentir sur l'état. */}
              {(todo.estimateMinutes && !ESTIMATES.includes(todo.estimateMinutes)
                ? [...ESTIMATES, todo.estimateMinutes].sort((a, b) => a - b)
                : ESTIMATES
              ).map((m) => (
                <option key={m} value={m}>{formatDuration(m)}</option>
              ))}
            </select>
            <p className="faint" style={{ fontSize: 12, margin: '4px 0 0' }}>
              Affiché sur la carte, et sert à repérer ce qui tient dans un créneau libre.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="edit-project">Projet</label>
            <ProjectSelect
              id="edit-project"
              value={todo.projectId}
              projects={projects}
              onChange={(v) => store.updateTodo(todo.id, { projectId: v })}
            />
          </div>
          <div>
            <span className="label">Sous-tâches</span>
            <SubtaskList todo={todo} />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-primary" onClick={onClose}>Terminé</button>
        </div>
      </div>
    </div>
  )
}
