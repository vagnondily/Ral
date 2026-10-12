const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TRANSITIONS, STATUSES, SUBMITTABLE, canTransition, submitError, decisionError, notApplicableError,
} = require('../src/modules/tpm/reportWorkflow');

test('décision sur un rapport : seul un rapport soumis, jamais par son auteur', () => {
  assert.equal(decisionError({ status: 'soumis', createdBy: 'u1' }, 'u2'), null);
  for (const status of ['attendu', 'valide', 'rejete', 'non_applicable']) {
    assert.equal(decisionError({ status, createdBy: 'u1' }, 'u2').code, 'status', status);
  }
  const self = decisionError({ status: 'soumis', createdBy: 'u1' }, 'u1');
  assert.equal(self.code, 'self'); assert.match(self.message, /Séparation des tâches/);
});

test('séparation des tâches : c\'est le SOUMETTEUR qui ne décide pas (gabarit créé par un autre)', () => {
  // Gabarit mensuel généré par u1, rempli et soumis par u2.
  const report = { status: 'soumis', createdBy: 'u1', submittedBy: 'u2' };
  assert.equal(decisionError(report, 'u2').code, 'self', 'le soumetteur ne valide pas');
  assert.equal(decisionError(report, 'u1'), null, "l'auteur du gabarit, qui n'a pas soumis, peut décider");
  assert.equal(decisionError(report, 'u3'), null);
  // Soumetteur inconnu (données antérieures) : l'auteur est tenu pour soumetteur.
  assert.equal(decisionError({ status: 'soumis', createdBy: 'u1', submittedBy: null }, 'u1').code, 'self');
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
  assert.equal(submitError({ ...fin, status: 'attendu' }), null);
  assert.equal(submitError({ ...fin, status: 'rejete' }), null);
  for (const status of ['soumis', 'valide', 'non_applicable']) {
    const err = submitError({ ...fin, status });
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
