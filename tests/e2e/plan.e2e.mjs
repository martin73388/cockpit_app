// Suite e2e de la page Plan — un vrai navigateur, à la vraie largeur.
//
// Pourquoi elle existe : les TROIS défauts d'interface de cette page ont été
// trouvés en la faisant tourner, jamais par un test. Les 303 tests unitaires ne
// touchent que les données ; ils ne savent pas qu'un bouton mange la largeur,
// qu'une question est inatteignable, ou qu'une ligne saute hors de l'écran.
// Chacun de ces cas a donc son test ici, nommé d'après le défaut.
//
// Le défaut 4 a ajouté une leçon de plus : la suite était VERTE pendant que la
// fonctionnalité était inatteignable, parce que chaque test l'atteignait par la
// seule porte ouverte. Un test doit entrer par le chemin ordinaire, pas par
// celui qu'on avait sous la main en l'écrivant.
//
// 240 × 427 px : l'écran de l'Unihertz Jelly Star 2. Ce n'est pas le petit
// format « au cas où », c'est LE format.
//
// Usage : npm run e2e   (construit, sert, exécute, arrête)
import { chromium } from 'playwright'

const URL = process.env.E2E_URL || 'http://localhost:4399/cockpit_app/'
const W = 240
const H = 427

let pass = 0
let fail = 0
const ok = (nom, cond) => {
  if (cond) pass++
  else fail++
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + nom)
}

const todo = (id, title, patch = {}) => ({
  id, title, notes: '', done: false, doneAt: null, status: 'todo', waiting: null,
  scheduled: null, estimateMinutes: null, calendarEventId: null, calendarSync: 'off',
  focus: null, priority: 'normale', rank: null, dueDate: '', projectId: null,
  projectSource: null, order: 1000, parentId: null, spentMinutes: null, timerStart: null,
  subtasks: [], createdAt: 1, updatedAt: 1, ...patch,
})

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: ['--no-sandbox'],
})
const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: 'light' })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push('PAGE: ' + e.message))
page.on('console', (m) => {
  // Le serveur de prévisualisation coupe parfois une requête au démarrage ;
  // ça ne dit rien sur l'app.
  if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION/.test(m.text())) {
    errors.push('CONSOLE: ' + m.text())
  }
})

async function seed(todos) {
  await page.goto(URL)
  await page.evaluate(
    (d) => localStorage.setItem('cockpit-state', JSON.stringify(d)),
    { app: 'cockpit', version: 9, habits: [], inbox: [], deleted: [], todos },
  )
  await page.reload()
  await page.waitForTimeout(500)
}
const data = () => page.evaluate(() => JSON.parse(localStorage.getItem('cockpit-state')).todos)
const titres = () => page.$$eval('.plan-title', (els) => els.map((e) => e.textContent.trim()))
const ouvrir = async (nom) => {
  await page.getByRole('button', { name: new RegExp(`^${nom} — ouvrir`) }).click()
  await page.waitForTimeout(150)
}

// ---------------------------------------------------------------- l'arrivée
await seed([todo('a', 'Facture', { rank: 1 }), todo('b', 'Site'), todo('c', 'Chiffrer', { parentId: 'b' })])

ok('l’app ouvre sur Plan', (await page.$eval('[aria-current="page"]', (e) => e.textContent.trim())) === 'Plan')
ok('l’onglet actif est atteignable sans faire défiler la barre', await page.$eval('[aria-current="page"]', (e) => {
  const r = e.getBoundingClientRect()
  return r.left >= -1 && r.right <= window.innerWidth + 1
}))
ok('l’arbre s’affiche', (await titres()).length === 3)
ok('une étape est décalée sous son sujet', await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.plan-row')]
  const pad = (i) => parseFloat(getComputedStyle(rows[i]).paddingLeft) || 0
  return pad(2) > pad(1)
}))

