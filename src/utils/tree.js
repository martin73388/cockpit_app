import { NEUTRAL_RANK } from '../data/model.js'

// v9 — l'arbre de la page Plan.
//
// Les tâches sont stockées à plat, reliées par `parentId` : l'arbre n'existe
// qu'ici, reconstruit à chaque rendu. C'est volontaire — chaque nœud reste un
// objet de fusion autonome, donc deux appareils qui touchent deux branches
// gardent les deux modifications.
//
// Toutes les fonctions tolèrent un `parentId` qui ne désigne rien : entre une
// suppression locale et la canonicalisation suivante, un enfant orphelin existe
// bel et bien en mémoire. Il est traité comme une racine, jamais ignoré — une
// tâche ne doit pas disparaître de l'écran parce que son parent vient de partir.

// Clé des racines dans la map. Un identifiant Drive/uuid ne peut pas contenir
// d'espace, donc la collision est impossible.
export const ROOT = '(racine)'

function liveParent(todo, byId) {
  if (!todo.parentId) return null
  return byId.has(todo.parentId) ? todo.parentId : null
}

/**
 * Rang EFFECTIF de chaque tâche : le sien, et celui de ses étapes.
 *
 * Un sujet prend la note la plus prioritaire de ce qu'il contient — sinon un
 * sujet anodin abritant une urgence resterait en bas de page, et c'est
 * exactement ce qu'on ne veut pas rater. Son rang propre compte aussi : un
 * sujet marqué 1 le reste même si ses étapes sont tranquilles.
 *
 * Calculé une fois pour tout l'arbre (O(n)) : l'appeler depuis un comparateur
 * de tri coûterait un parcours complet par comparaison.
 */
export function effectiveRanks(todos, kids) {
  const byId = new Map(todos.map((t) => [t.id, t]))
  const memo = new Map()
  const onStack = new Set()
  const walk = (id) => {
    if (memo.has(id)) return memo.get(id)
    if (onStack.has(id)) return null // cycle résiduel : on ne s'y enfonce pas
    onStack.add(id)
    const t = byId.get(id)
    let best = t && t.rank ? t.rank : null
    for (const c of kids.get(id) || []) {
      const r = walk(c.id)
      if (r != null && (best == null || r < best)) best = r
    }
    onStack.delete(id)
    memo.set(id, best)
    return best
  }
  for (const t of todos) walk(t.id)
  return memo
}

/** Map parentId -> enfants directs, triés par rang effectif puis ordre manuel. */
export function childrenByParent(todos) {
  const byId = new Map(todos.map((t) => [t.id, t]))
  const map = new Map()
  for (const t of todos) {
    const key = liveParent(t, byId) || ROOT
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(t)
  }
  // Le rang passe devant l'ordre manuel : marquer une tâche « 1 » doit la faire
  // monter. Une tâche jamais classée vaut 3 — sinon elle se ferait doubler par
  // un 5, qu'on a pourtant désigné comme moins urgent. À rang égal, l'ordre
  // manuel tranche : c'est exactement là qu'agissent ↑ et ↓.
  const eff = effectiveRanks(todos, map)
  const rankOf = (t) => eff.get(t.id) || NEUTRAL_RANK
  for (const list of map.values()) {
    list.sort((a, b) => rankOf(a) - rankOf(b) || (a.order || 0) - (b.order || 0) || a.createdAt - b.createdAt)
  }
  return map
}

export function rootsOf(todos) {
  return childrenByParent(todos).get(ROOT) || []
}

export function childrenOf(todos, id) {
  return childrenByParent(todos).get(id) || []
}

/**
 * Arbre complet : [{ todo, depth, children }], en profondeur d'abord.
 * `maxDepth` borne le rendu, jamais les données — une branche plus profonde
 * reste dans le fichier, elle n'est simplement pas dépliée.
 */
export function buildTree(todos, maxDepth = 12) {
  const map = childrenByParent(todos)
  const out = []
  const walk = (list, depth) => {
    for (const todo of list) {
      const children = map.get(todo.id) || []
      out.push({ todo, depth, children })
      if (depth < maxDepth) walk(children, depth + 1)
    }
  }
  walk(map.get(ROOT) || [], 0)
  return out
}

