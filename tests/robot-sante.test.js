// Le gardien de la passerelle (docs/robot-sante.gs) tourne chez Google. Même
// technique que robot.test.js : on l'exécute tel quel dans un `vm` avec des
// stubs Drive/Mail. C'est le seul filet possible sur du code copié-collé —
// et celui-ci a un rôle particulier : il doit détecter une panne muette, donc
// on vérifie surtout qu'il ne se tait PAS quand il ne faut pas.
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'

const SRC = fs.readFileSync(path.resolve(__dirname, '../docs/robot-sante.gs'), 'utf8')

const H = 3600000
const NOW = Date.UTC(2026, 7, 31, 16, 0, 0) // 31/08/2026 18h Paris
const GOOD = 'DOSSIER_OK'
const OLD = 'ANCIEN_DOSSIER'

// Un Drive de poche : des fichiers, des dossiers, une corbeille.
function makeDrive(spec) {
  const files = new Map()
  for (const f of spec.files) {
    files.set(f.id, {
      id: f.id, name: f.name, parents: f.parents || [GOOD],
      trashed: !!f.trashed, updated: f.updated ?? NOW, created: f.created ?? NOW,
    })
  }
  const wrap = (f) => ({
    getId: () => f.id,
    getName: () => f.name,
    isTrashed: () => f.trashed,
    getLastUpdated: () => new Date(f.updated),
    getDateCreated: () => new Date(f.created),
    getParents: () => iter(f.parents.map((p) => ({ getId: () => p, getName: () => p, isTrashed: () => false }))),
  })
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] } }
  return {
    files,
    api: {
      getFileById: (id) => {
        const f = files.get(id)
        if (!f) throw new Error('File not found: ' + id)
        return wrap(f)
      },
      getFolderById: (id) => {
        if (!spec.folders.includes(id)) throw new Error('Folder not found: ' + id)
        return {
          getId: () => id,
          getName: () => id,
          isTrashed: () => (spec.trashedFolders || []).includes(id),
          getFiles: () => iter([...files.values()].filter((f) => f.parents.includes(id) && !f.trashed).map(wrap)),
        }
      },
      getFilesByName: (name) => iter([...files.values()].filter((f) => f.name === name).map(wrap)),
    },
  }
}

function makeEnv(spec, props = {}) {
  const drive = makeDrive(spec)
  const store = { props: { ...props }, mails: [] }
  const sandbox = {
    Logger: { log: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in store.props ? store.props[k] : null),
        setProperty: (k, v) => { store.props[k] = v },
      }),
    },
    DriveApp: drive.api,
    MailApp: { sendEmail: (to, subject, body) => store.mails.push({ to, subject, body }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'moi@exemple.fr' }) },
  }
  vm.createContext(sandbox)
  vm.runInContext(SRC, sandbox)
  return { sandbox, store, drive }
}

// Le monde nominal : cinq fichiers, tous dans le bon dossier, tous frais.
const NAMES = ['cockpit-data.json', 'radar.json', 'carnet-data.json', 'daily-brief.json', 'agenda.json']
const healthy = (over = {}) => ({
  folders: [GOOD],
  files: NAMES.map((n, i) => ({ id: 'f' + i, name: n })),
  ...over,
})
const pinnedIds = JSON.stringify(Object.fromEntries(NAMES.map((n, i) => [n, 'f' + i])))
const baseProps = { FOLDER_ID: GOOD, SANTE_IDS: pinnedIds }

const audit = (spec, props = baseProps) => makeEnv(spec, props).sandbox.santeAudit_(NOW)

describe('santeSeed : épingler les fichiers par identifiant', () => {
  it('enregistre les cinq identifiants trouvés dans le dossier', () => {
    const env = makeEnv(healthy(), { FOLDER_ID: GOOD })
    env.sandbox.santeSeed()
    expect(JSON.parse(env.store.props.SANTE_IDS)).toEqual(JSON.parse(pinnedIds))
  })

  it('n’écrase rien quand le dossier est introuvable', () => {
    const env = makeEnv(healthy(), { FOLDER_ID: 'NIMPORTE_QUOI', SANTE_IDS: pinnedIds })
    env.sandbox.santeSeed()
    expect(env.store.props.SANTE_IDS).toBe(pinnedIds) // intact
  })

  it('signale un fichier manquant sans planter', () => {
    const spec = healthy({ files: NAMES.slice(0, 3).map((n, i) => ({ id: 'f' + i, name: n })) })
    const env = makeEnv(spec, { FOLDER_ID: GOOD })
    env.sandbox.santeSeed()
    expect(Object.keys(JSON.parse(env.store.props.SANTE_IDS))).toHaveLength(3)
  })
})

