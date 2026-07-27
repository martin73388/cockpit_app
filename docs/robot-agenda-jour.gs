/** ============================================================================
 *  COCKPIT — Agenda du jour (lecture seule vers l'app)
 *
 *  À AJOUTER À LA FIN du fichier Apps Script « Gateway_cockpit ».
 *  Bloc autonome : il ne modifie rien d'existant (doGet / doPost / applyOps /
 *  syncHabits / syncTodos restent intacts).
 *
 *  --- MISE EN PLACE (une fois) ---
 *  1. Colle ce bloc à la fin du fichier. Enregistre.
 *  2. Ajoute le déclencheur :
 *       Icône réveil (Déclencheurs) → « + Ajouter un déclencheur »
 *         Fonction              : syncAgenda
 *         Déploiement           : Head
 *         Source de l'événement : Basé sur le temps
 *         Type                  : Minuteur (minutes) → Toutes les 10 minutes
 *  3. Pas de redéploiement de l'application web.
 *
 *  --- POURQUOI ---
 *  Cockpit est une page web sans identifiants Google : elle ne peut pas lire
 *  Google Agenda. Ce robot tourne chez Google avec ton accord et dépose les
 *  événements du jour dans `agenda.json` ; l'app se contente de les afficher.
 *
 *  N'écrit QUE `agenda.json`. Ne lit ni ne touche aucune donnée Cockpit.
 *  Aucun événement n'est créé, modifié ni supprimé : lecture seule.
 * ========================================================================== */

var AGENDA_FILE = 'agenda.json';
var AGENDA_MAX = 20;   // au-delà, ce n'est plus un coup d'œil

function agdPad_(n) { return (n < 10 ? '0' : '') + n; }

function agdToday_() {
  var d = new Date();
  return d.getFullYear() + '-' + agdPad_(d.getMonth() + 1) + '-' + agdPad_(d.getDate());
}

function syncAgenda() {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return; }
  try {
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var end = new Date(start.getTime() + 24 * 3600 * 1000);

    var events = [];
    try {
      var list = CalendarApp.getDefaultCalendar().getEvents(start, end);
      for (var i = 0; i < list.length && events.length < AGENDA_MAX; i++) {
        var ev = list[i];
        var allDay = ev.isAllDayEvent();
        var t = '', e2 = '';
        if (!allDay) {
          var s = ev.getStartTime();
          var f = ev.getEndTime();
          t = agdPad_(s.getHours()) + ':' + agdPad_(s.getMinutes());
          // L'heure de fin donne sa largeur au bloc dans la timeline de l'app.
          // Un événement qui déborde sur le lendemain est ramené à 23:59.
          e2 = (f.getTime() - start.getTime() >= 24 * 3600 * 1000)
            ? '23:59'
            : agdPad_(f.getHours()) + ':' + agdPad_(f.getMinutes());
        }
        events.push({ time: t, end: e2, title: ev.getTitle() || '(sans titre)', allDay: allDay });
      }
    } catch (e) {
      return;   // agenda illisible : on laisse le fichier précédent en place
    }

    var payload = {
      app: 'cockpit-agenda',
      version: 1,
      date: agdToday_(),
      generatedAt: Date.now(),
      events: events
    };

    var next = JSON.stringify(payload, null, 2);

    // N'écrire que si le contenu utile a changé : sans ça, `generatedAt`
    // provoquerait une écriture Drive toutes les 10 minutes pour rien.
    var f = findFile_(AGENDA_FILE);
    if (f) {
      try {
        var prev = JSON.parse(f.getBlob().getDataAsString('UTF-8'));
        if (prev && prev.date === payload.date &&
            JSON.stringify(prev.events) === JSON.stringify(payload.events)) {
          return;
        }
      } catch (e) { /* illisible : on réécrit */ }
    }
    writeTarget_(AGENDA_FILE, next);
  } finally {
    lock.releaseLock();
  }
}

/** Utilitaire manuel : affiche ce que le robot voit aujourd'hui. */
function agdDebug() {
  syncAgenda();
  var f = findFile_(AGENDA_FILE);
  Logger.log(f ? f.getBlob().getDataAsString('UTF-8') : '(agenda.json absent)');
}
