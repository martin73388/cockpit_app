// v9 — la page Plan : l'arbre à plat relié par parentId, la complétion qui
// remonte, et le temps passé.
//
// L'enjeu n'est pas l'affichage : c'est que deux appareils qui travaillent sur
// deux branches gardent les DEUX modifications. C'est la raison pour laquelle
// l'arbre n'est pas imbriqué dans la todo — une todo entière est une seule
// unité de fusion, et le perdant du dernier-écrit-gagne perd sa branche.
import { describe, it, expect, beforeEach } from 'vitest'
import { canonicalize, mergeStates, serialize } from '../src/sync/merge.js'
import { newTodo, APP, SCHEMA_VERSION, TIMER_CAP_MINUTES } from '../src/data/model.js'
import { createStore } from '../src/data/store.js'
import { childrenByParent, rootsOf, subtreeIds, ancestorsOf, effectiveRanks, reorderNeighbour, progressOf, canCheck, spentOf, formatSpent, canMoveUnder } from '../src/utils/tree.js'
import { visibleTodos } from '../src/utils/todoView.js'
import { stalledTodos } from '../src/utils/alerts.js'

const state = (partial = {}) => ({ app: APP, version: SCHEMA_VERSION, todos: [], habits: [], inbox: [], deleted: [], ...partial })
const T = (id, patch = {}) => newTodo({ id, title: id, createdAt: 1, updatedAt: 1, order: 1000, ...patch })
const ids = (list) => list.map((t) => t.id)

describe('v9 : le champ parentId', () => {
  it('la version du fichier passe à 9', () => {
    expect(SCHEMA_VERSION).toBe(9)
    expect(canonicalize(state()).version).toBe(9)
  })

  it('une tâche naît à la racine, et garde son parent', () => {
    expect(newTodo().parentId).toBe(null)
    const c = canonicalize(state({ todos: [T('p'), T('e', { parentId: 'p' })] })).todos
    expect(c.find((t) => t.id === 'e').parentId).toBe('p')
  })

  it('une tâche ne peut pas être sa propre étape', () => {
    expect(canonicalize(state({ todos: [T('a', { parentId: 'a' })] })).todos[0].parentId).toBe(null)
  })

  it('un parent qui n’existe pas libère son enfant à la racine', () => {
    const c = canonicalize(state({ todos: [T('e', { parentId: 'fantome' })] })).todos
    expect(c[0].parentId).toBe(null)
  })
})

describe('v9 : ce qui arrive quand on supprime un sujet', () => {
  it('l’étape remonte à la racine — elle ne disparaît pas avec son parent', () => {
    // L'ordre compte : l'adoption doit se faire APRÈS les pierres tombales.
    // Dans l'autre sens, supprimer une branche détruirait le travail fait
    // dessous en parallèle sur l'autre appareil.
    const s = state({
      todos: [T('p'), T('e', { parentId: 'p', updatedAt: 50 })],
      deleted: [{ id: 'p', at: 40, kind: 'todo' }],
    })
    const c = canonicalize(s).todos
    expect(ids(c)).toEqual(['e'])
    expect(c[0].parentId).toBe(null)
  })
})

describe('v9 : les cycles, que seule une fusion peut produire', () => {
  // A passe sous B sur le téléphone pendant que B passe sous A sur le Mac.
  // Chaque déplacement gagne sur son propre objet : les deux survivent, et
  // l'arbre n'en est plus un. Sans garde-fou, le rendu récursif boucle.
  const boucle = state({ todos: [T('a', { parentId: 'b' }), T('b', { parentId: 'a' })] })

  it('le cycle est cassé, les deux tâches remontent à la racine', () => {
    const c = canonicalize(boucle).todos
    expect(c.every((t) => t.parentId === null)).toBe(true)
  })

  it('une chaîne plus longue est cassée aussi', () => {
    const c = canonicalize(state({ todos: [T('a', { parentId: 'c' }), T('b', { parentId: 'a' }), T('c', { parentId: 'b' })] })).todos
    expect(c.every((t) => t.parentId === null)).toBe(true)
  })

  it('casser un cycle reste idempotent, et la fusion commutative', () => {
    const once = canonicalize(boucle)
    expect(canonicalize(once)).toEqual(once)
    expect(mergeStates(boucle, once)).toEqual(mergeStates(once, boucle))
  })

  it('un arbre sain n’est pas touché', () => {
    const sain = state({ todos: [T('p'), T('e', { parentId: 'p' }), T('f', { parentId: 'e' })] })
    expect(canonicalize(sain).todos.find((t) => t.id === 'f').parentId).toBe('e')
  })
})

