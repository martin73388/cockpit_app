/** ============================================================================
 *  COCKPIT — Handshake Agenda des TÂCHES PLANIFIÉES (v5)
 *
 *  À AJOUTER À LA FIN de ton fichier Apps Script « Gateway_cockpit ».
 *  Ce bloc est autonome : il ne modifie rien d'existant (doGet / doPost /
 *  applyOps / syncHabits restent intacts) et ne dépend d'aucune de leurs
 *  variables — tu peux le coller tel quel à la suite, sans rien relire.
 *
 *  --- MISE EN PLACE (une fois) ---
 *  1. Colle ce bloc à la fin du fichier. Enregistre (disquette).
 *  2. Ajoute le déclencheur :
 *       Icône réveil (Déclencheurs) → « + Ajouter un déclencheur »
 *         Fonction              : syncTodos
 *         Déploiement           : Head
 *         Source de l'événement : Basé sur le temps
 *         Type                  : Minuteur (minutes) → Toutes les 10 minutes
 *       → Enregistrer → autorise l'accès à l'agenda si demandé.
 *  3. Pas de redéploiement de l'application web : l'URL /exec ne change pas.
 *
 *  --- CE QU'IL FAIT ---
 *  L'app ne touche JAMAIS l'agenda elle-même : elle écrit calendarSync:"pending"
 *  sur la tâche, et ce robot exécute, puis réécrit "synced" (ou "off").
 *
 *    status "scheduled" + créneau      -> crée l'événement (heure, ou journée
 *                                          entière si aucune heure)
 *    terminée, créneau DÉJÀ PASSÉ      -> garde l'événement (trace de ce qui a
 *                                          été fait à ce moment-là)
 *    terminée, créneau À VENIR         -> supprime l'événement (inutile)
 *    déplanifiée / supprimée           -> supprime l'événement
 *
 *  Ne touche que : scheduled / calendarEventId / calendarSync / updatedAt.
 *  Jamais le titre, les sous-tâches, les habitudes ni les completions.
 * ========================================================================== */

var TODO_FILE = 'cockpit-data.json';
var TODO_REGISTRY = 'TODO_EVENTS'; // { todoId: eventId } — permet de nettoyer les supprimées

function todoParseDate_(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  var p = s.split('-');
  return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
}

// Instant de début du créneau (minuit si pas d'heure) — sert à décider si un
// créneau est déjà passé.
function todoSlotStart_(slot) {
  var d = todoParseDate_(slot && slot.date);
  if (!d) return null;
  if (slot.time && /^\d{1,2}:\d{2}$/.test(slot.time)) {
    var hm = slot.time.split(':');
    d.setHours(parseInt(hm[0], 10), parseInt(hm[1], 10), 0, 0);
  }
  return d;
}

// updatedAt : le strict minimum pour battre la version qu'on vient de lire, et
// rien de plus. Un tampon global (le max de tout le fichier) placerait le robot
// loin dans le futur et écraserait les modifications faites par l'utilisateur
// entre notre lecture et notre écriture.
function todoStamp_(t) {
  return Math.max(Date.now(), (t.updatedAt || 0) + 1);
}

function todoDeleteEvent_(eventId) {
  if (!eventId) return;
  try {
    var ev = CalendarApp.getDefaultCalendar().getEventById(eventId);
    if (ev) ev.deleteEvent();
  } catch (e) { /* déjà supprimé ou introuvable : on ignore */ }
}

function todoCreateEvent_(t) {
  var cal = CalendarApp.getDefaultCalendar();
  var slot = t.scheduled;
  var day = todoParseDate_(slot.date);
  if (!day) return null;
  var title = '✔ ' + (t.title || 'Tâche');
  var desc = (t.notes ? t.notes + '\n\n' : '') + '[cockpit-todo:' + t.id + ']';
  var ev;
  if (slot.time && /^\d{1,2}:\d{2}$/.test(slot.time)) {
    var hm = slot.time.split(':');
    var start = new Date(day.getTime());
    start.setHours(parseInt(hm[0], 10), parseInt(hm[1], 10), 0, 0);
    var mins = (slot.durationMinutes > 0) ? slot.durationMinutes : 60;
    ev = cal.createEvent(title, start, new Date(start.getTime() + mins * 60000), { description: desc });
  } else {
    ev = cal.createAllDayEvent(title, day, { description: desc });
  }
  return ev.getId();
}

