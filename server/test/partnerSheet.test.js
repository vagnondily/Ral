const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFacts, mergeZones, shapeTimeline } = require('../src/modules/partners/partnerSheet');

test('faits : consommation sur la ligne de suivi, visites du mois ; non mesurable plutôt que 0', () => {
  const f = buildFacts({
    contract: { id: 'c', numero: 'CTR-1', dateFin: '2026-12-31', budget: 2000000, actual: 500000, pending: 100000 },
    month: '2026-10', visitsAssigned: 8, visitsRealised: 6, agentsActive: 4, agentsTotal: 5, invoicesPending: 1, sitesFollowed: 30,
  });
  assert.equal(f.contract.consumption, 25);
  assert.equal(f.visits.rate, 75);
  assert.equal(f.submissions.status, 'non_mesurable');
  assert.equal(f.agentScore.status, 'non_mesurable');
  const none = buildFacts({ contract: null, visitsAssigned: 0, visitsRealised: 0 });
  assert.equal(none.contract.status, 'aucun');
  assert.equal(none.visits.rate, null); // jamais « 0 % » quand rien n'est affecté
});

test('zones : contrats + districts des visites, sans doublon de graphie', () => {
  const z = mergeZones(['Androy > Bekily', 'Anosy > Amboasary-Atsimo'],
    [{ region: 'Androy', district: 'Bekily' }, { region: 'Anosy', district: 'Amboasary Sud' }, { region: 'Androy', district: 'Beloha' }]);
  assert.deepEqual(z.map((x) => [x.path, x.source]), [
    ['Androy > Bekily', 'contrat'], ['Androy > Beloha', 'visites'], ['Anosy > Amboasary-Atsimo', 'contrat'],
  ]);
});

test('frise : du plus récent au plus ancien, ordre stable à date égale, bornée avec curseur', () => {
  const rows = [
    { at: '2026-03-01T00:00:00Z', kind: 'terrain', code: 'debut', label: 'Bekily', extra: '12' },
    { at: '2026-05-10T08:00:00Z', kind: 'facture', code: 'valide', extra: '04/2026', ref: 'r1' },
    { at: '2026-05-10T08:00:00Z', kind: 'contrat', code: 'avenant_approuve', label: 'CTR-1', ref: 'c1' },
    { at: null, kind: 'formation', code: 'formation' },
  ];
  const t = shapeTimeline(rows, { limit: 2 });
  assert.deepEqual(t.items.map((i) => i.kind), ['contrat', 'facture']);
  assert.equal(t.items[0].message.text, 'Avenant approuvé sur le contrat {label}');
  assert.deepEqual(t.items[1].message.params, { label: '', extra: '04/2026' });
  assert.equal(t.next, '2026-05-10T08:00:00.000Z');
  assert.equal(shapeTimeline(rows, { limit: 50 }).next, null);
});

test('frise : à date égale, l\'étape la plus avancée d\'abord', () => {
  const at = '2026-03-01T00:00:00Z';
  const t = shapeTimeline([
    { at, kind: 'contrat', code: 'creation', label: 'C' }, { at, kind: 'contrat', code: 'approbation', label: 'C' },
    { at, kind: 'contrat', code: 'soumission', label: 'C' },
  ]);
  assert.deepEqual(t.items.map((i) => i.message.text.split(' ').pop()), ['validé', 'validation', 'créé']);
});