describe('v9 : deux appareils, deux branches — le point de tout l’exercice', () => {
  it('les deux modifications survivent', () => {
    const base = [T('sujet'), T('a', { parentId: 'sujet' }), T('b', { parentId: 'sujet' })]
    // Téléphone : coche la branche a. Mac : ajoute une étape sous b.
    const tel = state({ todos: [...base.map((t) => (t.id === 'a' ? { ...t, status: 'done', done: true, updatedAt: 100 } : t))] })
    const mac = state({ todos: [...base, T('c', { parentId: 'b', updatedAt: 101 })] })
    const m = mergeStates(tel, mac)
    expect(m.todos.find((t) => t.id === 'a').status).toBe('done')
    expect(m.todos.find((t) => t.id === 'c')).toBeTruthy()
    expect(m.todos.find((t) => t.id === 'c').parentId).toBe('b')
  })

  it('déplacer une branche pendant qu’on y ajoute une étape garde les deux', () => {
    const base = [T('x'), T('y'), T('a', { parentId: 'x' })]
    const tel = state({ todos: base.map((t) => (t.id === 'a' ? { ...t, parentId: 'y', updatedAt: 100 } : t)) })
    const mac = state({ todos: [...base, T('n', { parentId: 'a', updatedAt: 101 })] })
    const m = mergeStates(tel, mac)
    expect(m.todos.find((t) => t.id === 'a').parentId).toBe('y')
    expect(m.todos.find((t) => t.id === 'n').parentId).toBe('a')
  })

  it('la sérialisation reste stable et idempotente avec l’arbre', () => {
    const s = state({ todos: [T('p'), T('e', { parentId: 'p', spentMinutes: 45 })] })
    expect(serialize(s)).toBe(serialize(canonicalize(s)))
    expect(mergeStates(s, s)).toEqual(canonicalize(s))
  })
})

describe('v9 : lire l’arbre', () => {
  const todos = [T('p'), T('a', { parentId: 'p', order: 1000 }), T('b', { parentId: 'p', order: 2000 }), T('seul')]

  it('les racines sont celles sans parent vivant', () => {
    expect(ids(rootsOf(todos))).toEqual(['p', 'seul'])
  })

  it('les enfants sortent dans l’ordre manuel', () => {
    expect(ids(childrenByParent(todos).get('p'))).toEqual(['a', 'b'])
  })

  it('un orphelin est traité comme une racine, jamais perdu', () => {
    // Entre la suppression locale et la canonicalisation suivante, l'enfant
    // pointe encore vers un parent absent. Il doit rester à l'écran.
    expect(ids(rootsOf([T('orphelin', { parentId: 'parti' })]))).toEqual(['orphelin'])
  })

  it('le sous-arbre et les ancêtres se parcourent sans boucler', () => {
    expect(subtreeIds(todos, 'p').sort()).toEqual(['a', 'b', 'p'])
    expect(ids(ancestorsOf(todos, 'a'))).toEqual(['p'])
    // Un cycle résiduel ne doit pas figer la page.
    const cyc = [T('u', { parentId: 'v' }), T('v', { parentId: 'u' })]
    expect(() => subtreeIds(cyc, 'u')).not.toThrow()
    expect(() => ancestorsOf(cyc, 'u')).not.toThrow()
  })

  it('on refuse de placer un sujet sous sa propre étape', () => {
    expect(canMoveUnder(todos, 'p', 'a')).toBe(false)
    expect(canMoveUnder(todos, 'p', 'p')).toBe(false)
    expect(canMoveUnder(todos, 'seul', 'p')).toBe(true)
    expect(canMoveUnder(todos, 'a', null)).toBe(true)
  })
})

