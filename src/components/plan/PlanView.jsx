import { useState, useRef } from 'react'
import { store } from '../../data/store.js'
import { useStore } from '../../hooks/useStore.js'
import { SPENT_CHOICES } from '../../data/model.js'
import { isOverdue } from '../../utils/dates.js'
import { childrenByParent, progressOf, canCheck, spentOf, formatSpent } from '../../utils/tree.js'

// Page Plan — les tâches en arbre, et rien d'autre.
//
// Parti pris, décidés avec Martin :
//   · les faites DISPARAISSENT ; l'avancement se lit sur le parent (« 3/5 »)
//   · un sujet ne se coche pas à la main, il bascule quand sa dernière étape
//     tombe — sa case est donc inerte tant qu'il reste du travail dessous
//   · → range sous la ligne du dessus, ← ressort d'un niveau (le glisser-
//     déposer ne se déclenche pas au doigt sur Android Chrome)
//   · au moment de cocher une tâche ESTIMÉE, on propose le temps réel
//
// Le décalage vaut 14 px et s'arrête à 4 niveaux : au-delà, la ligne se
// décalerait sans que le titre ait encore de la place sur un écran de 240 px.
const INDENT = 14
const MAX_INDENT = 4

function Row({ node, todos, onAsk, askId, onSpent, onAddUnder, addingHere, active, onActivate }) {
  const { todo, depth, children } = node
  const open = children.filter((c) => c.status !== 'done')
  const prog = progressOf(children)
  const checkable = canCheck(todo, children)
  const spent = spentOf(todos, todo.id)
  const late = isOverdue(todo)
  const name = todo.title || 'Sans titre'

  return (
    <>
      <div className="plan-line">
        <input
          type="checkbox"
          className="check"
          checked={todo.status === 'done'}
          disabled={!checkable}
          onChange={() => onAsk(todo)}
          aria-label={checkable ? `Marquer comme fait : ${name}` : `${name} : ${open.length} étape${open.length > 1 ? 's' : ''} à finir d’abord`}
          title={checkable ? 'Marquer comme fait' : 'Il reste des étapes à finir'}
        />
        {/* Le titre est un bouton : il ouvre les contrôles de la ligne. Sur
            240 px, trois boutons permanents mangeaient 37 % de la largeur et
            les titres se coupaient en plein mot. Ils n'apparaissent donc que
            sur la ligne qu'on touche. */}
        <button
          type="button"
          className={`plan-title${late ? ' is-late' : ''}`}
          onClick={() => onActivate(active ? null : todo.id)}
          aria-expanded={active}
          aria-label={`${name} — ouvrir les actions`}
        >
          {name}
        </button>

        {prog.total > 0 && (
          <span className="plan-prog" title={`${prog.done} étape(s) faite(s) sur ${prog.total}`}>
            {prog.done}/{prog.total}
          </span>
        )}
        {todo.estimateMinutes > 0 && !spent.minutes ? (
          <span className="plan-est" title="Temps estimé">~{formatSpent(todo.estimateMinutes)}</span>
        ) : null}
        {spent.minutes > 0 && (
          <span
            className="plan-spent"
            title={
              `Temps passé : ${formatSpent(spent.minutes)}` +
              (todo.estimateMinutes > 0 ? ` · estimé ${formatSpent(todo.estimateMinutes)}` : '') +
              (spent.missing > 0 ? ` · ${spent.missing} étape(s) non chronométrée(s)` : '')
            }
          >
            {formatSpent(spent.minutes)}
            {spent.missing > 0 ? '+' : ''}
          </span>
        )}
        {todo.status === 'waiting' && (
          <span className="plan-wait" title={todo.waiting?.note || 'En attente'}>⧗</span>
        )}

      </div>

      {active && (
        <div className="plan-moves" role="group" aria-label={`Actions : ${name}`}>
          <button type="button" className="plan-move" onClick={() => store.outdentTodo(todo.id)} aria-label={`Ressortir d’un niveau : ${name}`}>← ressortir</button>
          <button type="button" className="plan-move" onClick={() => store.indentTodo(todo.id)} aria-label={`Ranger sous la tâche du dessus : ${name}`}>→ ranger dessous</button>
          {/* Sans ce +, une tache sans etape ne pourrait jamais en recevoir —
              or decouper un sujet est le geste central de la page. */}
          <button
            type="button"
            className={`plan-move${addingHere ? ' is-on' : ''}`}
            onClick={() => onAddUnder(addingHere ? null : todo.id)}
            aria-label={`Ajouter une étape sous : ${name}`}
            aria-expanded={addingHere}
          >
            + étape
          </button>
        </div>
      )}

      {todo.status === 'waiting' && todo.waiting?.note ? (
        <p className="plan-wait-note">{todo.waiting.note}</p>
      ) : null}

      {askId === todo.id && (
        <div className="plan-spent-ask" role="group" aria-label={`Temps passé sur : ${name}`}>
          <span>Ça t’a pris&nbsp;?</span>
          {SPENT_CHOICES.map((m) => (
            <button key={m} type="button" className="plan-chip" onClick={() => onSpent(todo.id, m)}>
              {formatSpent(m)}
            </button>
          ))}
          <button type="button" className="plan-chip is-skip" onClick={() => onSpent(todo.id, null)}>
            passer
          </button>
        </div>
      )}
    </>
  )
}

