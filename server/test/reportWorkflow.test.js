const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  TRANSITIONS, STATUSES, SUBMITTABLE, EDITABLE, canTransition, authorOf, editError, submitError, decisionError,
  notApplicableError, reportActions,
} = require('../src/modules/tpm/reportWorkflow');

test('décision sur un rapport : seul un rapport soumis, jamais par son auteur', () => {
  assert.equal(decisionError({ status: 'soumis', createdBy: 'u1' }, 'u2'), null);
  for (const status of ['attendu', 'valide', 'rejete', 'non_applicable']) {
    assert.equal(decisionError({ status, createdBy: 'u1' }, 'u2').code, 'status', status);
  }
  const self = decisionError({ status: 'soumis', createdBy: 'u1' }, 'u1');
  assert.equal(self.code, 'self'); assert.match(self.message, /Séparation des tâches/);
});

test('séparation des tâches : ni le SOUMETTEUR ni l\'AUTEUR ne décident (gabarit créé par un autre)', () => {
  // Gabarit mensuel généré par u1, rempli (auteur) et soumis par u2.
  const report = { status: 'soumis', createdBy: 'u1', editedBy: 'u2', submittedBy: 'u2' };
  assert.equal(decisionError(report, 'u2').code, 'self', 'le soumetteur ne valide pas');
  assert.equal(decisionError(report, 'u1'), null, "le générateur du gabarit, qui n'a ni rempli ni soumis, peut décider");
  assert.equal(decisionError(report, 'u3'), null);
  // Soumetteur inconnu (données antérieures) : le créateur est tenu pour soumetteur.
  assert.equal(decisionError({ status: 'soumis', createdBy: 'u1', submittedBy: null }, 'u1').code, 'self');
});