describe('v9 : cocher', () => {
  const kids = (n, done = 0) => Array.from({ length: n }, (_, i) => T(`k${i}`, { parentId: 'p', status: i < done ? 'done' : 'todo', done: i < done }))

  it('une tâche sans étape se coche', () => {
    expect(canCheck(T('x'), [])).toBe(true)
  })

  it('un sujet dont une étape reste ouverte ne se coche pas', () => {
    expect(canCheck(T('p'), kids(3, 2))).toBe(false)
  })

  it('… et se coche dès que la dernière tombe', () => {
    expect(canCheck(T('p'), kids(3, 3))).toBe(true)
  })

  it('l’avancement compte les étapes directes', () => {
    expect(progressOf(kids(5, 2))).toEqual({ done: 2, total: 5 })
  })
})

describe('v9 : le store', () => {
  let s
  beforeEach(() => {
    s = createStore(state())
  })
  const find = (id) => s.getSnapshot().todos.find((t) => t.id === id)

  it('ajoute une étape sous un sujet', () => {
    const p = s.addTodo('Sujet')
    const e = s.addChildTodo(p, 'Étape')
    expect(find(e).parentId).toBe(p)
  })

  it('refuse une étape sous un parent qui n’existe pas', () => {
    s.addChildTodo('fantome', 'x')
    expect(s.getSnapshot().todos).toHaveLength(0)
  })

  it('→ range sous la tâche du dessus, ← la ressort', () => {
    const a = s.addTodo('A')
    const b = s.addTodo('B')
    s.indentTodo(b)
    expect(find(b).parentId).toBe(a)
    s.outdentTodo(b)
    expect(find(b).parentId).toBe(null)
  })

  it('→ ne fait rien sur le premier de sa fratrie', () => {
    const a = s.addTodo('A')
    s.indentTodo(a)
    expect(find(a).parentId).toBe(null)
  })

  it('→ ne crée jamais de cycle', () => {
    const p = s.addTodo('P')
    const e = s.addChildTodo(p, 'E')
    s.indentTodo(p) // rien au-dessus de P
    expect(find(p).parentId).toBe(null)
    expect(find(e).parentId).toBe(p)
  })

  it('la dernière étape cochée fait basculer le sujet tout seul', () => {
    const p = s.addTodo('P')
    const a = s.addChildTodo(p, 'a')
    const b = s.addChildTodo(p, 'b')
    s.togglePlanDone(a)
    expect(find(p).status).toBe('todo')
    s.togglePlanDone(b)
    expect(find(p).status).toBe('done')
  })

  it('rouvrir une étape rouvre le sujet', () => {
    const p = s.addTodo('P')
    const a = s.addChildTodo(p, 'a')
    s.togglePlanDone(a)
    expect(find(p).status).toBe('done')
    s.togglePlanDone(a)
    expect(find(p).status).toBe('todo')
  })

  it('la bascule remonte sur plusieurs niveaux', () => {
    const p = s.addTodo('P')
    const m = s.addChildTodo(p, 'M')
    const f = s.addChildTodo(m, 'F')
    s.togglePlanDone(f)
    expect(find(m).status).toBe('done')
    expect(find(p).status).toBe('done')
  })

  it('le store refuse de cocher un sujet inachevé, même si l’interface le demandait', () => {
    const p = s.addTodo('P')
    s.addChildTodo(p, 'a')
    s.togglePlanDone(p)
    expect(find(p).status).toBe('todo')
  })

  it('le temps passé se pose et s’efface', () => {
    const a = s.addTodo('A')
    s.setSpentMinutes(a, 45)
    expect(find(a).spentMinutes).toBe(45)
    s.setSpentMinutes(a, 0)
    expect(find(a).spentMinutes).toBe(null)
  })
})

