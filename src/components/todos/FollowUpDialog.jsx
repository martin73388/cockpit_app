import { useEffect, useState } from 'react'
import { store } from '../../data/store.js'
import { IconX } from '../common/Icons.jsx'

// « Créer la suite » (GTD next action) : après avoir terminé une tâche, créer
// l'action suivante du même sujet — hérite du projet et de la priorité.
export function FollowUpDialog({ sourceTodo, onClose }) {
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function confirm() {
    const id = store.addFollowUpTodo(sourceTodo.id, { title, dueDate })
    if (id) onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Créer la suite">
        <div className="modal-head">
          <h2>➕ La suite du sujet</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Fermer">
            <IconX />
          </button>
        </div>
        <div className="modal-body form-grid">
          <p className="muted" style={{ margin: 0 }}>
            « {sourceTodo.title} » est terminée — quelle est la prochaine action ?
          </p>
          <div>
            <label className="label" htmlFor="fu-title">Prochaine action</label>
            <input
              id="fu-title"
              className="input"
              autoFocus
              placeholder="Ex. Relancer Jean si pas de réponse"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirm()}
            />
          </div>
          <div>
            <label className="label" htmlFor="fu-date">Échéance (optionnel)</label>
            <input id="fu-date" type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            <p className="faint" style={{ fontSize: 12, margin: '4px 0 0' }}>
              La nouvelle tâche hérite du projet et de la priorité.
            </p>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={confirm} disabled={!title.trim()}>Créer</button>
        </div>
      </div>
    </div>
  )
}
