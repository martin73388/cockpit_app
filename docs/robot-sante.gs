/** ============================================================================
 *  COCKPIT — Contrôle de santé de la passerelle
 *
 *  Pourquoi ce bloc existe : le 26/08, le dossier Drive « Cockpit » a été
 *  recréé pendant une réorganisation. La passerelle a continué de tourner
 *  dans l'ancien dossier, parti à la corbeille. `applyOps` n'y trouvait plus
 *  d'ordres, `syncHabits` plus de données, et `syncAgenda` s'est fabriqué un
 *  second `agenda.json` qu'il a mis à jour tout seul pendant cinq jours.
 *  Rien n'a échoué. Rien n'a prévenu. C'est ça, le vrai défaut.
 *
 *  Ce bloc ne répare pas la plomberie : il la surveille et il crie.
 *  Il n'appelle NI findFile_ NI writeTarget_ — s'ils sont en panne, le
 *  gardien doit continuer de fonctionner.
 *
 *  --- MISE EN PLACE (dans cet ordre, l'ordre compte) ---
 *  1. Colle ce bloc à la fin de « Gateway_cockpit ». Enregistre.
 *  2. Exécute `santeSeed` À LA MAIN une fois : il enregistre l'identifiant
 *     Drive de chacun des cinq fichiers. Lis le journal, vérifie que les cinq
 *     sont trouvés.
 *  3. Exécute `santeCheck` À LA MAIN une fois. Google va demander une
 *     autorisation supplémentaire (envoi d'e-mail) : accepte-la.
 *
 *     ⚠ NE SAUTE PAS CETTE ÉTAPE. Ce bloc ajoute le droit d'envoyer un mail.
 *     Tant que tu ne l'as pas accordé à la main, TOUS les déclencheurs du
 *     projet — applyOps compris — échouent sur une erreur d'autorisation.
 *     Tu casserais la passerelle avec l'outil censé la surveiller.
 *
 *  4. Alors seulement, ajoute le déclencheur :
 *       Fonction : santeCheck · Basé sur le temps · Minuteur (heures) → 1 h
 *
 *  --- CE QU'IL SURVEILLE ---
 *    · le dossier configuré existe, et n'est pas à la corbeille
 *    · les cinq fichiers sont toujours là, et toujours dans CE dossier
 *    · aucun doublon vivant (le symptôme resté invisible cinq jours)
 *    · agenda.json a moins de 24 h (sinon syncAgenda ne fait plus son travail)
 *    · aucun ops-*.json en souffrance depuis plus de 15 min (applyOps coincé)
 *
 *  Et si FOLDER_ID est cassé alors que les cinq fichiers, eux, répondent
 *  toujours à leur identifiant : il recale FOLDER_ID sur leur dossier réel et
 *  te le dit. La prochaine réorganisation de ton Drive ne coûtera rien.
 * ========================================================================== */

var SANTE_IDS_KEY   = 'SANTE_IDS';    // { "nom de fichier": "id Drive" }
var SANTE_STATE_KEY = 'SANTE_ETAT';   // anti-spam : dernière alerte envoyée
var SANTE_FILES     = ['cockpit-data.json', 'radar.json', 'carnet-data.json',
                       'daily-brief.json', 'agenda.json'];
var SANTE_AGENDA_MAX_H = 24;          // agenda.json plus vieux que ça = anormal
var SANTE_OPS_MAX_MIN  = 15;          // ops non consommé au-delà = applyOps coincé
var SANTE_REPEAT_H     = 12;          // ne pas répéter la même alerte avant ça
var SANTE_AUTOHEAL     = true;        // recaler FOLDER_ID tout seul (et le dire)

function santeProps_() { return PropertiesService.getScriptProperties(); }

function santeFolderId_() {
  var p = santeProps_();
  return p.getProperty('FOLDER_ID') || p.getProperty('folderId') || '';
}

/** Le fichier, ou null — ne lève jamais : un gardien qui plante ne sert à rien. */
function santeFile_(id) {
  try { return DriveApp.getFileById(id); } catch (e) { return null; }
}

function santeParentIds_(file) {
  var ids = [];
  try {
    var it = file.getParents();
    while (it.hasNext()) ids.push(it.next().getId());
  } catch (e) { /* parent inaccessible : liste vide, c'est déjà un signal */ }
  return ids;
}