describe('v9 : le temps passé', () => {
  it('un sujet additionne ses étapes ET son temps propre', () => {
    const todos = [
      T('p', { spentMinutes: 20 }),
      T('a', { parentId: 'p', spentMinutes: 30, status: 'done', done: true }),
      T('b', { parentId: 'a', spentMinutes: 10, status: 'done', done: true }),
    ]
    expect(spentOf(todos, 'p')).toEqual({ minutes: 60, missing: 0 })
  })

  it('compte les étapes faites SANS temps : un total incomplet ne doit pas passer pour exact', () => {
    const todos = [
      T('p'),
      T('a', { parentId: 'p', spentMinutes: 30, status: 'done', done: true }),
      T('b', { parentId: 'p', status: 'done', done: true }),
      T('c', { parentId: 'p' }), // pas faite : on n'attend pas de temps
    ]
    expect(spentOf(todos, 'p')).toEqual({ minutes: 30, missing: 1 })
  })

  it('s’écrit lisiblement', () => {
    expect(formatSpent(45)).toBe('45 min')
    expect(formatSpent(60)).toBe('1 h')
    expect(formatSpent(90)).toBe('1 h 30')
    expect(formatSpent(0)).toBe('')
    expect(formatSpent(null)).toBe('')
  })

  it('un temps aberrant est ignoré, et la canonicalisation reste idempotente', () => {
    const once = canonicalize(state({ todos: [T('a', { spentMinutes: -5 }), T('b', { spentMinutes: 0.4 })] }))
    expect(once.todos.find((t) => t.id === 'a').spentMinutes).toBe(null)
    expect(canonicalize(once)).toEqual(once)
  })
})

describe('v9 : l’existant n’est pas dérangé', () => {
  const todos = [T('racine'), T('etape', { parentId: 'racine' })]

  it('une étape du Plan n’apparaît pas dans l’onglet Todos', () => {
    const vis = visibleTodos(todos, { status: 'all', sort: 'manual' })
    expect(ids(vis)).toEqual(['racine'])
  })

  it('… mais un orphelin y revient, il ne se perd nulle part', () => {
    expect(ids(visibleTodos([T('orphelin', { parentId: 'parti' })], { status: 'all', sort: 'manual' }))).toEqual(['orphelin'])
  })

  it('un sujet intermédiaire ne déclenche pas d’alerte « en panne » par nœud', () => {
    const vieux = Date.now() - 30 * 86400000
    const arbre = [T('p', { updatedAt: vieux }), T('e', { parentId: 'p', updatedAt: vieux })]
    const items = stalledTodos(arbre)
    expect(items.length).toBeLessThanOrEqual(1)
  })

  it('les champs dont Carnet dépend sont tous là, et subtasks est intact', () => {
    const c = canonicalize(state({ todos: [T('x', { subtasks: [{ id: 's1', title: 'sous', done: false }] })] })).todos[0]
    for (const k of ['id', 'title', 'done', 'status', 'priority', 'dueDate', 'subtasks', 'projectId', 'projectSource', 'updatedAt']) {
      expect(c).toHaveProperty(k)
    }
    // Les 7 sous-tâches existantes ne sont ni promues ni effacées : la page
    // Plan les ignore, l'onglet Todos continue de les afficher.
    expect(c.subtasks).toEqual([{ id: 's1', title: 'sous', done: false }])
  })
})

