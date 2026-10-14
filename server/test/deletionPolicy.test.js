const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DOCUMENT_TYPES,
  VALIDATED_STATUSES,
  isValidatedStatus,
  cleanJustification,
  decideDocumentDeletion,
  refusalMessage,
  MAX_JUSTIFICATION,
} = require('../src/modules/common/deletionPolicy');

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

test('validé + donnée reliée → refus (409), même avec justificatif', () => {
  const d = decideDocumentDeletion({ validated: true, hasLinkedData: true, justification: 'erreur de saisie' });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'linked_data');
});

test('validé sans donnée reliée mais sans justificatif → refus (400)', () => {
  const d = decideDocumentDeletion({ validated: true, hasLinkedData: false });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'justification_required');
  assert.equal(d.requireJustification, true);

  // Justificatif vide ou blancs = absent.
  assert.equal(decideDocumentDeletion({ validated: true, justification: '   ' }).reason, 'justification_required');
});

test('validé sans donnée reliée + justificatif → autorisé, justificatif nettoyé', () => {
  const d = decideDocumentDeletion({ validated: true, hasLinkedData: false, justification: '  doublon créé par erreur  ' });
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
  assert.match(refusalMessage('justification_required'), /justificatif est obligatoire/);
  assert.match(refusalMessage('autre'), /refus/i);
});
