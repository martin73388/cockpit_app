import { useState, useRef, useEffect, Fragment } from 'react'
import { store } from '../../data/store.js'
import { useStore } from '../../hooks/useStore.js'
import { SPENT_CHOICES, ESTIMATE_CHOICES, TIMER_CAP_MINUTES, RANKS } from '../../data/model.js'
import { isOverdue, todayISO, formatDueDate } from '../../utils/dates.js'
import { workSlots } from '../../utils/slots.js'
import { ScheduleDialog } from '../todos/ScheduleDialog.jsx'
import { childrenByParent, ancestorsOf, effectiveRanks, reorderNeighbour, progressOf, canCheck, spentOf, formatSpent, ROOT } from '../../utils/tree.js'

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

function Row({ node, todos, byParent, eff, onSchedule, onAsk, ask, onSpent, onCleared, onAddUnder, addingHere, active, onActivate, now, onStart, onStop, editing, armed, onEdit, onArm }) {
  const { todo, depth, children } = node
  const open = children.filter((c) => c.status !== 'done')
  const prog = progressOf(children)
  const checkable = canCheck(todo, children)
  const spent = spentOf(todos, todo.id, byParent)
  const late = isOverdue(todo)
  const name = todo.title || 'Sans titre'
  const running = todo.timerStart ? Math.round((now - todo.timerStart) / 60000) : 0
  const rank = eff.get(todo.id) || null
  const canUp = !!reorderNeighbour(todos, todo.id, -1, byParent, eff)
  const canDown = !!reorderNeighbour(todos, todo.id, 1, byParent, eff)

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
        {editing ? (
          <RenameField id={todo.id} name={name} onDone={() => onEdit(null)} />
        ) : (
          <button
            type="button"
            className={`plan-title${late ? ' is-late' : ''}`}
            onClick={() => onActivate(active ? null : todo.id)}
            aria-expanded={active}
            aria-label={`${name} — ouvrir les actions`}
          >
            {name}
          </button>
        )}

        <span className="plan-meta">
        {/* Le rang affiché est l'EFFECTIF : un sujet porte la note la plus
            prioritaire de ses étapes, sinon une urgence enterrée ne se verrait
            nulle part. Seuls 1 et 2 crient ; au-delà tout serait coloré et
            plus rien ne ressortirait. */}
        {rank ? (
          <span
            className={`plan-rank r${rank}${todo.rank ? '' : ' is-inherited'}`}
            title={todo.rank ? `Priorité ${rank}` : `Priorité ${rank}, héritée d’une étape`}
          >
            {rank}
          </span>
        ) : null}
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
        {/* Un créneau réservé se voit sur la ligne : sinon la tâche « disparaît »
            de l'esprit sans que rien ne dise quand elle revient. */}
        {todo.status === 'scheduled' && todo.scheduled?.date ? (
          <span className="plan-slot" title={`Créneau : ${formatDueDate(todo.scheduled.date)}${todo.scheduled.time ? ` à ${todo.scheduled.time}` : ''}`}>
            {todo.scheduled.time || formatDueDate(todo.scheduled.date)}
          </span>
        ) : null}
        {/* Cocher et planifier restent directs sur la ligne — c'est ce qu'on
            avait décidé, et je l'avais oublié. Le reste passe par le panneau. */}
        <button
          type="button"
          className={`plan-cal${todo.status === 'scheduled' ? ' is-on' : ''}`}
          onClick={() => onSchedule(todo.id)}
          aria-label={`Planifier : ${name}`}
          title="Réserver un créneau"
        >
          📅
        </button>
        </span>
        {/* Un chrono qui tourne se voit TOUJOURS, barre ouverte ou non : c'est
            la seule chose qui empêche de le laisser courir toute la nuit. */}
        {todo.timerStart ? (
          <button
            type="button"
            className={`plan-run${running > TIMER_CAP_MINUTES ? ' is-over' : ''}`}
            onClick={() => onStop(todo.id)}
            aria-label={`Arrêter le chrono : ${name}`}
            title={running > TIMER_CAP_MINUTES ? `Chrono oublié — au-delà de ${formatSpent(TIMER_CAP_MINUTES)} on ne retiendra que ${formatSpent(TIMER_CAP_MINUTES)}` : 'Arrêter le chrono'}
          >
            ● {formatSpent(Math.max(1, running))}
          </button>
        ) : null}

      </div>

      {active && (
        <div className="plan-ranks" role="group" aria-label={`Priorité : ${name}`}>
          <span className="plan-ranks-lbl">Priorité</span>
          {RANKS.map((r) => (
            <button
              key={r}
              type="button"
              className={`plan-rankbtn r${r}${todo.rank === r ? ' is-on' : ''}`}
              onClick={() => store.setRank(todo.id, todo.rank === r ? null : r)}
              aria-pressed={todo.rank === r}
              aria-label={`Priorité ${r}${r === 1 ? ' (la plus urgente)' : ''} : ${name}`}
            >
              {r}
            </button>
          ))}
        </div>
      )}

      {active && (
        <div className="plan-ranks" role="group" aria-label={`Temps estimé : ${name}`}>
          <span className="plan-ranks-lbl">Estimé</span>
          {ESTIMATE_CHOICES.map((m) => (
            <button
              key={m}
              type="button"
              className={`plan-chip${todo.estimateMinutes === m ? ' is-primary' : ''}`}
              onClick={() => store.setEstimate(todo.id, todo.estimateMinutes === m ? null : m)}
              aria-pressed={todo.estimateMinutes === m}
              aria-label={`Estimer à ${formatSpent(m)} : ${name}`}
            >
              {formatSpent(m)}
            </button>
          ))}
        </div>
      )}

      {active && (
        <div className="plan-moves" role="group" aria-label={`Actions : ${name}`}>
          <span className="plan-arrows">
            <button type="button" className="plan-arrow" onClick={() => store.outdentTodo(todo.id)} aria-label={`Ressortir d’un niveau : ${name}`} title="Ressortir d’un niveau">←</button>
            <button type="button" className="plan-arrow" onClick={() => store.indentTodo(todo.id)} aria-label={`Ranger sous la tâche du dessus : ${name}`} title="Ranger sous la tâche du dessus">→</button>
            <button type="button" className="plan-arrow" onClick={() => store.moveWithinSiblings(todo.id, -1)} disabled={!canUp} aria-label={`Monter : ${name}`} title={canUp ? 'Monter' : 'Rien à égalité au-dessus'}>↑</button>
            <button type="button" className="plan-arrow" onClick={() => store.moveWithinSiblings(todo.id, 1)} disabled={!canDown} aria-label={`Descendre : ${name}`} title={canDown ? 'Descendre' : 'Rien à égalité en dessous'}>↓</button>
          </span>
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
          {todo.timerStart ? (
            <button type="button" className="plan-move is-on" onClick={() => onStop(todo.id)} aria-label={`Arrêter le chrono : ${name}`}>
              ■ arrêter le chrono
            </button>
          ) : (
            <button type="button" className="plan-move" onClick={() => onStart(todo.id)} aria-label={`Je fais ça maintenant : ${name}`}>
              ▶ je fais ça
            </button>
          )}
        </div>
      )}

      {active && (
        <div className="plan-moves" role="group" aria-label={`Modifier : ${name}`}>
          <button type="button" className="plan-move" onClick={() => onEdit(todo.id)} aria-label={`Renommer : ${name}`}>
            ✎ renommer
          </button>
          {todo.status === 'waiting' ? (
            <button type="button" className="plan-move is-wait" onClick={() => store.resumeTodo(todo.id)} aria-label={`Ne plus attendre : ${name}`}>
              ⧗ reprendre
            </button>
          ) : (
            <button type="button" className="plan-move" onClick={() => store.setTodoWaiting(todo.id, {})} aria-label={`Mettre en attente : ${name}`}>
              ⧗ en attente
            </button>
          )}
          {/* Armer puis confirmer : sur un écran de 240 px, le doigt rate, et
              supprimer une branche emporterait le rangement de ses étapes. */}
          <button
            type="button"
            className={`plan-move${armed ? ' is-danger' : ''}`}
            onClick={() => (armed ? store.deleteTodo(todo.id) : onArm(todo.id))}
            aria-label={
              armed
                ? `Confirmer la suppression de : ${name}`
                : `Supprimer : ${name}${children.length ? ` (ses ${children.length} étape${children.length > 1 ? 's' : ''} remonteront à la racine)` : ''}`
            }
          >
            {armed
              ? children.length
                ? `sûr ? (${children.length} étape${children.length > 1 ? 's' : ''} remonte${children.length > 1 ? 'nt' : ''})`
                : 'sûr ?'
              : '🗑 supprimer'}
          </button>
        </div>
      )}

      {/* Le motif ne s'affiche qu'une fois l'attente posée : un champ « pourquoi
          tu attends » sur une tâche qui n'attend rien ne veut rien dire. */}
      {active && todo.status === 'waiting' && (
        <WaitNote id={todo.id} name={name} note={todo.waiting?.note || ''} />
      )}

      {todo.status === 'waiting' && todo.waiting?.note ? (
        <p className="plan-wait-note">{todo.waiting.note}</p>
      ) : null}

      {ask && ask.id === todo.id && (
        <div className="plan-spent-ask" role="group" aria-label={`Temps passé sur : ${name}`}>
          {ask.preset > 0 ? (
            <>
              <span>Chrono&nbsp;: {formatSpent(ask.preset)}{ask.capped ? ' (plafonné)' : ''}</span>
              <button type="button" className="plan-chip is-primary" onClick={() => onSpent(todo.id, null)}>
                garder
              </button>
              <span className="plan-ask-sep">ou</span>
            </>
          ) : (
            <span>Ça t’a pris&nbsp;?</span>
          )}
          {SPENT_CHOICES.map((m) => (
            <button key={m} type="button" className="plan-chip" onClick={() => onSpent(todo.id, m)}>
              {formatSpent(m)}
            </button>
          ))}
          {ask.preset > 0 ? null : (
            <button type="button" className="plan-chip is-skip" onClick={() => onSpent(todo.id, null)}>
              passer
            </button>
          )}
        </div>
      )}

      {ask && ask.id === todo.id && <Remaining id={todo.id} name={name} onDone={onCleared} />}
    </>
  )
}

