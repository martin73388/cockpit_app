# Cockpit

Troisième app du dispositif, après **Radar** (prospection) et **Carnet de bord**
(projets). Cockpit gère les **todos** et les **habitudes**. Application React + Vite,
déployable en **PWA** sur GitHub Pages, avec une couche de synchronisation
multi-appareils calquée sur Radar / Carnet.

> Cette app a été portée depuis la maquette Claude Design (`Cockpit.dc.html`), qui
> reste la **référence d'UI et de comportement**. Le runtime Design Component et
> `support.js` ne sont **pas** réutilisés — uniquement comme spec vivante.

## Périmètre v2 (actuel)

- ✅ **Dashboard** (onglet par défaut) : capture rapide/inbox · brief du jour ·
  aujourd'hui · vigilance vie (piliers) · alertes Radar/Carnet.
- ✅ **Todos** (inchangé depuis v1) et **Habitudes** (coche « Fait aujourd'hui »,
  historique 7 jours, pilier, fréquence « toutes les 2 semaines »).
- ❌ Pas de stats, pas de notifications, pas de streaks (v3+).
- ❌ L'app n'appelle **jamais** l'API Agenda (handshake display-only, voir plus bas).

## Démarrage

```bash
npm install
npm run dev        # serveur de dev Vite
npm test           # tests (fusion + CAS deux remotes)
npm run build      # build de production -> dist/
npm run preview    # sert le build (base /cockpit_app/)
node scripts/gen-icons.mjs   # régénère les icônes PNG de la PWA
```

## Structure

```
cockpit_app/  (racine du dépôt)
├─ index.html                 # shell + police Bricolage Grotesque + manifest
├─ .github/workflows/deploy.yml  # build + déploiement GitHub Pages
├─ vite.config.js             # base=/cockpit_app/ (override VITE_BASE), config Vitest
├─ scripts/gen-icons.mjs      # génère les PNG d'icône (sans dépendance)
├─ public/
│  ├─ manifest.webmanifest    # manifeste PWA
│  ├─ sw.js                   # service worker (fait main, sans plugin)
│  └─ icons/                  # icône SVG + PNG 192/512/maskable
├─ src/
│  ├─ main.jsx                # point d'entrée + enregistrement du SW (prod)
│  ├─ App.jsx                 # shell, onglets, moteur de synchro, thème
│  ├─ data/
│  │  ├─ model.js             # constantes + fabriques (newTodo, newHabit…)
│  │  ├─ clock.js             # horloge epoch-ms MONOTONE (updatedAt)
│  │  ├─ store.js             # store local (localStorage) + actions du domaine
│  │  ├─ config.js            # config GitHub + Drive (locale, jamais synchronisée)
│  │  ├─ ui.js                # préférences UI (layout, tri, filtres, thème)
│  │  └─ persist.js           # helpers localStorage (préfixe cockpit-)
│  ├─ sync/
│  │  ├─ merge.js             # ★ fusion LWW + tombstones + canonicalisation
│  │  ├─ github.js            # remote GitHub Contents (compare-and-swap via sha)
│  │  ├─ drive.js             # remote passerelle Drive (requêtes « simples »)
│  │  ├─ engine.js            # ★ orchestration : pull×2 → fusion → push×2 (CAS)
│  │  ├─ errors.js            # ConflictError / AuthError / SyncError
│  │  ├─ base64.js            # base64 UTF-8 (accents/emoji)
│  │  └─ projects.js          # liste projets Radar + Carnet (lecture Drive)
│  ├─ hooks/useStore.js       # useSyncExternalStore
│  ├─ utils/                  # dates, recurrence, todoView (filtre/tri), reorder
│  ├─ styles/                 # tokens.css + interface.css (PLACEHOLDER) + app.css
│  └─ components/
│     ├─ Header.jsx           # marque, onglets, pastille de synchro, réglages
│     ├─ common/              # Icons, ConfirmDelete (2 temps), SyncBadge
│     ├─ todos/               # TodosView, TodoItem, SubtaskList, EditModal, ProjectSelect
│     ├─ habits/              # HabitsView, HabitForm, HabitCard
│     ├─ dashboard/           # DashboardView (désactivé)
│     └─ settings/            # SettingsView (GitHub + Drive)
└─ tests/
   ├─ merge.test.js           # fusion : LWW, tombstones, déterminisme, guard
   └─ sync.test.js            # CAS deux remotes, conflits, guard fichier étranger, offline
```

