/** ============================================================================
 *  COCKPIT — Diagnostic de la passerelle (lecture seule)
 *
 *  À coller à la fin du fichier Apps Script « Gateway_cockpit », puis :
 *    sélectionner « diagGateway » dans le menu déroulant des fonctions
 *    → Exécuter → lire le journal (Ctrl+Entrée / « Journal d'exécution »).
 *
 *  N'écrit rien, ne supprime rien, ne crée aucun fichier. Répond à trois
 *  questions qu'on ne peut pas voir depuis l'extérieur :
 *    1. sur quel dossier la passerelle travaille réellement,
 *    2. quels déclencheurs sont encore installés,
 *    3. où sont passés les fichiers de données (doublons compris).
 *
 *  Les VALEURS des propriétés ne sont jamais affichées (le secret partagé en
 *  fait partie) — seuls leurs noms le sont, plus FOLDER_ID qui n'est pas secret.
 * ========================================================================== */

var DIAG_FILES = ['cockpit-data.json', 'radar.json', 'carnet-data.json',
                  'daily-brief.json', 'agenda.json'];

function diagGateway() {
  var L = [];
  var say = function (s) { L.push(s); };

  // --- 1. Configuration -----------------------------------------------------
  var props = {};
  try { props = PropertiesService.getScriptProperties().getProperties(); }
  catch (e) { say('!! propriétés illisibles : ' + e.message); }

  var keys = Object.keys(props);
  say('Propriétés du script (noms seuls) : ' + (keys.length ? keys.join(', ') : '(aucune)'));

  var fid = props.FOLDER_ID || props.folderId || '';
  if (fid) {
    say('FOLDER_ID (propriété) = ' + fid);
  } else {
    say('FOLDER_ID : AUCUNE propriété de ce nom.');
    say('  -> l\'identifiant est donc écrit en dur dans le code : cherche');
    say('     « FOLDER_ID » ou « getFolderById » dans le fichier.');
    try { fid = FOLDER_ID; say('FOLDER_ID (variable du script) = ' + fid); }
    catch (e) { say('  (pas de variable globale FOLDER_ID non plus)'); }
  }

  // --- 2. Le dossier sur lequel la passerelle travaille vraiment -------------
  if (fid) {
    try {
      var f = DriveApp.getFolderById(fid);
      say('Dossier résolu : « ' + f.getName() + ' »');
      say('  dans la corbeille : ' + f.isTrashed());
      say('  URL : ' + f.getUrl());
      var it = f.getFiles(), seen = [];
      while (it.hasNext()) seen.push(it.next().getName());
      seen.sort();
      say('  fichiers visibles (' + seen.length + ') : ' + (seen.join(', ') || '(vide)'));
    } catch (e) {
      say('!! getFolderById a échoué : ' + e.message);
      say('   -> le dossier configuré n\'existe plus du tout.');
    }
  }

  // --- 3. Déclencheurs ------------------------------------------------------
  var trigs = ScriptApp.getProjectTriggers();
  say('Déclencheurs installés : ' + trigs.length);
  for (var i = 0; i < trigs.length; i++) {
    say('  - ' + trigs[i].getHandlerFunction() +
        '  (' + trigs[i].getEventType() + ' / ' + trigs[i].getTriggerSource() + ')');
  }
  say('  Note : un déclencheur DÉSACTIVÉ par Google après trop d\'échecs');
  say('  n\'apparaît plus ici. Vérifie aussi « Exécutions » dans le menu.');

  // --- 4. Où sont réellement les fichiers de données -------------------------
  say('--- Emplacement réel de chaque fichier (doublons compris) ---');
  for (var j = 0; j < DIAG_FILES.length; j++) {
    var name = DIAG_FILES[j], n = 0;
    var fi = DriveApp.getFilesByName(name);
    while (fi.hasNext()) {
      var file = fi.next(); n++;
      var par = file.getParents(), where = [];
      while (par.hasNext()) {
        var p = par.next();
        where.push(p.getName() + (p.isTrashed() ? ' [CORBEILLE]' : '') + ' / ' + p.getId());
      }
      say(name + '  #' + n +
          '  id=' + file.getId() +
          '  modifié=' + Utilities.formatDate(file.getLastUpdated(), Session.getScriptTimeZone(), 'dd/MM HH:mm') +
          (file.isTrashed() ? '  [FICHIER EN CORBEILLE]' : '') +
          '  parent=' + (where.join(' + ') || '(aucun parent accessible)'));
    }
    if (n === 0) say(name + '  : INTROUVABLE');
    if (n > 1) say('  ^^ ' + n + ' exemplaires : l\'app et le robot ne lisent pas le même.');
  }

  Logger.log(L.join('\n'));
}
