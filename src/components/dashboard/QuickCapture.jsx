import { useEffect, useRef, useState } from 'react'
import { store } from '../../data/store.js'
import { useStore } from '../../hooks/useStore.js'
import { ConfirmDelete } from '../common/ConfirmDelete.jsx'
import { IconPlus } from '../common/Icons.jsx'

// Section 1 — quick capture / inbox.
// Field + Enter -> unprocessed inbox item, "Capturé" feedback, field cleared.
// Collapsible "n à trier" list: per item -> convert to todo, or delete (tombstone).
// "Récemment trié" shows the last ~5 processed items with their note.
export function QuickCapture() {
  const inbox = useStore((s) => s.inbox)
  const [draft, setDraft] = useState('')
  const [captured, setCaptured] = useState(false)
  const [open, setOpen] = useState(false)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  const pending = inbox.filter((i) => i.processedAt == null)
  const processed = inbox
    .filter((i) => i.processedAt != null)
    .sort((a, b) => b.processedAt - a.processedAt)
    .slice(0, 5)

  function capture() {
    const id = store.addInboxItem(draft)
    if (!id) return
    setDraft('')
    setCaptured(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCaptured(false), 2000)
  }

  return (
    <section className="card dash-section" aria-label="Capture rapide">
      <div className="row">
        <input
          className="input"
          placeholder="Vider la tête… (Entrée)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && capture()}
          aria-label="Capture rapide"
        />
        <button className="btn btn-primary btn-icon" onClick={capture} aria-label="Capturer">
          <IconPlus />
        </button>
      </div>
      {captured && <div className="capture-feedback">Capturé ✓</div>}

      {pending.length > 0 && (
        <button className="btn btn-ghost btn-sm inbox-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {pending.length} à trier {open ? '▾' : '▸'}
        </button>
      )}

      {open && pending.length > 0 && (
        <div className="inbox-list">
          {pending.map((i) => (
            <div key={i.id} className="inbox-item">
              <span className="inbox-text">{i.text}</span>
              <button
                className="btn btn-sm"
                onClick={() => store.processInboxToTodo(i.id)}
                title="Convertir en todo"
              >
                → todo
              </button>
              <ConfirmDelete onConfirm={() => store.deleteInboxItem(i.id)} />
            </div>
          ))}
        </div>
      )}

      {open && processed.length > 0 && (
        <div className="inbox-processed">
          <span className="label">Récemment trié</span>
          {processed.map((i) => (
            <div key={i.id} className="inbox-item processed">
              <span className="inbox-text">{i.text}</span>
              <span className="faint">{i.processedNote}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
