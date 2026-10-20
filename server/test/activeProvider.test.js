const test = require('node:test');
const assert = require('node:assert/strict');
const {
  coverageOf, contractCoversMonth, activeProviders, selectableProviders, providerStatus, monthsOf,
} = require('../src/modules/tpm/activeProvider');
const { contractCoversMonthSql, providerContractsCte, providerActiveSql } = require('../src/modules/tpm/activeProviderSql');

const C = (o) => ({
  contractId: 'c1', numero: 'CTR-1', status: 'actif', dateDebut: '2026-03-15', dateFin: '2026-11-30',
  terminationDate: null, monitoring: true, partnerId: 'p1', via: ['titulaire'], ...o,
});

test('un contrat actif couvre les mois de son début à sa fin, mois entamés compris', () => {
  const c = C();
  assert.equal(contractCoversMonth(c, '2026-02'), false);
  assert.equal(contractCoversMonth(c, '2026-03'), true, 'commencé le 15 : le mois compte');
  assert.equal(contractCoversMonth(c, '2026-11'), true);
  assert.equal(contractCoversMonth(c, '2026-12'), false, 'échu : ne couvre plus, même encore « actif »');
  assert.deepEqual(coverageOf(c), { from: '2026-03', to: '2026-11' });
});

test('un contrat résilié couvre jusqu\'au mois de la résiliation ; brouillon, en validation, rejeté jamais', () => {
  const r = C({ status: 'resilie', terminationDate: '2026-06-10' });
  assert.equal(contractCoversMonth(r, '2026-06'), true);
  assert.equal(contractCoversMonth(r, '2026-07'), false);
  for (const status of ['brouillon', 'en_validation', 'rejete']) {
    assert.equal(contractCoversMonth(C({ status }), '2026-05'), false, status);
  }
  assert.equal(contractCoversMonth(C({ status: 'resilie', terminationDate: null }), '2026-05'), false, 'résiliation sans date');
  assert.equal(contractCoversMonth(C(), '2026-5'), false, 'mois mal formé');
});

const partners = [
  { id: 'p1', name: 'YPA', typeCode: 'tpm', active: true },
  { id: 'p2', name: 'Association Aina', typeCode: 'prestataire', active: true },
  { id: 'p3', name: 'RANO', typeCode: 'tpm', active: true },
  { id: 'p4', name: 'Ancien TPM', typeCode: 'tpm', active: false },
];

test('actif au mois M : contrat de SUIVI couvrant M, fiche active ; rattachement par facture compris', () => {
  const links = [
    C({ partnerId: 'p1', via: ['rapport'] }),                                    // TPM qui facture sur le contrat d'un autre
    C({ partnerId: 'p2', via: ['titulaire'] }),
    C({ partnerId: 'p3', contractId: 'c2', numero: 'CTR-2', monitoring: false }), // pas de ligne IV.suivi
    C({ partnerId: 'p4', contractId: 'c3', numero: 'CTR-3' }),                   // fiche désactivée
  ];
  const act = activeProviders({ links, partners, month: '2026-05' });
  assert.deepEqual(act.map((p) => p.id), ['p2', 'p1'], 'tri par nom ; sans contrat de suivi ni fiche inactive');
  assert.deepEqual(act[1].contracts[0], { id: 'c1', numero: 'CTR-1', numeroFla: null, status: 'actif', via: ['rapport'], from: '2026-03', to: '2026-11' });
  assert.deepEqual(activeProviders({ links, partners, month: '2026-12' }), []);
});

test('sélectionnables : groupe « contrat » avec ses mois, puis les autres TPM actifs à part', () => {
  const links = [
    C({ partnerId: 'p1', dateDebut: '2026-01-01', dateFin: '2026-04-30' }),
    C({ partnerId: 'p1', contractId: 'c9', numero: 'CTR-9', dateDebut: '2026-04-01', dateFin: '2026-06-30', via: ['plan', 'titulaire'] }),
  ];
  const s = selectableProviders({ links, partners, months: ['2026-05', '2026-03', '2026-03', 'x'] });
  assert.deepEqual(s.months, ['2026-03', '2026-05']);
  const [contrat, tpm] = s.groups;
  assert.equal(contrat.key, 'contrat');
  assert.deepEqual(contrat.providers.map((p) => [p.id, p.months, p.contracts.map((c) => c.numero)]), [
    ['p1', ['2026-03', '2026-05'], ['CTR-1', 'CTR-9']],
  ]);
  assert.deepEqual(contrat.providers[0].contracts[1].via, ['titulaire', 'plan'], 'origines dans un ordre fixe');
  assert.deepEqual(tpm.providers.map((p) => p.id), ['p3'], 'RANO : TPM actif sans contrat ; Aina n\'est pas TPM ; l\'ancien TPM est désactivé');
});