describe('v9 : le chrono', () => {
  const T0 = 1_700_000_000_000
  let s
  beforeEach(() => {
    s = createStore(state())
  })
  const find = (id) => s.getSnapshot().todos.find((t) => t.id === id)

  it('naît à l’arrêt, et se lance', () => {
    expect(newTodo().timerStart).toBe(null)
    const a = s.addTodo('A')
    s.startTimer(a, T0)
    expect(find(a).timerStart).toBe(T0)
  })

  it('verse le temps mesuré à l’arrêt', () => {
    const a = s.addTodo('A')
    s.startTimer(a, T0)
    const added = s.stopTimer(a, T0 + 25 * 60000)
    expect(added).toBe(25)
    expect(find(a).spentMinutes).toBe(25)
    expect(find(a).timerStart).toBe(null)
  })

  it('deux sessions s’additionnent', () => {
    const a = s.addTodo('A')
    s.startTimer(a, T0)
    s.stopTimer(a, T0 + 10 * 60000)
    s.startTimer(a, T0 + 3600000)
    s.stopTimer(a, T0 + 3600000 + 5 * 60000)
    expect(find(a).spentMinutes).toBe(15)
  })

  it('un seul chrono à la fois : en lancer un arrête l’autre ET lui compte son temps', () => {
    const a = s.addTodo('A')
    const b = s.addTodo('B')
    s.startTimer(a, T0)
    s.startTimer(b, T0 + 20 * 60000)
    expect(find(a).timerStart).toBe(null)
    expect(find(a).spentMinutes).toBe(20) // rien n'est perdu en route
    expect(find(b).timerStart).toBe(T0 + 20 * 60000)
  })

  it('un chrono oublié est plafonné à 4 h', () => {
    const a = s.addTodo('A')
    s.startTimer(a, T0)
    expect(s.stopTimer(a, T0 + 14 * 3600000)).toBe(TIMER_CAP_MINUTES)
    expect(find(a).spentMinutes).toBe(TIMER_CAP_MINUTES)
  })

  it('arrêter un chrono qui ne tourne pas ne fait rien', () => {
    const a = s.addTodo('A')
    expect(s.stopTimer(a, T0)).toBe(0)
    expect(find(a).spentMinutes).toBe(null)
  })

  it('une horloge qui recule ne retire jamais de temps', () => {
    const a = s.addTodo('A')
    s.setSpentMinutes(a, 30)
    s.startTimer(a, T0)
    s.stopTimer(a, T0 - 3600000) // horloge remise à l'heure entre-temps
    expect(find(a).spentMinutes).toBe(30)
  })

  it('la fusion garde le chrono, sans jamais lire l’horloge', () => {
    // canonicalize doit rester une fonction pure : si elle bornait le chrono
    // avec l'heure courante, deux appareils produiraient des octets différents
    // pour le même état et le compare-and-swap GitHub verrait un diff permanent.
    const once = canonicalize(state({ todos: [T('a', { timerStart: T0 })] }))
    expect(once.todos[0].timerStart).toBe(T0)
    expect(canonicalize(once)).toEqual(once)
    expect(serialize(once)).toBe(serialize(canonicalize(once)))
  })

  it('un timerStart aberrant est ignoré', () => {
    const c = canonicalize(state({ todos: [T('a', { timerStart: -1 }), T('b', { timerStart: 'nawak' })] })).todos
    expect(c.every((t) => t.timerStart === null)).toBe(true)
  })
})

describe('v9 : la priorité 1 à 5', () => {
  it('une tâche naît sans rang', () => {
    expect(newTodo().rank).toBe(null)
  })

  it('le rang pilote la priorité que lisent Todos, le brief et Carnet', () => {
    const c = canonicalize(state({
      todos: [T('a', { rank: 1 }), T('b', { rank: 2 }), T('c', { rank: 3 }), T('d', { rank: 4 }), T('e', { rank: 5 })],
    })).todos
    const prio = Object.fromEntries(c.map((t) => [t.id, t.priority]))
    expect(prio).toEqual({ a: 'haute', b: 'haute', c: 'normale', d: 'basse', e: 'basse' })
  })

  it('sans rang, la priorité saisie ailleurs est respectée', () => {
    const c = canonicalize(state({ todos: [T('a', { priority: 'haute' })] })).todos[0]
    expect(c.rank).toBe(null)
    expect(c.priority).toBe('haute')
  })

  it('un rang hors bornes est ignoré, et la canonicalisation reste idempotente', () => {
    const once = canonicalize(state({ todos: [T('a', { rank: 0 }), T('b', { rank: 9 }), T('c', { rank: 'x' }), T('d', { rank: 2.4 })] }))
    const by = Object.fromEntries(once.todos.map((t) => [t.id, t.rank]))
    expect(by).toEqual({ a: null, b: null, c: null, d: 2 })
    expect(canonicalize(once)).toEqual(once)
  })

  it('changer la priorité depuis l’onglet Todos libère le rang', () => {
    // Sans ça, la projection réécrirait la priorité au prochain enregistrement
    // et le geste fait dans l'autre écran disparaîtrait en silence.
    const s = createStore(state())
    const a = s.addTodo('A')
    s.setRank(a, 1)
    s.updateTodo(a, { priority: 'basse' })
    const t = s.getSnapshot().todos.find((x) => x.id === a)
    expect(t.rank).toBe(null)
    expect(canonicalize(s.getSnapshot()).todos[0].priority).toBe('basse')
  })
})

