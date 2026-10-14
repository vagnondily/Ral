const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DOCUMENT_TYPES,
  VALIDATED_STATUSES,
  isValidatedStatus,
  cleanJustification,
  decideDocumentDeletion,
  refusalMessage,
  refusalStatus,
  refusalDetails,
  linkedSummary,
  linkedText,
  MAX_JUSTIFICATION,
  MIN_JUSTIFICATION,
} = require('../src/modules/common/deletionPolicy');

const ADMIN = { isAdmin: true };

test('types de documents couverts (concepteur exclu, aligné avec le lot 7a)', () => {
  assert.deepEqual([...DOCUMENT_TYPES].sort(),
    ['collection_plan', 'contract', 'contract_amendment', 'tpm_report']);
  assert.equal(DOCUMENT_TYPES.includes('report_document'), false);
});

test('statuts « validé » par type — source unique', () => {
  assert.deepEqual(VALIDATED_STATUSES.tpm_report, ['valide']);
  assert.deepEqual(VALIDATED_STATUSES.collection_plan, ['valide']);
  assert.deepEqual(VALIDATED_STATUSES.contract, ['actif', 'resilie']);
  assert.deepEqual(VALIDATED_STATUSES.contract_amendment, ['approuve']);
});

test('isValidatedStatus : rapport TPM', () => {
  assert.equal(isValidatedStatus('tpm_report', 'valide'), true);
  for (const s of ['attendu', 'soumis', 'rejete', 'non_applicable']) {
    assert.equal(isValidatedStatus('tpm_report', s), false, s);
  }
});

test('isValidatedStatus : contrat (brouillon, soumis, rejeté = non validé)', () => {
  assert.equal(isValidatedStatus('contract', 'actif'), true);
  assert.equal(isValidatedStatus('contract', 'resilie'), true);
  for (const s of ['brouillon', 'en_validation', 'rejete']) {
    assert.equal(isValidatedStatus('contract', s), false, s);
  }
});

test('isValidatedStatus : type inconnu → erreur', () => {
  assert.throws(() => isValidatedStatus('report_document', 'valide'), /type de document inconnu/);
});

test('cleanJustification : trim + borne de longueur', () => {
  assert.equal(cleanJustification('  motif  '), 'motif');
  assert.equal(cleanJustification(undefined), '');
  assert.equal(cleanJustification(42), '');
  assert.equal(cleanJustification('x'.repeat(MAX_JUSTIFICATION + 50)).length, MAX_JUSTIFICATION);
  // Compté en caractères (comme length() en SQL) : un emoji n'est jamais coupé en deux.
  const cut = cleanJustification('😀'.repeat(MAX_JUSTIFICATION + 5));
  assert.equal([...cut].length, MAX_JUSTIFICATION);
  assert.equal(cut.endsWith('😀'), true);
});

test('non validé → supprimable sans justificatif, quel que soit le reste', () => {
  const d = decideDocumentDeletion({ validated: false });
  assert.equal(d.allowed, true);
  assert.equal(d.requireJustification, false);
  assert.equal(d.reason, null);

  // La donnée reliée ne s'applique pas à un non-validé.
  const d2 = decideDocumentDeletion({ validated: false, hasLinkedData: true });
  assert.equal(d2.allowed, true);
  assert.equal(d2.reason, null);
});

test('validé + donnée reliée → refus (409), même avec justificatif et administrateur', () => {
  const d = decideDocumentDeletion({ validated: true, hasLinkedData: true, justification: 'erreur de saisie', ...ADMIN });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'linked_data');
});

test('documents dépendants → refus quel que soit le statut', () => {
  for (const validated of [false, true]) {
    const d = decideDocumentDeletion({ validated, dependents: true, justification: 'doublon créé par erreur', ...ADMIN });
    assert.equal(d.allowed, false, String(validated));
    assert.equal(d.reason, 'linked_data');
  }
});

