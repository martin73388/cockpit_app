import { useEffect, useState } from 'react'
import { store } from '../../data/store.js'
import { IconX } from '../common/Icons.jsx'

// « Mettre en attente » : de quoi/qui attend-on, et relance optionnelle.
// Utilisé depuis l'action 📩 d'une tâche et depuis le toast de complétion.
export function WaitingDialog({ todo, onClose }) {
  const [note, setNote] = useState(todo.waiting?.note || '')
  const [followUpDate, setFollowUpDate] = useState(todo.waiting?.followUpDate || '')

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function confirm() {
    store.setTodoWaiting(todo.id, { note: note.trim(), followUpDate })
    onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Mettre en attente">
        <div className="modal-head">
          <h2>📩 En attente d'une suite</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Fermer">
            <IconX />
          </button>
        </div>
        <div className="modal-body form-grid">
          <p className="muted" style={{ margin: 0 }}>
            « {todo.title} » sort de la liste À faire et reste surveillée depuis le Dashboard.
          </p>
          <div>
            <label className="label" htmlFor="wait-note">En attente de quoi / qui ?</label>
            <input
              id="wait-note"
              className="input"
              autoFocus
              placeholder="Ex. réponse de Jean"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirm()}
            />
          </div>
          <div>
            <label className="label" htmlFor="wait-date">Relancer le (optionnel)</label>
            <input
              id="wait-date"
              type="date"
              className="input"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
            />
            <p className="faint" style={{ fontSize: 12, margin: '4px 0 0' }}>
              À cette date, la tâche remonte dans « Aujourd'hui ». Sans date, une alerte
              apparaît après 7 jours d'attente.
            </p>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={confirm}>Mettre en attente</button>
        </div>
      </div>
    </div>
  )
}