describe('v9 : un sujet porte la priorité de ses étapes', () => {
  const eff = (todos) => effectiveRanks(todos, childrenByParent(todos))

  it('le parent prend la note la plus prioritaire de ses enfants', () => {
    const todos = [T('p'), T('a', { parentId: 'p', rank: 4 }), T('b', { parentId: 'p', rank: 2 })]
    expect(eff(todos).get('p')).toBe(2)
  })

  it('elle remonte sur plusieurs niveaux', () => {
    const todos = [T('p'), T('m', { parentId: 'p' }), T('f', { parentId: 'm', rank: 1 })]
    expect(eff(todos).get('p')).toBe(1)
  })

  it('le rang propre du sujet compte aussi : marqué 1, il le reste', () => {
    const todos = [T('p', { rank: 1 }), T('a', { parentId: 'p', rank: 5 })]
    expect(eff(todos).get('p')).toBe(1)
  })

  it('un sujet sans rien de classé n’a pas de rang', () => {
    expect(eff([T('p'), T('a', { parentId: 'p' })]).get('p')).toBe(null)
  })

  it('un cycle résiduel ne fait pas boucler le calcul', () => {
    const cyc = [T('u', { parentId: 'v', rank: 2 }), T('v', { parentId: 'u' })]
    expect(() => eff(cyc)).not.toThrow()
  })

  it('un sujet anodin contenant une urgence remonte en tête', () => {
    const todos = [
      T('calme', { order: 1000 }),
      T('gros', { order: 2000 }),
      T('urgence', { parentId: 'gros', rank: 1 }),
    ]
    expect(ids(rootsOf(todos))).toEqual(['gros', 'calme'])
  })

  it('une tâche non classée reste au milieu : un 1 la double, un 5 passe derrière', () => {
    const todos = [T('neutre', { order: 2000 }), T('urgente', { order: 3000, rank: 1 }), T('molle', { order: 1000, rank: 5 })]
    expect(ids(rootsOf(todos))).toEqual(['urgente', 'neutre', 'molle'])
  })
})

describe('v9 : réordonner à priorité égale', () => {
  let s
  beforeEach(() => {
    s = createStore(state())
  })
  const rootIds = () => ids(rootsOf(s.getSnapshot().todos))

  it('↑ échange la place avec le voisin du dessus', () => {
    const a = s.addTodo('A')
    const b = s.addTodo('B')
    expect(rootIds()).toEqual([a, b])
    s.moveWithinSiblings(b, -1)
    expect(rootIds()).toEqual([b, a])
  })

  it('↓ fait l’inverse', () => {
    const a = s.addTodo('A')
    s.addTodo('B')
    s.moveWithinSiblings(a, 1)
    expect(rootIds()[0]).not.toBe(a)
  })

  it('en bout de liste, rien ne bouge', () => {
    const a = s.addTodo('A')
    const b = s.addTodo('B')
    s.moveWithinSiblings(a, -1)
    s.moveWithinSiblings(b, 1)
    expect(rootIds()).toEqual([a, b])
  })

  it('on ne double pas une tâche plus prioritaire — le tri l’annulerait aussitôt', () => {
    const a = s.addTodo('A')
    const b = s.addTodo('B')
    s.setRank(a, 1)
    expect(reorderNeighbour(s.getSnapshot().todos, b, -1)).toBe(null)
    s.moveWithinSiblings(b, -1)
    expect(rootIds()).toEqual([a, b])
  })

  it('le réordonnancement reste dans la fratrie, il ne change pas de parent', () => {
    const p = s.addTodo('P')
    const x = s.addChildTodo(p, 'x')
    const y = s.addChildTodo(p, 'y')
    s.moveWithinSiblings(y, -1)
    const snap = s.getSnapshot().todos
    expect(ids(childrenByParent(snap).get(p))).toEqual([y, x])
    expect(snap.find((t) => t.id === y).parentId).toBe(p)
  })
})