test('séparation des tâches : la personne qui a rempli le contenu ne décide pas, même si un autre a soumis', () => {
  // Contenu rempli par u2 (auteur), soumission enregistrée au nom de u3.
  const report = { status: 'soumis', createdBy: 'u1', editedBy: 'u2', submittedBy: 'u3' };
  const byAuthor = decisionError(report, 'u2');
  assert.equal(byAuthor.code, 'self');
  assert.match(byAuthor.message, /rempli l'état des dépenses/);
  assert.equal(decisionError(report, 'u3').code, 'self', 'le soumetteur non plus');
  assert.equal(decisionError(report, 'u4'), null);
  // Auteur inconnu : repli prudent sur le créateur (il ne décide pas).
  assert.equal(decisionError({ status: 'soumis', createdBy: 'u1', editedBy: null, submittedBy: 'u3' }, 'u1').code, 'self');
});

test('modifier l\'état des dépenses : seulement en brouillon (attendu / rejeté)', () => {
  assert.deepEqual([...EDITABLE].sort(), ['attendu', 'rejete']);
  assert.deepEqual([...EDITABLE].sort(), [...SUBMITTABLE].sort(), 'on modifie exactement ce que l\'on peut soumettre');
  for (const status of ['attendu', 'rejete']) assert.equal(editError({ status, editedBy: 'u1' }, 'u1'), null, status);
  for (const status of ['soumis', 'valide', 'non_applicable']) {
    const err = editError({ status, editedBy: 'u1' }, 'u1');
    assert.equal(err.code, 'locked', `${status} : même l'auteur ne modifie pas`);
  }
  assert.match(editError({ status: 'soumis', editedBy: 'u1' }, 'u1').message, /figé pendant la décision/);
  assert.match(editError({ status: 'valide', editedBy: 'u1' }, 'u1').message, /validé ne peut plus être modifié/);
});

test('modifier / soumettre : seulement par l\'auteur ; un gabarit vierge est pris en charge par qui le remplit', () => {
  // Gabarit vierge (aucun auteur) : toute personne habilitée peut le remplir.
  const stub = { status: 'attendu', kind: 'financier', createdBy: 'gen', editedBy: null };
  assert.equal(authorOf(stub), null);
  assert.equal(editError(stub, 'u2'), null);
  assert.equal(editError(stub, 'gen'), null);
  // Une fois rempli par u2, u2 en est l'auteur : personne d'autre ne le modifie ni ne le soumet.
  const filled = { ...stub, editedBy: 'u2', itemCount: 2 };
  assert.equal(authorOf(filled), 'u2');
  assert.equal(editError(filled, 'u2'), null);
  assert.equal(editError(filled, 'gen').code, 'author', 'pas même celui qui a généré le gabarit');
  assert.match(editError(filled, 'gen').message, /Seul l'auteur/);
  assert.equal(submitError(filled, 'u2'), null);
  assert.equal(submitError(filled, 'gen').code, 'author');
  // Rapport rejeté : seul son auteur le corrige et le resoumet (pas le validateur qui l'a rejeté).
  const rejected = { status: 'rejete', kind: 'financier', createdBy: 'a', editedBy: 'a', decidedBy: 'v', itemCount: 1 };
  assert.equal(editError(rejected, 'v').code, 'author');
  assert.equal(submitError(rejected, 'v').code, 'author');
  assert.equal(editError(rejected, 'a'), null);
  assert.equal(submitError(rejected, 'a'), null);
  // Statut d'abord : soumettre un rapport soumis est une erreur de statut, quel que soit l'acteur.
  assert.equal(submitError({ ...rejected, status: 'soumis' }, 'v').code, 'status');
});

test('H12 : un validateur ne valide jamais des chiffres qu\'il a saisis ou modifiés', () => {
  // Facture créée et soumise par l'admin (auteur + soumetteur).
  let r = { status: 'soumis', kind: 'financier', createdBy: 'admin', editedBy: 'admin', submittedBy: 'admin', itemCount: 2 };
  // Scénario 1 : le validateur modifie la facture soumise puis la valide → la modification est refusée.
  assert.equal(editError(r, 'valid').code, 'locked');
  // Scénario 2 : il la rejette, la corrige et la resoumet → correction et resoumission refusées.
  r = { ...r, status: 'rejete', decidedBy: 'valid' };
  assert.equal(editError(r, 'valid').code, 'author');
  assert.equal(submitError(r, 'valid').code, 'author');
  // L'auteur corrige et resoumet ; il ne peut pas valider lui-même, le validateur si.
  assert.equal(editError(r, 'admin'), null);
  assert.equal(submitError(r, 'admin'), null);
  r = { ...r, status: 'soumis', submittedBy: 'admin' };
  assert.equal(decisionError(r, 'admin').code, 'self');
  assert.equal(decisionError(r, 'valid'), null);
  // Scénario 3 : le validateur prend en charge un gabarit vierge, le remplit et le soumet :
  // c'est alors un AUTRE gestionnaire qui décide.
  const stub = { status: 'soumis', kind: 'financier', createdBy: 'admin', editedBy: 'valid', submittedBy: 'valid' };
  assert.equal(decisionError(stub, 'valid').code, 'self');
  assert.equal(decisionError(stub, 'admin'), null);
});

test('actions permises : l\'écran n\'offre que ce que le serveur acceptera', () => {
  const W = (userId) => ({ userId, canWrite: true });
  const own = { status: 'soumis', kind: 'financier', createdBy: 'a', editedBy: 'a', submittedBy: 'a' };
  // Son propre rapport soumis : ni modifier, ni décider (avec la raison à afficher).
  const mine = reportActions(own, W('a'));
  assert.equal(mine.decide, false);
  assert.equal(mine.edit, false);
  assert.match(mine.decideReason, /Séparation des tâches/);
  assert.match(mine.editReason, /figé/);
  // Le rapport d'un autre : décider oui, modifier non (figé).
  const other = reportActions(own, W('v'));
  assert.equal(other.decide, true);
  assert.equal(other.decideReason, null);
  assert.equal(other.edit, false);
  // Lecteur (sans droit d'écriture) : aucune action, aucune raison affichée.
  const ro = reportActions(own, { userId: 'v', canWrite: false });
  assert.deepEqual(Object.values(ro).filter(Boolean), []);
  // Gabarit vierge : modifier et soumettre (la règle « facture vide » s'applique à la soumission réelle).
  const stub = reportActions({ status: 'attendu', kind: 'financier', createdBy: 'g', editedBy: null }, W('u'));
  assert.equal(stub.edit, true); assert.equal(stub.submit, true); assert.equal(stub.decide, false);
  // Rapport technique : jamais d'état des dépenses à modifier, mais resoumission par son auteur.
  const tech = { status: 'rejete', kind: 'technique', createdBy: 'a', editedBy: 'a', submittedBy: 'a' };
  assert.equal(reportActions(tech, W('a')).edit, false);
  assert.equal(reportActions(tech, W('a')).editReason, null);
  assert.equal(reportActions(tech, W('a')).submit, true);
  assert.equal(reportActions(tech, W('v')).submit, false);
  // Validé : rien, sauf la consultation.
  const done = reportActions({ ...own, status: 'valide', decidedBy: 'v' }, W('v'));
  assert.deepEqual([done.edit, done.submit, done.decide, done.notApplicable, done.remove], [false, false, false, false, false]);
  // Suppression d'un validé (retour 56) : l'administrateur seulement, et sans montant compté.
  const adminW = { userId: 'x', canWrite: true, isAdmin: true };
  assert.equal(reportActions({ ...own, status: 'valide', reportedAmount: 125000 }, adminW).remove, false);
  assert.equal(reportActions({ ...own, status: 'valide', reportedAmount: 0 }, adminW).remove, true);
  assert.equal(reportActions({ ...own, status: 'valide', reportedAmount: 0 }, W('x')).remove, false);
  assert.equal(reportActions({ ...own, status: 'valide', reportedAmount: 0 }, { ...adminW, canWrite: false }).remove, false);
});

// La base impose les mêmes règles (migration 058) : la liste des transitions et
// des statuts « brouillon » du SQL doit rester celle du module pur.
test('migration 058 : transitions et statuts modifiables identiques à reportWorkflow', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/058_report_duty_separation.sql'), 'utf8');
  const block = sql.slice(sql.indexOf('NOT IN ('), sql.indexOf(') THEN', sql.indexOf('NOT IN (')));
  const pairs = [...block.matchAll(/\('(\w+)', '(\w+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
  const expected = STATUSES.flatMap((from) => TRANSITIONS[from].filter((to) => to !== from).map((to) => `${from}>${to}`)).sort();
  assert.deepEqual(pairs, expected);
  const editable = [...sql.matchAll(/-- editable: reportWorkflow\.EDITABLE\n[^\n]*NOT IN \(([^)]*)\)/g)]
    .map((m) => m[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort());
  assert.equal(editable.length, 2, 'les deux gardes (rapport et postes) déclarent les statuts modifiables');
  for (const e of editable) assert.deepEqual(e, [...EDITABLE].sort());
});

test('machine d\'états : exactement les transitions autorisées', () => {
  const allowed = new Set([
    'attendu>soumis', 'attendu>non_applicable',
    'rejete>soumis', 'rejete>non_applicable',
    'soumis>valide', 'soumis>rejete', 'soumis>non_applicable',
    'non_applicable>non_applicable',
  ]);
  assert.deepEqual([...STATUSES].sort(), ['attendu', 'non_applicable', 'rejete', 'soumis', 'valide']);
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      assert.equal(canTransition(from, to), allowed.has(`${from}>${to}`), `${from} → ${to}`);
    }
  }
  assert.deepEqual(TRANSITIONS.valide, [], 'un rapport validé est définitif');
  assert.equal(canTransition('attendu', 'valide'), false, 'attendu → validé refusé');
  assert.equal(canTransition('inconnu', 'soumis'), false);
  assert.equal(canTransition('toString', 'soumis'), false, 'pas de clé héritée');
  assert.deepEqual([...SUBMITTABLE].sort(), ['attendu', 'rejete']);
});

test('soumettre : attendu ou rejeté seulement', () => {
  const fin = { kind: 'financier', itemCount: 2, reportedAmount: 0 };
  assert.equal(submitError({ ...fin, status: 'attendu' }, 'u1'), null);
  assert.equal(submitError({ ...fin, status: 'rejete' }, 'u1'), null);
  for (const status of ['soumis', 'valide', 'non_applicable']) {
    const err = submitError({ ...fin, status }, 'u1');
    assert.equal(err.code, 'status', status);
  }
  assert.match(submitError({ ...fin, status: 'soumis' }).message, /déjà soumis/);
  assert.match(submitError({ ...fin, status: 'valide' }).message, /validé/);
});

test('soumettre une facture exige un état des dépenses ou un montant', () => {
  // Gabarit « attendu » généré (montant 0, aucun poste) : refusé.
  const stub = submitError({ status: 'attendu', kind: 'financier', itemCount: 0, reportedAmount: 0 });
  assert.equal(stub.code, 'empty');
  assert.match(stub.message, /état des dépenses/);
  assert.equal(submitError({ status: 'attendu', kind: 'financier', itemCount: 0, reportedAmount: null }).code, 'empty');
  // Au moins un poste (même entièrement à la charge de l'ONG) : accepté.
  assert.equal(submitError({ status: 'attendu', kind: 'financier', itemCount: 1, reportedAmount: 0 }), null);
  // Montant justifié sans poste (rapport saisi au montant) : accepté.
  assert.equal(submitError({ status: 'rejete', kind: 'financier', itemCount: 0, reportedAmount: 150000 }), null);
  // Un rapport technique n'a pas d'état des dépenses.
  assert.equal(submitError({ status: 'rejete', kind: 'technique', itemCount: 0, reportedAmount: null }), null);
});

test('non applicable : tout statut sauf validé (comportement inchangé)', () => {
  for (const status of ['attendu', 'soumis', 'rejete', 'non_applicable']) {
    assert.equal(notApplicableError({ status }), null, status);
  }
  assert.equal(notApplicableError({ status: 'valide' }).code, 'locked');
});

test('rôles d\'écriture des rapports : UNE liste, partagée par les routes et le Centre d\'alertes', () => {
  const { REPORT_WRITE_ROLES, canWriteReports } = require('../src/modules/tpm/reportWorkflow');
  assert.deepEqual([...REPORT_WRITE_ROLES], ['admin', 'manager']);
  assert.ok(Object.isFrozen(REPORT_WRITE_ROLES));
  assert.equal(canWriteReports('admin'), true);
  assert.equal(canWriteReports('manager'), true);
  assert.equal(canWriteReports('viewer'), false);
  assert.equal(canWriteReports(undefined), false);
  // Aucune copie locale de la liste : les deux modules lisent la constante partagée.
  for (const file of ['tpm/reports.routes.js', 'dashboards/alerts.service.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../src/modules', file), 'utf8');
    assert.doesNotMatch(src, /\[\s*'admin'\s*,\s*'manager'\s*\]/, `${file} : liste de rôles dupliquée`);
    assert.match(src, /REPORT_WRITE_ROLES|canWriteReports/, file);
  }
});