test('statut d\'un prestataire : actif (avec fin proche), à venir, échu, aucun', () => {
  const now = '2026-10-14';
  const a = providerStatus([C({ dateFin: '2026-11-30' })], now);
  assert.equal(a.state, 'actif');
  assert.equal(a.from, '2026-03-15');
  assert.equal(a.to, '2026-11-30');
  assert.equal(a.endingSoon, true);
  assert.equal(a.daysLeft, 47);
  assert.equal(providerStatus([C({ dateDebut: '2026-01-01', dateFin: '2027-12-31' })], now).endingSoon, false);
  const soon = providerStatus([C({ dateDebut: '2027-01-01', dateFin: '2027-12-31' })], now);
  assert.deepEqual([soon.state, soon.from], ['a_venir', '2027-01-01']);
  const old = providerStatus([C({ dateDebut: '2025-01-01', dateFin: '2025-12-31' }), C({ contractId: 'c2', dateDebut: '2024-01-01', dateFin: '2024-06-30' })], now);
  assert.deepEqual([old.state, old.to], ['echu', '2025-12-31']);
  assert.equal(providerStatus([C({ monitoring: false })], now).state, 'aucun');
  assert.equal(providerStatus([], now).state, 'aucun');
});

test('mois d\'une plage, bornés', () => {
  assert.deepEqual(monthsOf('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(monthsOf('2026-02', '2025-11'), []);
  assert.equal(monthsOf('2020-01', '2030-01', 60).length, 60);
});

test('jumelle SQL : mêmes statuts et mêmes bornes que la règle pure ; tenant en $1 partout', () => {
  const sql = contractCoversMonthSql('c', '$3::date');
  assert.match(sql, /c\.status = 'actif' AND date_trunc\('month', c\.date_debut\) <= \$3::date AND \$3::date <= date_trunc\('month', c\.date_fin\)/);
  assert.match(sql, /c\.status = 'resilie' AND c\.termination_date IS NOT NULL/);
  assert.match(sql, /\$3::date <= date_trunc\('month', c\.termination_date\)/);
  assert.doesNotMatch(sql, /brouillon|en_validation|rejete/);
  const cte = providerContractsCte();
  for (const t of ['contracts c', 'tpm_collection_plans pl', 'tpm_reports r', 'site_visits v']) assert.match(cte, new RegExp(`${t}\\s+WHERE [a-z]+\\.tenant_id = \\$1`));
  for (const via of ['titulaire', 'plan', 'rapport', 'visite']) assert.match(cte, new RegExp(`'${via}'`));
  assert.match(providerActiveSql('p.id', '$3::date', '$2'), /line_code = \$2/);
});

test('listes de choix d\'un TPM (décision D1, retour 115) : jamais un titulaire partenaire de mise en œuvre', () => {
  const links = [
    C({ partnerId: 'p2', via: ['titulaire'] }),                                       // AINA, titulaire de c1
    C({ partnerId: 'p1', via: ['rapport'] }),                                         // YPA facture sur c1 → TPM de c1
    C({ partnerId: 'p2', contractId: 'c5', numero: 'CTR-5', via: ['titulaire'] }),    // AINA, titulaire de c5 sans TPM rattaché
    C({ partnerId: 'p3', contractId: 'c5', numero: 'CTR-5', via: ['visite'] }),       // une visite ne rattache pas un TPM
  ];
  const s = selectableProviders({ links, partners, months: ['2026-05'] });
  const [contrat, tpm] = s.groups;
  assert.deepEqual(contrat.providers.map((p) => [p.id, p.contracts.map((c) => c.numero)]), [['p1', ['CTR-1']]],
    'YPA pour CTR-1 ; AINA jamais, même pour CTR-5 qui n\'a aucun TPM rattaché (suivi interne)');
  assert.deepEqual(tpm.providers.map((p) => p.id), ['p3'], 'RANO (simple visite) : autres TPM, hors contrat');
  const { tpmIdsByContract, contractTpmOf } = require('../src/modules/tpm/activeProvider');
  assert.deepEqual([...tpmIdsByContract(links, partners).get('c1')], ['p1']);
  assert.deepEqual([...tpmIdsByContract(links, partners).get('c5')], [], 'CTR-5 : aucun TPM (Interne)');
  // Un TPM titulaire de son propre contrat reste son TPM.
  const ownLinks = [C({ partnerId: 'p3', contractId: 'c7', numero: 'CTR-7', via: ['titulaire'] })];
  assert.deepEqual([...tpmIdsByContract(ownLinks, partners).get('c7')], ['p3']);
  // Affichage (retour 113) : un partenaire de mise en œuvre n'est jamais montré comme TPM.
  assert.deepEqual(contractTpmOf([], partners[1]), { state: 'aucun', tpms: [] });
  assert.deepEqual(contractTpmOf([], partners[0]), { state: 'titulaire', tpms: [{ id: 'p1', name: 'YPA' }] });
});

test('TPM proposé par les formulaires plan / facture (contractTpms) : décision D1, jamais un titulaire non TPM', () => {
  const { pickerContractTpms } = require('../src/modules/tpm/activeProvider');
  const contracts = [
    { id: 'c1', partnerId: 'p2', monitoring: true, tpms: [{ id: 'p1', name: 'YPA' }] }, // AINA, suivi par YPA
    { id: 'c2', partnerId: 'p2', monitoring: true, tpms: [] },                          // AINA, sans TPM rattaché
    { id: 'c3', partnerId: 'p3', monitoring: true, tpms: [] },                          // RANO titulaire de son contrat
    { id: 'c4', partnerId: 'p4', monitoring: true, tpms: [] },                          // ancien TPM désactivé
    { id: 'c5', partnerId: 'p2', monitoring: false, tpms: [] },                         // pas un contrat de suivi
  ];
  assert.deepEqual(pickerContractTpms(contracts, partners), {
    c1: [{ id: 'p1', name: 'YPA' }], c2: [], c3: [{ id: 'p3', name: 'RANO' }], c4: [],
  });
});