/** À exécuter une fois à la main : épingle les cinq fichiers par identifiant. */
function santeSeed() {
  var fid = santeFolderId_();
  var out = ['FOLDER_ID = ' + (fid || '(vide)')];
  var map = {}, folder = null;

  try { folder = DriveApp.getFolderById(fid); }
  catch (e) {
    Logger.log('Dossier introuvable (' + e.message + ') — corrige FOLDER_ID avant de semer.');
    return;
  }

  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next(), n = f.getName();
    if (SANTE_FILES.indexOf(n) >= 0) map[n] = f.getId();
  }
  for (var i = 0; i < SANTE_FILES.length; i++) {
    var name = SANTE_FILES[i];
    out.push(map[name] ? (name + ' -> ' + map[name]) : (name + ' -> INTROUVABLE dans le dossier'));
  }
  santeProps_().setProperty(SANTE_IDS_KEY, JSON.stringify(map));
  out.push('Épinglé : ' + Object.keys(map).length + ' / ' + SANTE_FILES.length + ' fichiers.');
  Logger.log(out.join('\n'));
}

/**
 * Le diagnostic pur : ne poste rien, n'envoie rien.
 * Retourne { problems: [...], notes: [...], healed: '' }.
 * Séparé de santeCheck pour être testable hors d'Apps Script.
 */
function santeAudit_(now) {
  now = now || Date.now();
  var problems = [], notes = [], healed = '';
  var props = santeProps_();
  var fid = santeFolderId_();

  var pinned = {};
  try { pinned = JSON.parse(props.getProperty(SANTE_IDS_KEY) || '{}') || {}; } catch (e) { pinned = {}; }
  if (!Object.keys(pinned).length) {
    problems.push('Aucun fichier épinglé : exécute `santeSeed` une fois.');
    return { problems: problems, notes: notes, healed: healed };
  }

  // --- 1. Le dossier de travail --------------------------------------------
  // La panne du dossier est mise de côté : si le recalage ci-dessous la résout,
  // elle devient la CAUSE d'une réparation, pas un problème en cours. Sans ça,
  // le mail annoncerait la panne et sa réparation dans le même souffle.
  var folder = null, folderWhy = '';
  if (!fid) {
    folderWhy = 'FOLDER_ID était vide';
  } else {
    try {
      folder = DriveApp.getFolderById(fid);
      if (folder.isTrashed()) {
        folderWhy = 'le dossier « ' + folder.getName() + ' » est à la CORBEILLE';
        folder = null;
      }
    } catch (e) {
      folderWhy = 'FOLDER_ID (' + fid + ') ne désigne aucun dossier accessible';
    }
  }

  // --- 2. Recalage automatique ---------------------------------------------
  // Les fichiers épinglés répondent encore ? Alors ils savent où ils habitent,
  // et c'est FOLDER_ID qui a tort — pas eux.
  if (!folder && SANTE_AUTOHEAL) {
    var votes = {};
    for (var n0 in pinned) {
      var f0 = santeFile_(pinned[n0]);
      if (!f0 || f0.isTrashed()) continue;
      var ps = santeParentIds_(f0);
      for (var k = 0; k < ps.length; k++) votes[ps[k]] = (votes[ps[k]] || 0) + 1;
    }
    var best = '', bestN = 0;
    for (var v in votes) if (votes[v] > bestN) { best = v; bestN = votes[v]; }
    // Majorité franche exigée : on ne suit pas un fichier isolé.
    if (best && bestN >= 3 && best !== fid) {
      props.setProperty('FOLDER_ID', best);
      healed = (folderWhy ? folderWhy + '. ' : '') +
               'FOLDER_ID recalé automatiquement : ' + (fid || '(vide)') + ' -> ' + best +
               ' (' + bestN + ' fichiers sur ' + Object.keys(pinned).length + ' y sont).';
      fid = best;
      folderWhy = '';
      try { folder = DriveApp.getFolderById(fid); } catch (e) { folder = null; }
    }
  }

  // Toujours pas résolu : c'est le problème le plus grave de la liste, car il
  // rend tous les autres contrôles muets.
  if (folderWhy) {
    problems.push('Dossier de travail : ' + folderWhy + '. La passerelle écrit dans le vide.');
  }

  // --- 3. Les fichiers épinglés --------------------------------------------
  for (var name in pinned) {
    var f = santeFile_(pinned[name]);
    if (!f) { problems.push(name + ' : identifiant épinglé introuvable (' + pinned[name] + ').'); continue; }
    if (f.isTrashed()) { problems.push(name + ' : le fichier est à la corbeille.'); continue; }
    if (fid && santeParentIds_(f).indexOf(fid) === -1) {
      problems.push(name + ' : n\'est plus dans le dossier de travail. ' +
                    'Soit il a été déplacé, soit la passerelle regarde ailleurs.');
    }
  }

  // --- 4. Doublons ----------------------------------------------------------
  // Deux fichiers du même nom = l'app et le robot ne lisent pas le même.
  // C'est ce qui est passé inaperçu pendant cinq jours.
  for (var j = 0; j < SANTE_FILES.length; j++) {
    var nm = SANTE_FILES[j], live = 0, trashed = 0;
    try {
      var fi = DriveApp.getFilesByName(nm);
      while (fi.hasNext()) { if (fi.next().isTrashed()) trashed++; else live++; }
    } catch (e) { continue; }
    if (live > 1) problems.push(nm + ' : ' + live + ' exemplaires vivants dans le Drive.');
    else if (trashed > 0) notes.push(nm + ' : ' + trashed + ' exemplaire(s) à la corbeille — à vider.');
  }

  // --- 5. L'agenda est-il encore rafraîchi ? --------------------------------
  if (pinned['agenda.json']) {
    var ag = santeFile_(pinned['agenda.json']);
    if (ag && !ag.isTrashed()) {
      var ageH = (now - ag.getLastUpdated().getTime()) / 3600000;
      if (ageH > SANTE_AGENDA_MAX_H) {
        problems.push('agenda.json n\'a pas bougé depuis ' + Math.floor(ageH) + ' h. ' +
                      'syncAgenda le réécrit au moins une fois par jour : il ne tourne plus, ' +
                      'ou il écrit ailleurs.');
      }
    }
  }

  // --- 6. Un ordre resté sur le carreau ------------------------------------
  if (folder) {
    try {
      var itf = folder.getFiles();
      while (itf.hasNext()) {
        var of = itf.next(), on = of.getName();
        if (on.indexOf('ops-') !== 0) continue;
        var ageMin = (now - of.getDateCreated().getTime()) / 60000;
        if (ageMin > SANTE_OPS_MAX_MIN) {
          problems.push(on + ' attend depuis ' + Math.floor(ageMin) + ' min. ' +
                        'applyOps tourne à la minute : il est arrêté, en erreur, ou il ' +
                        'regarde un autre dossier.');
        }
      }
    } catch (e) { /* dossier illisible : déjà signalé plus haut */ }
  }

  return { problems: problems, notes: notes, healed: healed };
}