// -------------------------------------------------- DÉFAUT 1 : la largeur
// Trois boutons permanents par ligne mangeaient 37 % des 240 px et coupaient
// les titres en plein mot (« Kickmake / r »).
await seed([todo('x', 'Wandercraft : premier message', { estimateMinutes: 15 })])
ok('défaut 1 — le titre garde au moins la moitié de la largeur', await page.evaluate(() => {
  const t = document.querySelector('.plan-title').getBoundingClientRect()
  return t.width >= window.innerWidth * 0.5
}))
ok('défaut 1 — rien ne déborde de l’écran', await page.evaluate(
  () => document.documentElement.scrollWidth <= window.innerWidth + 1))

await ouvrir('Wandercraft : premier message')
ok('défaut 1 — le panneau ouvert ne déborde pas non plus', await page.evaluate(
  () => document.documentElement.scrollWidth <= window.innerWidth + 1))

// ------------------------------------ DÉFAUT 2 : la question inatteignable
// La tâche disparaissait à l'instant du clic et emportait la question du temps
// avec elle : la fonctionnalité n'était jamais atteignable.
await seed([todo('e', 'Tâche estimée', { estimateMinutes: 30 })])
await page.getByRole('checkbox', { name: /Marquer comme fait : Tâche estimée/ }).click()
await page.waitForTimeout(250)
ok('défaut 2 — cocher une tâche estimée demande le temps passé',
   (await page.locator('.plan-spent-ask').count()) === 1)
await page.locator('.plan-spent-ask .plan-chip').first().click()
await page.waitForTimeout(250)
ok('défaut 2 — répondre enregistre le temps et referme la question',
   (await data()).find((t) => t.id === 'e').spentMinutes === 5 && (await page.locator('.plan-spent-ask').count()) === 0)

// ------------------------------------------ DÉFAUT 3 : la ligne qui saute
// Cocher la dernière étape d'un sujet le faisait auto-compléter et disparaître ;
// l'étape devenait orpheline et sautait en bas de page, loin du doigt, juste au
// moment où elle posait une question.
await seed([todo('p', 'Le sujet'), todo('s', 'La seule étape', { parentId: 'p', estimateMinutes: 30 })])
await page.getByRole('checkbox', { name: /Marquer comme fait : La seule étape/ }).click()
await page.waitForTimeout(250)
ok('défaut 3 — le sujet reste affiché pendant la question', (await titres()).includes('Le sujet'))
ok('défaut 3 — l’étape reste à sa place, décalée sous lui', await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.plan-row')]
  const pad = (i) => parseFloat(getComputedStyle(rows[i]).paddingLeft) || 0
  return rows.length >= 2 && pad(1) > pad(0)
}))

// ------------------------------------- « je ne peux pas la valider vraiment »
await page.getByRole('textbox', { name: /Ce qui reste à faire sur/ }).fill('Attendre Berger')
await page.getByRole('button', { name: /Rouvrir .* avec cette étape/ }).click()
await page.waitForTimeout(300)
{
  const d = await data()
  const parent = d.find((t) => t.id === 's')
  const enfant = d.find((t) => t.title === 'Attendre Berger')
  ok('la coche est annulée : la tâche repart', parent.status === 'todo')
  ok('ce qui reste devient une étape DE la tâche', !!enfant && enfant.parentId === 's')
  ok('le sujet au-dessus se rouvre aussi', d.find((t) => t.id === 'p').status === 'todo')
}

// ------------------ DÉFAUT 4 : la suite réservée aux tâches estimées
// « Il reste quelque chose ? » et la question du temps partageaient la même
// condition. Sur une tâche ordinaire — ni estimée ni chronométrée, donc la
// plupart — cocher ne proposait rien du tout.
//
// Les tests d'au-dessus passaient pourtant : ils validaient TOUS une tâche
// estimée, la seule porte qui se trouvait ouverte. Une suite verte ne prouve
// que ce qu'elle traverse ; ces trois tests entrent par la porte ordinaire.
await seed([todo('o', 'Tâche ordinaire')])
await page.getByRole('checkbox', { name: /Marquer comme fait : Tâche ordinaire/ }).click()
await page.waitForTimeout(250)
ok('défaut 4 — cocher une tâche SANS estimation propose quand même la suite',
   (await page.getByRole('textbox', { name: /Ce qui reste à faire sur/ }).count()) === 1)