## Modèle de données — `cockpit-data.json`

Conventions identiques à Radar / Carnet : ids `crypto.randomUUID()`, horodatages
en **epoch ms**, `updatedAt` **monotone**, suppressions par **tombstones**.

```jsonc
{
  "app": "cockpit",
  "version": 4,
  "todos": [
    {
      "id": "…", "title": "", "notes": "", "done": false, "doneAt": null,
      "status": "todo|waiting|done",
      "waiting": { "note": "", "since": 0, "followUpDate": "YYYY-MM-DD|" },
      "focus": { "date": "YYYY-MM-DD", "count": 0 },
      "priority": "haute|normale|basse", "dueDate": "YYYY-MM-DD|",
      "projectId": null, "order": 0,
      "subtasks": [{ "id": "…", "title": "", "done": false }],
      "createdAt": 0, "updatedAt": 0
    }
  ],
  "habits": [
    {
      "id": "…", "title": "", "notes": "", "active": true,
      "schedule": { "frequency": "daily|weekly|biweekly", "daysOfWeek": ["MO"…"SU"],
                    "time": "HH:MM|", "durationMinutes": 30,
                    "anchorDate": "YYYY-MM-DD|" },
      "completions": ["YYYY-MM-DD"], "checks": { "YYYY-MM-DD": { "on": true, "at": 0 } },
      "pillar": "sommeil|sport|couple|proches|repas|null",
      "calendarEventId": null, "calendarSync": "pending|synced|off",
      "createdAt": 0, "updatedAt": 0
    }
  ],
  "inbox": [{ "id": "…", "text": "", "createdAt": 0, "processedAt": null,
              "processedNote": "", "updatedAt": 0 }],
  "deleted": [{ "id": "…", "at": 0, "kind": "todo|habit|inbox" }]
}
```

v3 : statut « En attente » sur les todos (`status`/`waiting` — sortie de « À faire »,
relance datée, garde-fou 7 j au Dashboard) + filtre priorités multi-choix.
v4 (continuité GTD) : « ➕ Créer la suite » à la complétion, prochaine étape
visible (première sous-tâche restante), sujets en panne dans les Alertes,
⭐ Focus du jour avec report quotidien (`focus`, count, arbitrage à ×4).
Migration v1→v2→v3 automatique au chargement (défauts ajoutés, `version` réécrite),
idempotente. Fusion : complétions en **CRDT par date** (`checks` : LWW par date,
`completions` dérivé) — une coche faite sur un autre appareil n'est jamais
perdue, et **décocher est durable** (pas de résurrection par union) ; `inbox` =
union par id + tombstones. Garde : `version > 4` → « bloqué », jamais écrasé.

## Sources lecture seule (rafraîchies à CHAQUE cycle)

- `radar.json` / `carnet-data.json` (passerelle) → menu Projet + **alertes**
  calculées par l'app (bloqué, en sommeil > 21 j, échéance ≤ 7 j, relance
  dépassée, prioritaire jamais contacté). Source indisponible → section masquée.