function AddLine({ parentId, label }) {
  const [value, setValue] = useState('')
  const ref = useRef(null)
  function submit(e) {
    e.preventDefault()
    const t = value.trim()
    if (!t) return
    store.addChildTodo(parentId, t)
    setValue('') // on reste dans le champ : taper une liste d'un trait
    ref.current?.focus()
  }
  return (
    <form className="plan-add" onSubmit={submit}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={label}
        aria-label={label}
        enterKeyHint="done"
      />
    </form>
  )
}

function Group({ parentId, depth, byParent, todos, onAsk, askId, onSpent, addUnder, onAddUnder, activeId, onActivate }) {
  const children = byParent.get(parentId || '\u0000root') || []
  // `byParent` est déjà bâti sur les tâches vivantes + celle en attente de
  // réponse : on n'a rien à refiltrer ici, sinon la question disparaîtrait.
  const open = children
  if (depth > 0 && open.length === 0) return null
  return (
    <ul className="plan-list">
      {open.map((todo) => (
        <li key={todo.id} className="plan-row" style={{ paddingLeft: Math.min(depth, MAX_INDENT) * INDENT }}>
          <Row
            node={{ todo, depth, children: byParent.get(todo.id) || [] }}
            todos={todos}
            onAsk={onAsk}
            askId={askId}
            onSpent={onSpent}
            onAddUnder={onAddUnder}
            addingHere={addUnder === todo.id}
            active={activeId === todo.id}
            onActivate={onActivate}
          />
          {addUnder === todo.id && (
            <div style={{ paddingLeft: INDENT }}>
              <AddLine parentId={todo.id} label="+ Ajouter ici…" />
            </div>
          )}
          <Group
            parentId={todo.id}
            depth={depth + 1}
            byParent={byParent}
            todos={todos}
            onAsk={onAsk}
            askId={askId}
            onSpent={onSpent}
            addUnder={addUnder}
            onAddUnder={onAddUnder}
            activeId={activeId}
            onActivate={onActivate}
          />
        </li>
      ))}
      {depth === 0 && (
        <li className="plan-row plan-row-add">
          <AddLine parentId={null} label="+ Ajouter une tâche…" />
        </li>
      )}
    </ul>
  )
}

export function PlanView() {
  const todos = useStore((s) => s.todos)
  const [askId, setAskId] = useState(null)
  const [addUnder, setAddUnder] = useState(null)
  const [activeId, setActiveId] = useState(null)

  // La tâche qu'on vient de cocher reste à l'écran tant qu'on ne lui a pas
  // répondu : sans ça elle disparaissait à l'instant du clic et emportait la
  // question du temps avec elle — la fonctionnalité était inatteignable.
  const live = todos.filter((t) => t.status !== 'done' || t.id === askId)
  const byParent = childrenByParent(live)

  // Cocher : on bascule d'abord, on demande le temps ensuite — et seulement si
  // Martin avait estimé la tâche. Sur les autres, la question serait un péage
  // quotidien pour une donnée qu'il n'a pas demandé à mesurer.
  function ask(todo) {
    store.togglePlanDone(todo.id)
    if (todo.estimateMinutes > 0) setAskId(todo.id)
  }
  function setSpent(id, minutes) {
    if (minutes != null) store.setSpentMinutes(id, minutes)
    setAskId(null)
  }

  return (
    <section className="plan" aria-label="Plan">
      <Group
        parentId={null}
        depth={0}
        byParent={byParent}
        todos={todos}
        onAsk={ask}
        askId={askId}
        onSpent={setSpent}
        addUnder={addUnder}
        onAddUnder={setAddUnder}
        activeId={activeId}
        onActivate={setActiveId}
      />
    </section>
  )
}