function syncTodos() {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return; }
  try {
    var f = findFile_(TODO_FILE);
    if (!f) return;

    var data;
    try { data = JSON.parse(f.getBlob().getDataAsString('UTF-8')); } catch (e) { return; }
    // Garde : jamais sur un fichier qui n'est pas un Cockpit.
    if (!data || data.app !== 'cockpit' || !Array.isArray(data.todos)) return;

    var reg = {};
    try { reg = JSON.parse(props_().getProperty(TODO_REGISTRY) || '{}'); } catch (e) { reg = {}; }

    var i, changed = false;
    var now = new Date();

    // 1) Tâches en attente de synchro agenda
    for (i = 0; i < data.todos.length; i++) {
      var t = data.todos[i];

      // Réparation : seul le robot écrit calendarEventId, mais la fusion est un
      // LWW objet entier — une copie périmée qui gagne fait reculer ce champ
      // vers un événement déjà supprimé, pendant que le vrai reste orphelin.
      // Notre registre est la mémoire du robot : il fait foi.
      // ('synced' uniquement : 'off' signifie « aucun événement », y restaurer
      // un id périmé ressusciterait un lien mort.)
      if (t.calendarSync === 'synced' && reg[t.id] && reg[t.id] !== t.calendarEventId) {
        t.calendarEventId = reg[t.id];
        t.updatedAt = todoStamp_(t);
        changed = true;
      }

      if (t.calendarSync !== 'pending') continue;
      var slot = t.scheduled;

      // Terminée sur un créneau déjà passé : on garde l'événement tel quel,
      // c'est la trace de ce qui a réellement été fait à ce moment-là.
      // (Uniquement s'il existe vraiment un événement : sinon 'synced' mentirait.)
      if (t.status === 'done' && slot && t.calendarEventId) {
        var start = todoSlotStart_(slot);
        // On compare au moment où la tâche a été VALIDÉE (doneAt), pas à
        // l'heure de passage du robot : cocher à 13h une tâche prévue à 14h
        // doit retirer l'événement, même si le robot ne passe qu'à 14h30.
        var at = (typeof t.doneAt === 'number' && t.doneAt > 0) ? t.doneAt : now.getTime();
        if (start && start.getTime() <= at) {
          t.calendarSync = 'synced';
          t.updatedAt = todoStamp_(t);
          changed = true;
          continue;
        }
      }

      // Base propre : on efface l'événement référencé par la tâche ET celui
      // que notre registre a mémorisé — un gagnant LWW périmé peut porter un
      // calendarEventId différent, et l'autre resterait sinon orphelin.
      todoDeleteEvent_(t.calendarEventId);
      if (reg[t.id] && reg[t.id] !== t.calendarEventId) todoDeleteEvent_(reg[t.id]);

      if (t.status === 'scheduled' && slot && slot.date) {
        try {
          var newId = todoCreateEvent_(t);
          if (!newId) continue;   // créneau illisible : reste "pending"
          t.calendarEventId = newId;
          t.calendarSync = 'synced';
          reg[t.id] = newId;
        } catch (e) {
          continue;   // échec (quota, droits) : reste "pending", retenté au prochain passage
        }
      } else {
        t.calendarEventId = null;
        t.calendarSync = 'off';
        delete reg[t.id];
      }
      t.updatedAt = todoStamp_(t);
      changed = true;
    }

    // 2) Tâches supprimées → retirer l'événement lié
    var tombs = Array.isArray(data.deleted) ? data.deleted : [];
    for (i = 0; i < tombs.length; i++) {
      var tb = tombs[i];
      if (tb && tb.kind === 'todo' && reg[tb.id]) {
        todoDeleteEvent_(reg[tb.id]);
        delete reg[tb.id];
      }
    }

    // 3) Élagage du registre. Une propriété de script est plafonnée à 9 ko :
    // sans ménage, les entrées s'accumulent (tâches supprimées dont la pierre
    // tombale a fini par disparaître) jusqu'à faire échouer setProperty — et
    // avec lui TOUTE la synchro. On ne garde que les tâches encore vivantes
    // et réellement rattachées à un événement.
    var live = {};
    for (i = 0; i < data.todos.length; i++) {
      var lt = data.todos[i];
      if (reg[lt.id] && lt.calendarEventId) live[lt.id] = reg[lt.id];
    }
    reg = live;

    // Le fichier de données AVANT le registre : si l'écriture du registre
    // échoue, le travail d'agenda déjà fait n'est pas perdu (et le prochain
    // passage se resynchronise), alors que l'inverse laisserait le fichier
    // en « pending » avec des événements déjà créés.
    if (changed) writeTarget_(TODO_FILE, JSON.stringify(data, null, 2));
    props_().setProperty(TODO_REGISTRY, JSON.stringify(reg));
  } finally {
    lock.releaseLock();
  }
}

/** Utilitaire manuel : liste ce que le robot croit avoir créé pour les tâches. */
function todoDebugRegistry() {
  Logger.log(props_().getProperty(TODO_REGISTRY) || '{}');
}