ok('défaut 4 — … sans réclamer un temps qu’on n’a pas demandé à mesurer',
   (await page.locator('.plan-spent-ask').count()) === 0)
await page.getByRole('textbox', { name: /Ce qui reste à faire sur/ }).fill('Relancer lundi')
await page.getByRole('button', { name: /Rouvrir .* avec cette étape/ }).click()
await page.waitForTimeout(300)
{
  const d = await data()
  ok('défaut 4 — la tâche ordinaire repart avec son étape',
     d.find((t) => t.id === 'o').status === 'todo' &&
     !!d.find((t) => t.title === 'Relancer lundi' && t.parentId === 'o'))
}

// Une validation sans suite doit pouvoir se refermer sans rien taper : sinon la
// ligne cochée reste à l'écran et la question devient le péage qu'on évitait.
await seed([todo('o2', 'Rien à ajouter')])
await page.getByRole('checkbox', { name: /Marquer comme fait : Rien à ajouter/ }).click()
await page.waitForTimeout(250)
await page.getByRole('button', { name: /Rien de plus sur/ }).click()
await page.waitForTimeout(300)
ok('« c’est fini » referme la question et la tâche s’en va',
   !(await titres()).includes('Rien à ajouter') &&
   (await data()).find((t) => t.id === 'o2').status === 'done')

// Sur une tâche estimée les deux questions s'enchaînent : répondre le temps ne
// doit pas emporter celle d'après avec elle.
await seed([todo('et', 'Tâche estimée bis', { estimateMinutes: 30 })])
await page.getByRole('checkbox', { name: /Marquer comme fait : Tâche estimée bis/ }).click()
await page.waitForTimeout(250)
await page.locator('.plan-spent-ask .plan-chip').first().click()
await page.waitForTimeout(300)
ok('répondre le temps laisse « il reste quelque chose ? » ouvert',
   (await page.getByRole('textbox', { name: /Ce qui reste à faire sur/ }).count()) === 1)

// Se raviser : une tâche faite quitte la page, donc le seul endroit d'où on
// peut la décocher est justement le panneau qui vient de s'ouvrir. Décocher
// rouvre la tâche — ce n'est pas une fin, il n'y a donc plus rien à demander.
await seed([todo('d1', 'Coche par erreur')])
const caseD1 = page.getByRole('checkbox', { name: /Marquer comme fait : Coche par erreur/ })
await caseD1.click()
await page.waitForTimeout(250)
await caseD1.click()
await page.waitForTimeout(300)
ok('se raviser retire la question et rouvre la tâche',
   (await page.getByRole('textbox', { name: /Ce qui reste à faire sur/ }).count()) === 0 &&
   (await data()).find((t) => t.id === 'd1').status === 'todo' &&
   (await titres()).includes('Coche par erreur'))

// --------------------------------------------------- priorité & séparation
await seed([
  todo('u', 'Urgente', { rank: 1, order: 3000 }),
  todo('n', 'Normale', { order: 1000 }),
  todo('g', 'Gros sujet', { order: 2000 }),
  todo('gi', 'Étape urgente', { parentId: 'g', rank: 1 }),
])
// « Gros sujet » hérite du 1 de son étape, donc il est À ÉGALITÉ avec « Urgente » ;
// leur ordre manuel départage (2000 avant 3000). « Normale » vaut 3 et ferme la
// marche. J'avais d'abord écrit l'inverse — c'est le test qui avait tort.
ok('les urgentes passent devant, l’ordre manuel départage à égalité',
   JSON.stringify(await titres()) === JSON.stringify(['Gros sujet', 'Étape urgente', 'Urgente', 'Normale']))