describe('tout va bien : le gardien se tait', () => {
  it('aucun problème sur une installation saine', () => {
    const r = audit(healthy())
    expect(r.problems).toEqual([])
    expect(r.healed).toBe('')
  })

  it('aucun mail envoyé quand tout va bien', () => {
    const env = makeEnv(healthy(), baseProps)
    env.sandbox.santeCheck()
    expect(env.store.mails).toHaveLength(0)
  })

  it('réclame le semis tant qu’il n’a pas eu lieu', () => {
    const r = audit(healthy(), { FOLDER_ID: GOOD })
    expect(r.problems.join(' ')).toMatch(/santeSeed/)
  })
})

describe('la panne du 26/08, rejouée', () => {
  // Le dossier est recréé ailleurs, les fichiers y sont déplacés, l'ancien
  // dossier part à la corbeille. C'est exactement ce qui est arrivé.
  const reorganise = () => ({
    folders: [GOOD, OLD],
    trashedFolders: [OLD],
    files: NAMES.map((n, i) => ({ id: 'f' + i, name: n, parents: [GOOD] })),
  })

  it('détecte que le dossier configuré est à la corbeille', () => {
    const r = audit(reorganise(), { FOLDER_ID: OLD, SANTE_IDS: pinnedIds })
    expect(r.problems.concat(r.healed).join(' ')).toMatch(/CORBEILLE|recalé/i)
  })

  it('recale FOLDER_ID tout seul sur le dossier réel des fichiers', () => {
    const env = makeEnv(reorganise(), { FOLDER_ID: OLD, SANTE_IDS: pinnedIds })
    const r = env.sandbox.santeAudit_(NOW)
    expect(r.healed).toMatch(new RegExp(GOOD))
    expect(env.store.props.FOLDER_ID).toBe(GOOD)
    // Et une fois recalé, plus rien à signaler : la panne est vraiment réparée.
    expect(r.problems).toEqual([])
  })

  it('après recalage, le contrôle suivant est silencieux', () => {
    const env = makeEnv(reorganise(), { FOLDER_ID: OLD, SANTE_IDS: pinnedIds })
    env.sandbox.santeAudit_(NOW)
    expect(env.sandbox.santeAudit_(NOW).healed).toBe('')
  })

  it('ne suit pas un fichier isolé : il faut une majorité franche', () => {
    // Un seul fichier a bougé — c'est lui l'anomalie, pas le dossier.
    const spec = {
      folders: [GOOD, OLD],
      files: [{ id: 'f0', name: NAMES[0], parents: ['AILLEURS'] },
              ...NAMES.slice(1).map((n, i) => ({ id: 'f' + (i + 1), name: n, parents: [GOOD] }))],
    }
    const env = makeEnv(spec, { FOLDER_ID: 'DISPARU', SANTE_IDS: pinnedIds })
    const r = env.sandbox.santeAudit_(NOW)
    expect(r.healed).toMatch(new RegExp(GOOD)) // la majorité (4/5) l'emporte
    expect(env.store.props.FOLDER_ID).toBe(GOOD)
  })

  it('ne recale rien quand aucun dossier ne réunit trois fichiers', () => {
    const spec = {
      folders: [],
      files: NAMES.map((n, i) => ({ id: 'f' + i, name: n, parents: ['P' + i] })),
    }
    const env = makeEnv(spec, { FOLDER_ID: 'DISPARU', SANTE_IDS: pinnedIds })
    const r = env.sandbox.santeAudit_(NOW)
    expect(r.healed).toBe('')
    expect(env.store.props.FOLDER_ID).toBe('DISPARU') // on ne devine pas
  })
})

describe('le doublon, le symptôme resté invisible cinq jours', () => {
  it('deux exemplaires vivants du même fichier : alerte', () => {
    const spec = healthy()
    spec.files.push({ id: 'orphelin', name: 'agenda.json', parents: [OLD] })
    spec.folders.push(OLD)
    const r = audit(spec)
    expect(r.problems.join(' ')).toMatch(/agenda\.json : 2 exemplaires vivants/)
  })

  it('un exemplaire à la corbeille est une remarque, pas une alerte', () => {
    const spec = healthy()
    spec.files.push({ id: 'orphelin', name: 'agenda.json', parents: [OLD], trashed: true })
    spec.folders.push(OLD)
    const r = audit(spec)
    expect(r.problems).toEqual([])
    expect(r.notes.join(' ')).toMatch(/corbeille/)
  })
})