/** Le nœud et toute sa descendance, sans jamais boucler sur un cycle résiduel. */
export function subtreeIds(todos, id, kids) {
  const map = kids || childrenByParent(todos)
  const out = []
  const seen = new Set()
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()
    if (seen.has(cur)) continue
    seen.add(cur)
    out.push(cur)
    for (const c of map.get(cur) || []) stack.push(c.id)
  }
  return out
}

/** La chaîne des ancêtres, du parent direct à la racine. */
export function ancestorsOf(todos, id) {
  const byId = new Map(todos.map((t) => [t.id, t]))
  const out = []
  const seen = new Set([id])
  let cur = byId.get(id)
  while (cur && cur.parentId && byId.has(cur.parentId) && !seen.has(cur.parentId)) {
    seen.add(cur.parentId)
    cur = byId.get(cur.parentId)
    out.push(cur)
  }
  return out
}

const isDone = (t) => t.status === 'done'

/**
 * Avancement d'un sujet : combien de ses enfants DIRECTS sont faits.
 * Les faites disparaissent de la page, donc c'est le seul endroit où Martin
 * voit le chemin parcouru — sans ça, un sujet à deux étapes restantes
 * ressemble à un sujet neuf.
 */
export function progressOf(children) {
  return { done: children.filter(isDone).length, total: children.length }
}

/**
 * Un parent ne se coche pas à la main : sa case est inerte tant qu'il reste
 * une étape ouverte, puis il bascule tout seul quand la dernière tombe.
 * Une tâche sans enfant se coche normalement.
 */
export function canCheck(todo, children) {
  if (children.length === 0) return true
  return children.every(isDone)
}

/**
 * Temps passé sur un sujet : son temps propre plus celui de toute sa
 * descendance. `missing` compte les tâches FAITES sans temps saisi — c'est ce
 * qui permet d'afficher « 2 h 30 · 2 étapes non chronométrées » plutôt qu'un
 * total faux présenté comme exact.
 */
export function spentOf(todos, id, kids) {
  const byId = new Map(todos.map((t) => [t.id, t]))
  let minutes = 0
  let missing = 0
  for (const nid of subtreeIds(todos, id, kids)) {
    const t = byId.get(nid)
    if (!t) continue
    const m = Number(t.spentMinutes)
    if (Number.isFinite(m) && m > 0) minutes += m
    else if (isDone(t)) missing += 1
  }
  return { minutes, missing }
}

/** « 1 h 30 », « 45 min ». Rien pour zéro : une ligne vide vaut mieux qu'un « 0 ». */
export function formatSpent(minutes) {
  if (!minutes || minutes <= 0) return ''
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

/**
 * Un déplacement ne doit jamais placer un nœud sous lui-même : la page
 * bouclerait à l'infini. canonicalize sait casser un cycle né d'une fusion,
 * mais un cycle qu'on peut refuser à la source ne doit jamais être écrit.
 */
export function canMoveUnder(todos, id, parentId, kids) {
  if (!parentId) return true
  if (parentId === id) return false
  return !subtreeIds(todos, id, kids).includes(parentId)
}

/**
 * Le voisin avec qui ↑ / ↓ échangerait la place, ou null.
 *
 * Monter une tâche au-dessus d'une plus prioritaire n'a pas de sens : le tri
 * la redescendrait aussitôt, et le bouton donnerait l'impression d'être cassé.
 * On ne réordonne donc qu'à rang effectif ÉGAL — et le bouton est désactivé
 * plutôt que silencieusement inopérant.
 */
export function reorderNeighbour(todos, id, dir, kids, ranks) {
  const map = kids || childrenByParent(todos)
  const self = todos.find((t) => t.id === id)
  if (!self) return null
  const byId = new Map(todos.map((t) => [t.id, t]))
  const siblings = map.get(liveParent(self, byId) || ROOT) || []
  const i = siblings.findIndex((t) => t.id === id)
  const j = i + (dir < 0 ? -1 : 1)
  if (i < 0 || j < 0 || j >= siblings.length) return null
  const eff = ranks || effectiveRanks(todos, map)
  const rank = (t) => eff.get(t.id) || NEUTRAL_RANK
  return rank(siblings[j]) === rank(self) ? siblings[j] : null
}