/** Le gardien. À mettre sur un déclencheur horaire. N'échoue jamais. */
function santeCheck() {
  var r;
  try { r = santeAudit_(Date.now()); }
  catch (e) { r = { problems: ['Le contrôle de santé a lui-même échoué : ' + e.message], notes: [], healed: '' }; }

  var lines = [];
  if (r.healed) lines.push('RÉPARÉ — ' + r.healed);
  if (r.problems.length) {
    lines.push('Problèmes (' + r.problems.length + ') :');
    for (var i = 0; i < r.problems.length; i++) lines.push('  · ' + r.problems[i]);
  }
  if (r.notes.length) {
    lines.push('Remarques :');
    for (var j = 0; j < r.notes.length; j++) lines.push('  · ' + r.notes[j]);
  }
  var body = lines.length ? lines.join('\n') : 'Passerelle Cockpit : rien à signaler.';
  Logger.log(body);

  // Anti-spam : une alerte identique n'est répétée qu'au bout de SANTE_REPEAT_H.
  // Un problème qui CHANGE repart tout de suite — c'est une information neuve.
  var props = santeProps_();
  var prev = {};
  try { prev = JSON.parse(props.getProperty(SANTE_STATE_KEY) || '{}') || {}; } catch (e) { prev = {} }

  var sig = r.problems.slice().sort().join('|') + (r.healed ? '|healed' : '');
  var alerting = !!(r.problems.length || r.healed);

  if (!alerting) {
    // Retour à la normale : on le dit une fois, puis on se tait.
    if (prev.sig) {
      santeMail_('Cockpit : la passerelle est repartie',
                 'Plus aucun problème détecté.\n\nDernière alerte :\n' + (prev.sig || '').split('|').join('\n'));
      props.setProperty(SANTE_STATE_KEY, '{}');
    }
    return;
  }

  var repeat = prev.sig === sig && prev.at && (Date.now() - prev.at) < SANTE_REPEAT_H * 3600000;
  if (!repeat) {
    santeMail_('Cockpit : la passerelle décroche', body);
    props.setProperty(SANTE_STATE_KEY, JSON.stringify({ sig: sig, at: Date.now() }));
  }
}

/** L'e-mail est le seul canal qui échappe à la plomberie en panne. */
function santeMail_(subject, body) {
  try {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), subject, body);
  } catch (e) {
    Logger.log('Envoi impossible (' + e.message + ') — autorisation e-mail accordée ?');
  }
}
