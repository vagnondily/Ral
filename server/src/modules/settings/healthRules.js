/**
 * État de la configuration — logique PURE (testée, sans I/O). Transforme des
 * comptages (health.repository.js) en lignes « prêt / à compléter / bloquant »,
 * chacune avec l'écran où la régler et les pages qui en dépendent
 * (docs/REFONTE_UX.md §4.2). Un réglage qu'on ne sait pas encore mesurer est
 * « non_mesurable » : jamais un 0 trompeur.
 *
 * Les messages sont des phrases françaises à paramètres ({n}…) traduites par
 * l'interface (tr(text, params)).
 */

const STATUSES = ['pret', 'a_completer', 'bloquant', 'non_mesurable'];

// Où régler (clé de page du registre de routes, avec l'adresse actuelle en repli).
const FIX = {
  decoupage: { key: 'sites.localites', tab: 'decoupage', hash: '#/parametrage/localites' },
  lieux: { key: 'donnees.qualite', tab: 'lieux', hash: '#/parametrage/localites' },
  contrats: { key: 'contrats.liste', hash: '#/contrats/liste' },
  bureaux: { key: 'reglages.bureaux', hash: '#/parametrage/bureaux' },
  exigences: { key: 'reglages.activites', tab: 'exigences', hash: '#/parametrage/mmr' },
  fiches: { key: 'donnees.fiches', hash: '#/processus/donnees' },
  partenaires: { key: 'partenaires.liste', hash: '#/parametrage/partenaires' },
  equipe: { key: 'partenaires.liste', tab: 'tpm', hash: '#/tpm/prestataires' },
  plans: { key: 'contrats.plans', hash: '#/tpm/budget' },
  taux: { key: 'reglages.pays', tab: 'taux', hash: '#/parametrage/taux' },
  pays: { key: 'reglages.pays', hash: '#/parametrage/localites' },
  utilisateurs: { key: 'reglages.utilisateurs', hash: '#/parametrage/utilisateurs' },
};

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const rule = (code, status, { count = null, total = null, text, params = {}, fix, consumers }) =>
  ({ code, status, count, total, message: { text, params }, fix: FIX[fix], consumers });
// Règle d'un lot pas encore livré : affichée « Pas encore mesurable », jamais comme un 0.
const later = (code, text, fix, consumers, lot) => rule(code, 'non_mesurable', { text, params: { lot }, fix, consumers });

/**
 * @param {object} c  comptages (voir health.repository.js)
 * @returns {Array<{code, status, count, total, message:{text, params}, fix, consumers}>}
 */
