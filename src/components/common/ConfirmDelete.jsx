import { useState, useRef, useEffect } from 'react'
import { IconTrash } from './Icons.jsx'

// Two-step delete: first click arms ("Confirmer ?"), second click within the
// timeout confirms; otherwise it auto-reverts.
export function ConfirmDelete({ onConfirm, title = 'Supprimer', timeout = 3000, className = '' }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  function handle() {
    if (armed) {
      clearTimeout(timer.current)
      setArmed(false)
      onConfirm()
    } else {
      setArmed(true)
      timer.current = setTimeout(() => setArmed(false), timeout)
    }
  }

  return (
    <button
      type="button"
      className={`btn btn-sm ${armed ? 'btn-danger' : 'btn-ghost btn-icon'} ${className}`}
      onClick={handle}
      onBlur={() => {
        clearTimeout(timer.current)
        setArmed(false)
      }}
      title={title}
      aria-label={armed ? 'Confirmer la suppression' : title}
    >
      {armed ? 'Confirmer ?' : <IconTrash />}
    </button>
  )
}
