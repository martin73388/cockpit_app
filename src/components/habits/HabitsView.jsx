import { useState } from 'react'
import { store } from '../../data/store.js'
import { useStore } from '../../hooks/useStore.js'
import { HabitForm } from './HabitForm.jsx'
import { HabitCard } from './HabitCard.jsx'
import { IconPlus, IconX } from '../common/Icons.jsx'

export function HabitsView() {
  const habits = useStore((s) => s.habits)
  const [creating, setCreating] = useState(false)
  const [editId, setEditId] = useState(null)

  const editHabit = editId ? habits.find((h) => h.id === editId) : null
  const sorted = habits.slice().sort((a, b) => a.createdAt - b.createdAt)

  function create(data) {
    store.addHabit(data)
    setCreating(false)
  }
  function saveEdit(data) {
    store.updateHabit(editId, data)
    setEditId(null)
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18 }}>Habitudes</h2>
        <span className="spacer" style={{ flex: 1 }} />
        {!creating && (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <IconPlus width={16} height={16} /> Nouvelle habitude
          </button>
        )}
      </div>

      {creating && (
        <div className="card settings-section" style={{ marginBottom: 16 }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, flex: 1 }}>Nouvelle habitude</h2>
            <button className="btn btn-ghost btn-icon" onClick={() => setCreating(false)} aria-label="Fermer">
              <IconX />
            </button>
          </div>
          <HabitForm onSubmit={create} onCancel={() => setCreating(false)} submitLabel="Créer" />
        </div>
      )}

      {sorted.length === 0 && !creating ? (
        <div className="empty">
          <h3>Aucune habitude</h3>
          <p className="muted">Créez une habitude ; l'événement d'agenda est géré automatiquement.</p>
        </div>
      ) : (
        <div className="habit-grid">
          {sorted.map((h) => (
            <HabitCard key={h.id} habit={h} onEdit={setEditId} />
          ))}
        </div>
      )}

      {editHabit && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setEditId(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Modifier l'habitude">
            <div className="modal-head">
              <h2>Modifier l'habitude</h2>
              <button className="btn btn-ghost btn-icon" onClick={() => setEditId(null)} aria-label="Fermer">
                <IconX />
              </button>
            </div>
            <div className="modal-body">
              <HabitForm habit={editHabit} onSubmit={saveEdit} onCancel={() => setEditId(null)} submitLabel="Enregistrer" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