test('validé sans donnée reliée : réservé à l\'administrateur (403)', () => {
  const d = decideDocumentDeletion({ validated: true, justification: 'doublon créé par erreur' });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'admin_required');
  assert.equal(decideDocumentDeletion({ validated: true, isAdmin: false, justification: 'doublon créé par erreur' }).reason, 'admin_required');
  // Un document non validé reste supprimable par tout rédacteur.
  assert.equal(decideDocumentDeletion({ validated: false }).allowed, true);
});

test('validé sans donnée reliée mais sans justificatif → refus (400)', () => {
  const d = decideDocumentDeletion({ validated: true, hasLinkedData: false, ...ADMIN });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'justification_required');
  assert.equal(d.requireJustification, true);

  // Justificatif vide ou blancs = absent.
  assert.equal(decideDocumentDeletion({ validated: true, justification: '   ', ...ADMIN }).reason, 'justification_required');
});

test(`justificatif d'au moins ${MIN_JUSTIFICATION} caractères, comptés après nettoyage`, () => {
  assert.equal(MIN_JUSTIFICATION, 10);
  const at = (j) => decideDocumentDeletion({ validated: true, justification: j, ...ADMIN });
  assert.equal(at('doublon').reason, 'justification_required');
  assert.equal(at('   123456789   ').reason, 'justification_required'); // 9 après nettoyage
  assert.equal(at('1234567890').allowed, true);
  // Caractères Unicode, comme le CHECK SQL (migration 068) : 9 lettres + 1 emoji = 10.
  assert.equal(at('erreur ab😀').allowed, true);
  assert.equal(at('erreur a😀').reason, 'justification_required');
});

test('validé sans donnée reliée + justificatif → autorisé, justificatif nettoyé', () => {
  const d = decideDocumentDeletion({ validated: true, hasLinkedData: false, justification: '  doublon créé par erreur  ', ...ADMIN });
  assert.equal(d.allowed, true);
  assert.equal(d.requireJustification, true);
  assert.equal(d.reason, null);
  assert.equal(d.justification, 'doublon créé par erreur');
});

test('decideDocumentDeletion sans argument ne jette pas (défauts sûrs)', () => {
  const d = decideDocumentDeletion();
  assert.equal(d.allowed, true); // validated indéfini = falsy = non validé
});

test('messages de refus lisibles', () => {
  assert.match(refusalMessage('linked_data'), /données reliées/);
  assert.match(refusalMessage('justification_required'), /au moins 10 caractères est obligatoire/);
  assert.match(refusalMessage('admin_required'), /administrateur/);
  assert.match(refusalMessage('autre'), /refus/i);
});

test('données reliées nommées et comptées', () => {
  const linked = linkedSummary({ reports: 2, plans: 1, visits: 0, renewals: 1, inconnu: 4, amendments: -3 });
  assert.deepEqual(linked, [
    { key: 'reports', count: 2, label: 'rapports' },
    { key: 'plans', count: 1, label: 'plan de collecte' },
    { key: 'renewals', count: 1, label: 'renouvellement' },
  ]);
  assert.equal(linkedText(linked), '2 rapports, 1 plan de collecte, 1 renouvellement');
  assert.equal(linkedText(linkedSummary({ items: 3, booked: 1 })), '3 postes de dépense, montant compté dans la consolidation');
  assert.deepEqual(linkedSummary({}), []);
  assert.deepEqual(linkedSummary(undefined), []);
  const msg = refusalMessage('linked_data', { subject: 'ce contrat', linked, hint: 'Résiliez-le plutôt.' });
  assert.equal(msg, 'Ce contrat porte des données reliées (2 rapports, 1 plan de collecte, 1 renouvellement) : suppression impossible. Résiliez-le plutôt.');
});

test('code de refus → statut HTTP et détails', () => {
  assert.equal(refusalStatus('linked_data'), 409);
  assert.equal(refusalStatus('admin_required'), 403);
  assert.equal(refusalStatus('justification_required'), 400);
  assert.deepEqual(refusalDetails('justification_required'), { reason: 'justification_required', min: 10 });
  assert.deepEqual(refusalDetails('linked_data', [{ key: 'plans', count: 1, label: 'plan de collecte' }]),
    { reason: 'linked_data', linked: [{ key: 'plans', count: 1, label: 'plan de collecte' }] });
});