describe('les pannes silencieuses de chaque robot', () => {
  it('agenda.json figé depuis plus de 24 h : syncAgenda ne fait plus son travail', () => {
    const spec = healthy()
    spec.files.find((f) => f.name === 'agenda.json').updated = NOW - 30 * H
    expect(audit(spec).problems.join(' ')).toMatch(/agenda\.json n'a pas bougé depuis 30 h/)
  })

  it('agenda.json de 20 h ne déclenche rien : une nuit, c’est normal', () => {
    const spec = healthy()
    spec.files.find((f) => f.name === 'agenda.json').updated = NOW - 20 * H
    expect(audit(spec).problems).toEqual([])
  })

  it('un ops en souffrance : applyOps est coincé', () => {
    const spec = healthy()
    spec.files.push({ id: 'ops', name: 'ops-daily-brief-x.json', created: NOW - 25 * 60000 })
    expect(audit(spec).problems.join(' ')).toMatch(/ops-daily-brief-x\.json attend depuis 25 min/)
  })

  it('un ops tout frais est laissé tranquille', () => {
    const spec = healthy()
    spec.files.push({ id: 'ops', name: 'ops-daily-brief-x.json', created: NOW - 2 * 60000 })
    expect(audit(spec).problems).toEqual([])
  })

  it('un fichier épinglé sorti du dossier de travail', () => {
    const spec = healthy()
    spec.files.find((f) => f.name === 'radar.json').parents = ['AUTRE_PART']
    spec.folders.push('AUTRE_PART')
    expect(audit(spec).problems.join(' ')).toMatch(/radar\.json : n'est plus dans le dossier/)
  })

  it('un fichier épinglé supprimé pour de bon', () => {
    const spec = healthy()
    spec.files = spec.files.filter((f) => f.name !== 'daily-brief.json')
    expect(audit(spec).problems.join(' ')).toMatch(/daily-brief\.json : identifiant épinglé introuvable/)
  })

  it('un fichier épinglé mis à la corbeille', () => {
    const spec = healthy()
    spec.files.find((f) => f.name === 'cockpit-data.json').trashed = true
    expect(audit(spec).problems.join(' ')).toMatch(/cockpit-data\.json : le fichier est à la corbeille/)
  })
})

describe('l’alerte : prévenir sans harceler', () => {
  const cassé = () => {
    const spec = healthy()
    spec.files.find((f) => f.name === 'agenda.json').updated = NOW - 40 * H
    return spec
  }

  it('envoie un mail au premier problème', () => {
    const env = makeEnv(cassé(), baseProps)
    env.sandbox.santeCheck()
    expect(env.store.mails).toHaveLength(1)
    expect(env.store.mails[0].subject).toMatch(/décroche/)
    expect(env.store.mails[0].to).toBe('moi@exemple.fr')
  })

  it('ne répète pas la même alerte au contrôle suivant', () => {
    const env = makeEnv(cassé(), baseProps)
    env.sandbox.santeCheck()
    env.sandbox.santeCheck()
    env.sandbox.santeCheck()
    expect(env.store.mails).toHaveLength(1)
  })

  it('mais repart aussitôt si le problème change', () => {
    const env = makeEnv(cassé(), baseProps)
    env.sandbox.santeCheck()
    env.drive.files.get('f1').trashed = true // radar.json à la corbeille : fait neuf
    env.sandbox.santeCheck()
    expect(env.store.mails).toHaveLength(2)
  })

  it('annonce le retour à la normale, une seule fois', () => {
    const env = makeEnv(cassé(), baseProps)
    env.sandbox.santeCheck()
    env.drive.files.get('f4').updated = NOW // agenda.json rafraîchi
    env.sandbox.santeCheck()
    env.sandbox.santeCheck()
    expect(env.store.mails.map((m) => m.subject)).toEqual([
      expect.stringMatching(/décroche/), expect.stringMatching(/repartie/),
    ])
  })

  it('ne dit rien au tout premier contrôle si tout va déjà bien', () => {
    const env = makeEnv(healthy(), baseProps)
    env.sandbox.santeCheck()
    env.sandbox.santeCheck()
    expect(env.store.mails).toHaveLength(0)
  })

  it('prévient aussi quand il s’est réparé tout seul', () => {
    const env = makeEnv(
      { folders: [GOOD], files: NAMES.map((n, i) => ({ id: 'f' + i, name: n, parents: [GOOD] })) },
      { FOLDER_ID: 'DISPARU', SANTE_IDS: pinnedIds },
    )
    env.sandbox.santeCheck()
    expect(env.store.mails).toHaveLength(1)
    expect(env.store.mails[0].body).toMatch(/RÉPARÉ/)
  })
})

describe('un gardien qui plante ne sert à rien', () => {
  it('survit à un Drive qui lève à chaque appel, et le dit', () => {
    const env = makeEnv(healthy(), baseProps)
    env.sandbox.DriveApp.getFilesByName = () => { throw new Error('Drive HS') }
    expect(() => env.sandbox.santeCheck()).not.toThrow()
  })

  it('survit à des propriétés illisibles', () => {
    const env = makeEnv(healthy(), { FOLDER_ID: GOOD, SANTE_IDS: '{ceci n est pas du JSON' })
    expect(() => env.sandbox.santeCheck()).not.toThrow()
    expect(env.store.mails[0].body).toMatch(/santeSeed/)
  })

  it('survit à un envoi de mail impossible (autorisation refusée)', () => {
    const env = makeEnv(healthy(), baseProps)
    env.drive.files.get('f4').updated = NOW - 40 * H
    env.sandbox.MailApp.sendEmail = () => { throw new Error('autorisation manquante') }
    expect(() => env.sandbox.santeCheck()).not.toThrow()
  })
})