ok('un sujet contenant une urgence remonte avec elle', (await titres()).indexOf('Gros sujet') < (await titres()).indexOf('Normale'))
ok('les intertitres séparent le lot urgent du reste',
   JSON.stringify(await page.$$eval('.plan-sep', (e) => e.map((x) => x.textContent))) === '["Urgent","Ensuite"]')
ok('le sujet porte la note héritée de son étape',
   (await page.$$eval('.plan-rank', (e) => e.map((x) => x.textContent))).filter((r) => r === '1').length >= 2)

// ------------------------------------------ corriger, attendre, supprimer
await seed([todo('r', 'Faire la factre'), todo('d', 'À jeter')])
await ouvrir('Faire la factre')
await page.getByRole('button', { name: /Renommer : Faire la factre/ }).click()
await page.waitForTimeout(200)
await page.getByRole('textbox', { name: /Nouveau nom de/ }).fill('Faire la facture')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
ok('renommer corrige le titre', (await data()).find((t) => t.id === 'r').title === 'Faire la facture')

// Le panneau est resté ouvert après le renommage : le rouvrir le refermerait.
await page.getByRole('button', { name: /Mettre en attente/ }).click()
await page.waitForTimeout(250)
await page.getByRole('textbox', { name: /Ce que tu attends sur/ }).fill('la réponse de Berger')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
{
  const t = (await data()).find((x) => x.id === 'r')
  ok('mettre en attente pose l’état et son motif', t.status === 'waiting' && t.waiting.note === 'la réponse de Berger')
}

await ouvrir('À jeter')
await page.getByRole('button', { name: /^Supprimer : À jeter/ }).click()
await page.waitForTimeout(200)
ok('supprimer résiste au premier tap', (await data()).some((t) => t.id === 'd'))
await page.getByRole('button', { name: /Confirmer la suppression/ }).click()
await page.waitForTimeout(300)
ok('… et obéit au second', !(await data()).some((t) => t.id === 'd'))

// ------------------------------------------------------------- le chrono
await seed([todo('t1', 'Bosser dessus'), todo('t2', 'Autre chose')])
await ouvrir('Bosser dessus')
await page.getByRole('button', { name: /Je fais ça maintenant : Bosser dessus/ }).click()
await page.waitForTimeout(200)
ok('un chrono qui tourne se voit sur la ligne', (await page.locator('.plan-run').count()) === 1)
await ouvrir('Autre chose')
await page.getByRole('button', { name: /Je fais ça maintenant : Autre chose/ }).click()
await page.waitForTimeout(200)
ok('un seul chrono à la fois', (await page.locator('.plan-run').count()) === 1)

// ------------------------------------------------------ ajouter, planifier
await seed([todo('z', 'Un sujet')])
await page.getByRole('textbox', { name: /Ajouter une tâche/ }).fill('Nouvelle tâche')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
ok('ajouter une tâche à la racine', (await titres()).includes('Nouvelle tâche'))
await ouvrir('Un sujet')
await page.getByRole('button', { name: /Ajouter une étape sous : Un sujet/ }).click()
await page.waitForTimeout(200)
await page.getByRole('textbox', { name: /Ajouter ici/ }).fill('Une étape')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
ok('ajouter une étape sous un sujet', (await data()).some((t) => t.title === 'Une étape' && t.parentId === 'z'))
ok('le bouton Planifier est sur chaque ligne', (await page.locator('.plan-cal').count()) >= 2)

// ------------------------------------------------------------- cohérence
await seed([todo('m', 'Sujet'), todo('m1', 'Étape', { parentId: 'm' })])
ok('un sujet inachevé ne se coche pas à la main',
   await page.$eval('.plan-line input', (e) => e.disabled))
await page.getByRole('checkbox', { name: /Marquer comme fait : Étape/ }).click()
await page.waitForTimeout(300)
ok('… et bascule tout seul quand sa dernière étape tombe',
   (await data()).find((t) => t.id === 'm').status === 'done')

ok('aucune erreur console sur tout le parcours', errors.length === 0)
if (errors.length) console.log(errors.join('\n'))

await browser.close()
console.log(`\nTOTAL : ${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