- `daily-brief.json` (déposé par l'assistant, `app:"cockpit-brief"`) → section
  Brief. Absent ou daté d'un autre jour → « Pas de brief aujourd'hui ». L'app ne
  l'écrit jamais.

## Synchronisation (le cœur du travail)

À chaque cycle — **lancement / focus / online / « Synchroniser » / push débouncé** —
l'app synchronise contre **les deux remotes** :

1. **pull GitHub** → fusion ; **pull Drive** → fusion ;
2. puis **push GitHub ET Drive**.

- **localStorage** en continu (source locale, clés `cockpit-…`).
- **GitHub Contents** (`cockpit_core` / `cockpit-data.json`) : GET récupère le `sha`,
  PUT écrit avec le `sha` (**compare-and-swap**). Sur `409/422` → re-pull + fusion + re-push.
- **Passerelle Google Drive** (Apps Script `/exec`, même fichier) en **requêtes simples**
  (pas de preflight CORS) :
  - LECTURE `GET ?secret=…&file=cockpit-data.json` → `{ ok, exists, version, content }`.
  - ÉCRITURE `POST` body JSON `{ secret, file, content, baseVersion }` en
    **`Content-Type: text/plain`**. Réponses `{ok,version}` |
    `{ok:false,error:"conflict",version,content}` | `{ok:false,error:"auth"|"bad-request"}`.

### Fusion multi-appareils (`src/sync/merge.js`)

- **Par id, le dernier `updatedAt` gagne** pour l'objet entier (sous-tâches comprises,
  pas d'union au niveau sous-tâche en v1).
- **Tombstones** (`deleted`, avec `kind`) empêchent les résurrections ; un objet édité
  *après* sa suppression (updatedAt > at du tombstone) l'emporte et purge le tombstone.
- **Ordre canonique** (tri stable + ordre de clés fixe) : deux appareils identiques
  émettent un fichier **identique octet pour octet** (`serialize()`).
- **Garde** : on n'écrase **jamais** un remote qui n'est pas un Cockpit
  (`app==="cockpit"` + `todos`/`habits` en tableaux). Sinon statut « bloqué ».
- La fusion est **commutative** et **idempotente** (couverte par les tests).

## Configuration (écran Réglages)

Deux sections, **secrets stockés en local, jamais synchronisés ni exportés** :

- **GitHub** — propriétaire, dépôt (`cockpit_core`), branche, fichier
  (`cockpit-data.json`), **jeton fine-grained** (Contents: RW sur ce seul dépôt).
- **Synchronisation Drive (Cockpit)** — URL `/exec` + secret + statut +
  « Synchroniser maintenant » + « Déconnexion ».

## Liste des projets (dropdown `projectId`)

Lue via la passerelle Drive (lecture seule), fusionnée et groupée par source :

- `GET ?file=radar.json` → `companies[]` → `{ id, source:"Radar", label:name }`
- `GET ?file=carnet-data.json` → `projects[]` → `{ id, source:"Carnet", label:name }`

## Handshake Agenda (l'app n'appelle aucune API)

Sur une habitude **créée / modifiée / (dé)activée**, l'app écrit seulement
`calendarSync:"pending"` + `calendarEventId` (null, ou l'ancien si modif).
L'assistant (hors app) crée/met à jour/supprime l'événement récurrent et réécrit
`calendarEventId` + `calendarSync:"synced"` (ou `"off"` en pause). L'indicateur est
**display-only** : ⏳ pending / ✓ synced / — off.

## Design system

`src/styles/tokens.css` et `interface.css` sont des **PLACEHOLDERS** reproduisant les
conventions du design system (police **Bricolage Grotesque**, thèmes clair/sombre via
variables + `prefers-color-scheme` + surcharge `data-theme`, `prefers-reduced-motion`).
**À remplacer par les vrais fichiers** du design system (source unique de vérité), après
quoi la copie inline pourra être retirée. Objectif : Radar, Carnet et Cockpit = un seul
produit visuel.

## Déploiement (GitHub Pages, PWA)

- `base` = `/cockpit_app/` (dépôt public `cockpit_app`). Pour un autre chemin :
  `VITE_BASE=/ npm run build`.
- `npm run build` produit `dist/` (inclut `manifest.webmanifest`, `sw.js`, icônes).
- Le service worker (`public/sw.js`) est **fait main** : network-first pour la
  navigation (fallback shell hors-ligne), stale-while-revalidate pour les assets ;
  les appels API (GitHub, Drive) ne sont jamais interceptés. Bump `CACHE_VERSION`
  pour invalider.
- Déploiement automatique via GitHub Actions : voir `.github/workflows/deploy.yml`
  (build + publication sur GitHub Pages à chaque push sur `main`). Active Pages
  dans les réglages du dépôt : **Settings → Pages → Source = GitHub Actions**.

> Données : dépôt privé **`cockpit_core`** (`cockpit-data.json`). Le jeton fine-grained
> n'a accès qu'à ce dépôt et reste stocké **en local** dans l'app.