function evaluateHealth(c) {
  const out = [];
  const a = c.areas || {};
  if (!a.total) {
    out.push(rule('decoupage', 'bloquant', { count: 0, text: 'Aucun découpage administratif importé.', fix: 'decoupage',
      consumers: ['Sites', 'Localités', 'Formulaires reçus', 'Distributions', 'Contrats'] }));
  } else if (a.communes && a.communesWithPcode < a.communes) {
    out.push(rule('decoupage', 'a_completer', { count: a.communes - a.communesWithPcode, total: a.communes,
      text: '{n} commune(s) sur {total} sans code officiel : les formulaires codés ne peuvent pas leur être reliés.',
      params: { n: a.communes - a.communesWithPcode, total: a.communes }, fix: 'decoupage',
      consumers: ['Sites', 'Localités', 'Formulaires reçus', 'Distributions'] }));
  } else if (!a.communes) {
    out.push(rule('decoupage', 'a_completer', { count: 0, total: a.total,
      text: 'Le découpage s\'arrête avant le niveau commune : sites et formulaires ne sont reliés qu\'au district.',
      fix: 'decoupage', consumers: ['Sites', 'Formulaires reçus', 'Distributions'] }));
  } else {
    out.push(rule('decoupage', 'pret', { count: a.total, total: a.total, text: '{n} unités, toutes les communes ont un code officiel.',
      params: { n: a.total }, fix: 'decoupage', consumers: ['Sites', 'Localités', 'Formulaires reçus', 'Distributions', 'Contrats'] }));
  }

  const z = c.detachedZones || 0;
  out.push(rule('zones_contrat_detachees', z ? 'a_completer' : 'pret', { count: z,
    text: z ? '{n} zone(s) de contrat à resélectionner (localité disparue du découpage).' : 'Toutes les zones de contrat sont reliées au découpage.',
    params: { n: z }, fix: 'contrats', consumers: ['Contrats'] }));

  const s = c.sites || {};
  out.push(rule('sites_sans_code_commune', s.withoutPcode ? 'a_completer' : 'pret', { count: s.withoutPcode || 0, total: s.total || 0,
    text: s.withoutPcode ? '{n} site(s) sur {total} sans code officiel de commune : leur dernière collecte ne peut pas être lue.' : 'Tous les sites ont un code officiel de commune.',
    params: { n: s.withoutPcode || 0, total: s.total || 0 }, fix: 'lieux', consumers: ['Sites', 'Visites', 'Tableau de bord'] }));
  out.push(rule('sites_sans_bureau', s.withoutOffice ? 'a_completer' : 'pret', { count: s.withoutOffice || 0, total: s.total || 0,
    text: s.withoutOffice ? '{n} site(s) sans bureau : complétez le périmètre des bureaux.' : 'Tous les sites sont rattachés à un bureau.',
    params: { n: s.withoutOffice || 0 }, fix: 'bureaux', consumers: ['Sites', 'Visites', 'Couverture', 'Rapports'] }));

  const ob = c.officesWithoutPerimeter || 0;
  out.push(rule('bureaux_sans_perimetre', ob ? 'a_completer' : 'pret', { count: ob,
    text: ob ? '{n} bureau(x) actif(s) sans aucune commune dans leur périmètre.' : 'Chaque bureau actif a un périmètre.',
    params: { n: ob }, fix: 'bureaux', consumers: ['Sites', 'Formulaires reçus', 'Distributions'] }));

  const am = c.activityWithoutMmr || 0;
  out.push(rule('activites_sans_exigence', am ? 'a_completer' : 'pret', { count: am,
    text: am ? '{n} couple(s) bureau × activité de sites sans exigence de suivi : les visites exigées restent vides.' : 'Chaque activité des sites a une exigence de suivi.',
    params: { n: am }, fix: 'exigences', consumers: ['Visites', 'Couverture'] }));

  out.push(later('frequences_risque', 'Fréquence de suivi selon le risque : réglable avec le lot G.', 'exigences', ['Sites', 'Visites'], 'lot G'));

  const fa = c.formsWithoutActivity || 0;
  out.push(rule('fiches_sans_activite', fa ? 'a_completer' : 'pret', { count: fa, total: c.formsActive || 0,
    text: fa ? '{n} fiche(s) de suivi active(s) non rattachée(s) à une activité : leur couverture reste vide.' : 'Chaque fiche active est rattachée à une activité.',
    params: { n: fa }, fix: 'fiches', consumers: ['Tableau de bord', 'Rapports'] }));

  const q = c.queue || {}; const sub = c.submissions || {};
  const qBlocking = sub.total > 0 && q.submissionsOcc > sub.total * 0.1;
  out.push(rule('lieux_a_rapprocher', !q.entries ? 'pret' : qBlocking ? 'bloquant' : 'a_completer', { count: q.entries || 0,
    text: q.entries ? '{n} nom(s) de lieu à rapprocher ({rows} ligne(s) concernée(s)).' : 'Tous les noms de lieux importés sont reconnus.',
    params: { n: q.entries || 0, rows: (q.sitesOcc || 0) + (q.submissionsOcc || 0) }, fix: 'lieux',
    consumers: ['Formulaires reçus', 'Sites', 'Distributions', 'Tableau de bord'] }));

  if (!sub.monthTotal) {
    out.push(rule('formulaires_sans_commune', 'pret', { count: 0, text: 'Aucun formulaire reçu pour l\'instant.', fix: 'lieux', consumers: ['Couverture', 'Tableau de bord'] }));
  } else {
    const share = pct(sub.monthWithoutCommune, sub.monthTotal);
    out.push(rule('formulaires_sans_commune', share > 10 ? 'a_completer' : 'pret', { count: sub.monthWithoutCommune, total: sub.monthTotal,
      text: '{p} % des formulaires de {month} sans commune reconnue ({n} sur {total}).',
      params: { p: share, month: sub.month, n: sub.monthWithoutCommune, total: sub.monthTotal }, fix: 'lieux', consumers: ['Couverture', 'Tableau de bord'] }));
  }
  out.push(rule('formulaires_sans_bureau', sub.withoutOffice ? 'a_completer' : 'pret', { count: sub.withoutOffice || 0, total: sub.total || 0,
    text: sub.withoutOffice ? '{n} formulaire(s) reçu(s) sans bureau reconnu : importez la définition XLSForm de la fiche ou complétez les périmètres.' : 'Chaque formulaire reçu est relié à un bureau.',
    params: { n: sub.withoutOffice || 0 }, fix: 'lieux', consumers: ['Rapports par bureau'] }));

  const t = c.tpm || {};
  out.push(rule('tpm_absent', t.active ? 'pret' : 'bloquant', { count: t.active || 0,
    text: t.active ? '{n} prestataire(s) de suivi actif(s).' : 'Aucun prestataire de suivi (TPM) actif.',
    params: { n: t.active || 0 }, fix: 'partenaires', consumers: ['Visites', 'Plans de collecte', 'Factures', 'Agents'] }));
  out.push(rule('prestataires_sans_agent', t.withoutAgent ? 'a_completer' : 'pret', { count: t.withoutAgent || 0,
    text: t.withoutAgent ? '{n} prestataire(s) de suivi sans agent.' : 'Chaque prestataire de suivi a des agents.',
    params: { n: t.withoutAgent || 0 }, fix: 'equipe', consumers: ['Formations', 'Agents & évaluation'] }));
  out.push(rule('prestataires_sans_contrat', t.withoutContract ? 'a_completer' : 'pret', { count: t.withoutContract || 0,
    text: t.withoutContract ? '{n} prestataire(s) de suivi sans contrat actif.' : 'Chaque prestataire de suivi a un contrat actif.',
    params: { n: t.withoutContract || 0 }, fix: 'contrats', consumers: ['Plans de collecte', 'Factures', 'Suivi budgétaire'] }));
  out.push(rule('contrats_sans_ligne_suivi', t.contractsWithoutLine ? 'a_completer' : 'pret', { count: t.contractsWithoutLine || 0,
    text: t.contractsWithoutLine ? '{n} contrat(s) actif(s) de prestataire de suivi sans poste « IV. Suivi » : ils n\'apparaissent pas dans le suivi budgétaire.' : 'Chaque contrat de suivi a son poste « IV. Suivi ».',
    params: { n: t.contractsWithoutLine || 0 }, fix: 'contrats', consumers: ['Plans de collecte', 'Factures', 'Suivi budgétaire'] }));

  const dp = c.draftPlansPast || 0;
  out.push(rule('plans_brouillon_echus', dp ? 'a_completer' : 'pret', { count: dp,
    text: dp ? '{n} plan(s) de collecte encore en brouillon pour un mois passé.' : 'Aucun plan de collecte en retard.',
    params: { n: dp }, fix: 'plans', consumers: ['Suivi budgétaire', 'Factures'] }));
  const mr = c.monthsWithoutRate || 0;
  out.push(rule('taux_manquant', mr ? 'a_completer' : 'pret', { count: mr,
    text: mr ? '{n} mois de plans ou de factures sans taux de change applicable : les montants en USD restent vides.' : 'Un taux de change s\'applique à chaque mois saisi.',
    params: { n: mr }, fix: 'taux', consumers: ['Plans de collecte', 'Factures', 'Suivi budgétaire'] }));

  const p = c.profile || {};
  const missing = [!p.currency && 'devise', !p.center && 'centre de la carte'].filter(Boolean);
  out.push(rule('profil_pays', missing.length ? 'a_completer' : 'pret', { count: missing.length,
    text: missing.length ? 'Profil pays incomplet : {what}.' : 'Profil pays complet.', params: { what: missing.join(', ') }, fix: 'pays',
    consumers: ['Carte des sites', 'Montants'] }));

  const v = c.validators || 0;
  out.push(rule('valideurs', v >= 2 ? 'pret' : 'bloquant', { count: v,
    text: v >= 2 ? '{n} comptes peuvent valider.' : 'Moins de 2 comptes peuvent valider : la séparation des tâches (celui qui soumet ne valide pas) est impossible.',
    params: { n: v }, fix: 'utilisateurs', consumers: ['Contrats', 'Factures', 'Évaluations'] }));

  out.push(later('agents_sans_code', 'Code d\'enquêteur des agents : mesurable avec le lot E.', 'equipe', ['Agents & évaluation'], 'lot E'));
  out.push(later('themes_formation', 'Thèmes de formation : mesurable avec le lot F.', 'equipe', ['Formations'], 'lot F'));
  out.push(later('agents_a_reconnaitre', 'Enquêteurs non reliés à un agent : mesurable avec le lot K.', 'lieux', ['Agents & évaluation'], 'lot K'));
  out.push(later('methode_notation', 'Méthode de notation des agents : mesurable avec le lot L.', 'equipe', ['Agents & évaluation'], 'lot L'));
  return out;
}

/** Résumé pour un bandeau : pire statut et nombre de lignes par statut (hors non mesurables). */
function summarizeHealth(rules) {
  const counts = Object.fromEntries(STATUSES.map((st) => [st, 0]));
  for (const r of rules) counts[r.status] += 1;
  const worst = counts.bloquant ? 'bloquant' : counts.a_completer ? 'a_completer' : 'pret';
  return { worst, counts };
}

module.exports = { evaluateHealth, summarizeHealth, STATUSES, FIX };