// Renommage en place : le titre cède sa ligne à un champ. Échap annule,
// Entrée valide, et un titre vidé par accident est refusé plutôt qu'enregistré
// — une tâche sans nom, dans un arbre, ne se retrouve plus.
function RenameField({ id, name, onDone }) {
  const [value, setValue] = useState(name)
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  function submit(e) {
    e.preventDefault()
    store.renameTodo(id, value)
    onDone()
  }
  return (
    <form className="plan-rename" onSubmit={submit}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone()
        }}
        aria-label={`Nouveau nom de : ${name}`}
        enterKeyHint="done"
      />
    </form>
  )
}

// Ce qu'on attend. Enregistré à la sortie du champ : sur un téléphone on ferme
// le clavier sans valider, et le motif serait perdu.
function WaitNote({ id, name, note }) {
  const [value, setValue] = useState(note)
  useEffect(() => setValue(note), [note])
  const save = () => {
    if (value !== note) store.setTodoWaiting(id, { note: value.trim() })
  }
  return (
    <form className="plan-next" onSubmit={(e) => { e.preventDefault(); save() }}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        placeholder="Tu attends quoi ?"
        aria-label={`Ce que tu attends sur : ${name}`}
        enterKeyHint="done"
      />
    </form>
  )
}

// « Il reste quelque chose ? » — proposé à chaque validation.
//
// Deux situations, relevées par Martin, qui n'en font qu'une : « j'ai envoyé le
// mail, j'attends la validation », et « en la faisant je vois qu'il manquait
// une étape ». Dans les deux cas la tâche N'EST PAS finie.
//
// Remplir ce champ annule donc la coche : ce qu'on écrit devient une étape DE
// la tâche, qui se cochera toute seule quand l'étape tombera. Laisser le champ
// vide vaut « c'est bien fini » — ne rien faire est la sortie par défaut, et
// c'est ce qui permet de poser la question à CHAQUE validation sans lasser.
function Remaining({ id, name, onDone }) {
  const [value, setValue] = useState('')
  const vide = !value.trim()
  function submit(e) {
    e.preventDefault()
    if (vide) return
    store.splitTodo(id, value.trim())
    setValue('')
    onDone()
  }
  return (
    <form className="plan-next" onSubmit={submit}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Il reste quelque chose ?"
        aria-label={`Ce qui reste à faire sur : ${name}`}
        enterKeyHint="done"
      />
      {!vide && (
        <button type="submit" className="plan-chip is-primary" aria-label={`Rouvrir ${name} avec cette étape`}>
          ça reste à faire
        </button>
      )}
    </form>
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

function Group({ parentId, depth, byParent, todos, eff, onSchedule, onAsk, ask, onSpent, onCleared, addUnder, onAddUnder, activeId, onActivate, now, onStart, onStop, editingId, armedId, onEdit, onArm }) {
  const open = byParent.get(parentId || ROOT) || []
  // `byParent` est déjà bâti sur les tâches vivantes + celle en attente de
  // réponse : on n'a rien à refiltrer ici, sinon la question disparaîtrait.
  if (depth > 0 && open.length === 0) return null

  // À la racine, les prio 1 forment un lot à part : sans cette coupure, une
  // urgence et une broutille se lisent dans la même colonne, et le tri seul ne
  // le dit pas assez fort. Pas d'intertitre s'il n'y a rien d'urgent — ou si
  // TOUT est urgent : un en-tête qui ne sépare rien n'apprend rien.
  const urgent = depth === 0 ? open.filter((t) => (eff.get(t.id) || 0) === 1).length : 0
  const split = urgent > 0 && urgent < open.length

  return (
    <ul className="plan-list">
      {split && (
        <li className="plan-sep is-urgent" aria-hidden="true">
          Urgent
        </li>
      )}
      {open.map((todo, i) => (
        <Fragment key={todo.id}>
          {split && i === urgent && (
            <li className="plan-sep" aria-hidden="true">
              Ensuite
            </li>
          )}
          <li className="plan-row" style={{ paddingLeft: Math.min(depth, MAX_INDENT) * INDENT }}>
            <Row
              node={{ todo, depth, children: byParent.get(todo.id) || [] }}
              todos={todos}
              byParent={byParent}
              eff={eff}
              onSchedule={onSchedule}
              onAsk={onAsk}
              ask={ask}
              onSpent={onSpent}
              onCleared={onCleared}
              onAddUnder={onAddUnder}
              addingHere={addUnder === todo.id}
              active={activeId === todo.id}
              onActivate={onActivate}
              now={now}
              onStart={onStart}
              onStop={onStop}
              editing={editingId === todo.id}
              armed={armedId === todo.id}
              onEdit={onEdit}
              onArm={onArm}
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
              eff={eff}
              onSchedule={onSchedule}
              onAsk={onAsk}
              ask={ask}
              onSpent={onSpent}
              onCleared={onCleared}
              addUnder={addUnder}
              onAddUnder={onAddUnder}
              activeId={activeId}
              onActivate={onActivate}
              now={now}
              onStart={onStart}
              onStop={onStop}
              editingId={editingId}
              armedId={armedId}
              onEdit={onEdit}
              onArm={onArm}
            />
          </li>
        </Fragment>
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
  const habits = useStore((s) => s.habits)
  const [ask, setAsk] = useState(null) // { id, preset, capped }
  const [addUnder, setAddUnder] = useState(null)
  const [activeId, setActiveId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [armedId, setArmedId] = useState(null)
  const [scheduleId, setScheduleId] = useState(null)

  // Changer de ligne referme tout : une suppression armée sur une tâche puis
  // oubliée se déclencherait au premier tap sur une AUTRE ligne.
  function activate(id) {
    setActiveId(id)
    setEditingId(null)
    setArmedId(null)
  }
  const [now, setNow] = useState(() => Date.now())

  // Le tic-tac ne tourne QUE si un chrono tourne : une page au repos ne doit
  // pas réveiller React chaque seconde sur un téléphone.
  const ticking = todos.some((t) => t.timerStart)
  useEffect(() => {
    if (!ticking) return undefined
    const h = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(h)
  }, [ticking])

  // La tâche qu'on vient de cocher reste à l'écran tant qu'on ne lui a pas
  // répondu : sans ça elle disparaissait à l'instant du clic et emportait la
  // question du temps avec elle — la fonctionnalité était inatteignable.
  //
  // Ses ANCÊTRES restent avec elle, même auto-complétés : sans eux, cocher la
  // dernière étape d'un sujet faisait disparaître le sujet, l'étape devenait
  // orpheline et sautait en bas de page — loin du doigt, juste au moment où on
  // lui pose une question.
  const keep = new Set()
  if (ask) {
    keep.add(ask.id)
    for (const a of ancestorsOf(todos, ask.id)) keep.add(a.id)
  }
  const live = todos.filter((t) => t.status !== 'done' || keep.has(t.id))
  const byParent = childrenByParent(live)
  const eff = effectiveRanks(live, byParent)
  // Les créneaux de travail proposés par la fenêtre « Planifier » : même source
  // que l'onglet Todos, pour que les deux écrans ne se contredisent jamais.
  const slots = workSlots(habits, todos, todayISO())
  const scheduling = scheduleId ? todos.find((t) => t.id === scheduleId) : null

  // Cocher : on bascule d'abord, on demande le temps ensuite — et seulement si
  // Martin avait estimé la tâche. Sur les autres, la question serait un péage
  // quotidien pour une donnée qu'il n'a pas demandé à mesurer.
  function onAsk(todo) {
    // Un chrono encore en marche est d'abord versé : on ne coche jamais une
    // tâche en laissant tourner sa mesure.
    const banked = todo.timerStart ? store.stopTimer(todo.id) : 0
    store.togglePlanDone(todo.id)
    if (banked > 0) {
      setAsk({ id: todo.id, preset: banked, capped: banked >= TIMER_CAP_MINUTES })
    } else if (todo.estimateMinutes > 0) {
      setAsk({ id: todo.id, preset: 0, capped: false })
    }
  }
  function setSpent(id, minutes) {
    if (minutes != null) store.setSpentMinutes(id, minutes)
    setAsk(null)
  }
  function onStart(id) {
    store.startTimer(id)
    setNow(Date.now())
  }
  function onStop(id) {
    store.stopTimer(id)
    setNow(Date.now())
  }

  return (
    <section className="plan" aria-label="Plan">
      <Group
        parentId={null}
        depth={0}
        byParent={byParent}
        todos={live}
        eff={eff}
        onSchedule={setScheduleId}
        onAsk={onAsk}
        ask={ask}
        onSpent={setSpent}
        onCleared={() => setAsk(null)}
        addUnder={addUnder}
        onAddUnder={setAddUnder}
        activeId={activeId}
        onActivate={activate}
        editingId={editingId}
        armedId={armedId}
        onEdit={setEditingId}
        onArm={setArmedId}
        now={now}
        onStart={onStart}
        onStop={onStop}
      />
      {scheduling && <ScheduleDialog todo={scheduling} slots={slots} onClose={() => setScheduleId(null)} />}
    </section>
  )
}
