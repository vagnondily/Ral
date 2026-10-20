const test = require('node:test');
const assert = require('node:assert/strict');
const a = require('../src/modules/tpm/tpmAttribution');

// Découpage : Androy (r1) > Bekily (d1) > commune C1 (c1) > fokontany F1 (f1) ; Androy > Beloha (d2) ;
// Anosy (r2) > Amboasary (d3).
const R1 = { id: 'r1', depth: 1, name: 'Androy', lineage: [] };
const D1 = { id: 'd1', depth: 2, name: 'Bekily', path: 'Androy > Bekily', lineage: ['r1'] };
const D2 = { id: 'd2', depth: 2, name: 'Beloha', path: 'Androy > Beloha', lineage: ['r1'] };
const D3 = { id: 'd3', depth: 2, name: 'Amboasary', path: 'Anosy > Amboasary', lineage: ['r2'] };
const C1 = { id: 'c1', depth: 3, name: 'C1', path: 'Androy > Bekily > C1', lineage: ['r1', 'd1'] };
const zone = (area) => ({ adminAreaId: area.id, depth: area.depth, path: area.path || area.name, lineage: area.lineage });
const DETACHED = { adminAreaId: null, depth: 2, path: 'Androy > Ambovombe', lineage: [] };
const F1 = { adminAreaId: 'f1', depth: 4, path: 'Androy > Bekily > C1 > F1', lineage: ['r1', 'd1', 'c1'] };

const partners = [
  { id: 'aina', name: 'ASSOCIATION AINA', typeCode: 'prestataire', active: true },
  { id: 'tohana', name: 'TOHANA', typeCode: 'prestataire', active: true },
  { id: 'rano', name: 'RANO Control', typeCode: 'tpm', active: true },
  { id: 'sahy', name: 'SAHY Monitoring', typeCode: 'tpm', active: true },
  { id: 'ypa', name: 'YPA', typeCode: 'tpm', active: true },
  { id: 'old', name: 'OLD TPM', typeCode: 'tpm', active: false },
];
const contract = (over) => ({
  id: 'k', numero: 'CTR-X', status: 'actif', partnerId: 'aina', partnerName: 'ASSOCIATION AINA',
  dateDebut: '2025-10-01', dateFin: '2026-09-30', terminationDate: null, monitoring: true, zones: [], ...over,
});
const AINA = contract({ id: 'k1', numero: 'CTR-2026-0001', zones: [zone(D1), zone(D2), DETACHED] });
const TOHANA = contract({ id: 'k2', numero: 'CTR-2026-0002', partnerId: 'tohana', partnerName: 'TOHANA', dateDebut: '2026-03-15', dateFin: '2026-11-30', zones: [zone(D3)] });

test('couverture : actif de mois(début) à mois(fin) ; mois entamé ; dates seules', () => {
  assert.equal(a.contractCoversMonth(TOHANA, '2026-03'), true); // début le 15 : le mois compte
  assert.equal(a.contractCoversMonth(TOHANA, '2026-02'), false);
  assert.equal(a.contractCoversMonth(TOHANA, '2026-11'), true);
  assert.equal(a.contractCoversMonth(TOHANA, '2026-12'), false);
  // CTR-0001 échu le 30/09/2026 mais encore « actif » : ne couvre pas octobre.
  assert.equal(a.contractCoversMonth(AINA, '2026-09'), true);
  assert.equal(a.contractCoversMonth(AINA, '2026-10'), false);
});

test('couverture : résilié jusqu au mois de résiliation inclus ; brouillon, en validation, rejeté jamais', () => {
  const r = contract({ status: 'resilie', terminationDate: '2026-04-10' });
  assert.equal(a.contractCoversMonth(r, '2026-04'), true);
  assert.equal(a.contractCoversMonth(r, '2026-05'), false);
  for (const status of ['brouillon', 'en_validation', 'rejete']) {
    assert.equal(a.contractCoversMonth(contract({ status }), '2026-01'), false, status);
  }
});

test('contrat sans budget de suivi ou sans titulaire : exclu (et signalé)', () => {
  const noBudget = contract({ monitoring: false, zones: [zone(D1)] });
  assert.equal(a.defaultFor(D1, '2026-01', [noBudget]).state, 'sans_contrat');
  const noHolder = contract({ partnerId: null, zones: [zone(D1)] });
  assert.equal(a.defaultFor(D1, '2026-01', [noHolder]).state, 'sans_contrat');
  const q = a.qualityOf({ contracts: [noHolder], partners, months: ['2026-01'] });
  assert.deepEqual(q.contractsWithoutHolder, [{ contractId: 'k', numero: 'CTR-X' }]);
});

test('D1 = hypothèse A : le TPM d un contrat est son titulaire', () => {
  assert.equal(a.contractTpm(AINA), 'aina');
  const d = a.defaultFor(D1, '2026-01', [AINA, TOHANA]);
  assert.equal(d.state, 'contrat');
  assert.equal(d.providerId, 'aina');
  assert.equal(d.contractId, 'k1');
  assert.equal(d.numero, 'CTR-2026-0001');
  assert.equal(d.exactHit, true);
});

test('zones : région qui couvre ses districts ; commune de contrat ; zone détachée ; fokontany', () => {
  const region = contract({ id: 'kr', numero: 'CTR-R', partnerId: 'rano', partnerName: 'RANO', zones: [zone(R1)] });
  const d = a.defaultFor(D2, '2026-01', [region]);
  assert.equal(d.state, 'contrat');
  assert.equal(d.candidates[0].via, 'parent');
  // Commune de contrat : le district est « sans contrat » + partiel ; la commune est « selon contrat ».
  const communal = contract({ id: 'kc', numero: 'CTR-C', partnerId: 'sahy', partnerName: 'SAHY', zones: [zone(C1)] });
  const dd = a.defaultFor(D1, '2026-01', [communal]);
  assert.equal(dd.state, 'sans_contrat');
  assert.equal(dd.partiel, true);
  assert.equal(a.defaultFor(C1, '2026-01', [communal]).state, 'contrat');
  // Zone détachée : jamais utilisée, listée.
  assert.equal(a.coverOf(D1, DETACHED), 'detachee');
  const q = a.qualityOf({ contracts: [AINA], partners, months: ['2026-01'] });
  assert.deepEqual(q.detachedContractZones.map((z) => z.path), ['Androy > Ambovombe']);
  // Fokontany : trop fine, signalée, n'attribue rien.
  assert.equal(a.coverOf(C1, F1), 'trop_fine');
  assert.equal(a.coverOf(D1, F1), 'trop_fine');
  const fk = contract({ zones: [F1] });
  assert.equal(a.defaultFor(C1, '2026-01', [fk]).state, 'sans_contrat');
  assert.equal(a.qualityOf({ contracts: [fk], partners, months: ['2026-01'] }).tooFineZones.length, 1);
});

test('précision : un district SAHY l emporte sur une région RANO', () => {
  const region = contract({ id: 'kr', numero: 'CTR-R', partnerId: 'rano', partnerName: 'RANO', zones: [zone(R1)] });
  const district = contract({ id: 'kd', numero: 'CTR-D', partnerId: 'sahy', partnerName: 'SAHY', zones: [zone(D1)] });
  const d = a.defaultFor(D1, '2026-01', [region, district]);
  assert.equal(d.state, 'contrat');
  assert.equal(d.providerId, 'sahy');
  assert.equal(a.defaultFor(D2, '2026-01', [region, district]).providerId, 'rano');
});

test('deux titulaires de même précision : « plusieurs contrats », TPM par défaut déterministe, candidats triés', () => {
  const x = contract({ id: 'kx', numero: 'CTR-2', partnerId: 'ypa', partnerName: 'YPA', zones: [zone(D1)] });
  const y = contract({ id: 'ky', numero: 'CTR-1', partnerId: 'rano', partnerName: 'RANO', zones: [zone(D1)] });
  const d = a.defaultFor(D1, '2026-01', [x, y]);
  assert.equal(d.state, 'a_arbitrer');
  // Même date de début : le plus petit numéro (ordre binaire) — jamais un blanc, jamais un tirage.
  assert.equal(d.providerId, 'rano');
  assert.equal(d.contractId, 'ky');
  assert.deepEqual(d.candidates.map((c) => c.providerId), ['rano', 'ypa']);
  // Début le plus récent d'abord ; l'ordre d'entrée ne change rien.
  const later = contract({ id: 'kz', numero: 'CTR-9', partnerId: 'ypa', partnerName: 'YPA', dateDebut: '2026-01-01', zones: [zone(D1)] });
  assert.equal(a.defaultFor(D1, '2026-01', [later, y]).providerId, 'ypa');
  assert.equal(a.defaultFor(D1, '2026-01', [y, later]).providerId, 'ypa');
  assert.ok(a.WITH_PROVIDER.includes('a_arbitrer'));
});

test('libellé du contrat : numéro FLA s il existe, sinon numéro MEMS', () => {
  const fla = contract({ numeroFla: 'FLA-2025-0042', zones: [zone(D1)] });
  assert.equal(a.defaultFor(D1, '2026-01', [fla]).contractLabel, 'FLA-2025-0042');
  assert.equal(a.defaultFor(D1, '2026-01', [AINA]).contractLabel, 'CTR-2026-0001');
});

test('même titulaire sur deux contrats : selon contrat, contrat au début le plus récent puis plus petit numéro', () => {
  const old = contract({ id: 'ko', numero: 'CTR-0009', dateDebut: '2025-01-01', zones: [zone(D1)] });
  const renewed = contract({ id: 'kn', numero: 'CTR-0010', dateDebut: '2026-01-01', zones: [zone(D1)] });
  const d = a.defaultFor(D1, '2026-01', [old, renewed]);
  assert.equal(d.state, 'contrat');
  assert.equal(d.contractId, 'kn');
  const twin = contract({ id: 'kt', numero: 'CTR-0002', dateDebut: '2026-01-01', zones: [zone(D1)] });
  assert.equal(a.defaultFor(D1, '2026-01', [renewed, twin]).contractId, 'kt');
});

const ov = (over) => ({ id: 'o1', adminAreaId: 'd1', month: '2026-01', providerId: 'ypa', expectedState: 'contrat', expectedProviderId: 'aina', reason: 'Collecte confiée à YPA', updatedAt: '2026-10-01T00:00:00.000Z', ...over });

test('cellule : la modification l emporte ; « aucun TPM » aussi', () => {
  const def = a.defaultFor(D1, '2026-01', [AINA]);
  const c = a.resolveCell(def, ov(), { partnersById: new Map(partners.map((p) => [p.id, p])), holders: new Set(['aina']) });
  assert.equal(c.state, 'modifie');
  assert.equal(c.providerId, 'ypa');
  assert.equal(c.providerName, 'YPA');
  assert.ok(c.flags.includes('hors_contrat'));
  assert.ok(!c.flags.includes('a_confirmer'));
  const none = a.resolveCell(def, ov({ providerId: null }));
  assert.equal(none.state, 'aucun_tpm');
  assert.equal(none.providerId, null);
});

test('cellule : à confirmer quand le contrat a changé ; la modification reste appliquée', () => {
  const pm = new Map(partners.map((p) => [p.id, p]));
  // contrat → contrat d un autre titulaire
  const other = a.defaultFor(D1, '2026-01', [contract({ partnerId: 'tohana', partnerName: 'TOHANA', zones: [zone(D1)] })]);
  const c1 = a.resolveCell(other, ov(), { partnersById: pm });
  assert.ok(c1.flags.includes('a_confirmer'));
  assert.equal(c1.providerId, 'ypa');
  // contrat → sans contrat
  const c2 = a.resolveCell(a.defaultFor(D1, '2026-10', [AINA]), ov({ month: '2026-10' }), { partnersById: pm });
  assert.ok(c2.flags.includes('a_confirmer'));
  assert.equal(c2.state, 'modifie');
  // à arbitrer → contrat
  const c3 = a.resolveCell(a.defaultFor(D1, '2026-01', [AINA]), ov({ expectedState: 'a_arbitrer', expectedProviderId: null }), { partnersById: pm });
  assert.ok(c3.flags.includes('a_confirmer'));
});

test('cellule : redondante quand le contrat rejoint la modification ; contrat d un arbitrage = celui du candidat', () => {
  const ypaContract = contract({ id: 'ky', numero: 'CTR-Y', partnerId: 'ypa', partnerName: 'YPA', zones: [zone(D1)] });
  const c = a.resolveCell(a.defaultFor(D1, '2026-01', [ypaContract]), ov());
  assert.ok(c.flags.includes('redondante'));
  assert.equal(c.contractId, 'ky');
  const rano = contract({ id: 'kr', numero: 'CTR-R', partnerId: 'rano', partnerName: 'RANO', zones: [zone(D1)] });
  const arb = a.defaultFor(D1, '2026-01', [ypaContract, rano]);
  const chosen = a.resolveCell(arb, ov({ providerId: 'rano', expectedState: 'a_arbitrer', expectedProviderId: 'rano' }));
  assert.equal(chosen.state, 'modifie');
  assert.equal(chosen.contractId, 'kr');
  assert.equal(chosen.flags.includes('a_confirmer'), false);
});

const tableOf = (over = {}) => a.buildZoneTable({
  areas: [D1, D2, D3, C1], months: ['2026-01', '2026-02', '2026-03'], contracts: [AINA, TOHANA], overrides: [], partners, today: '2026-10', ...over,
});

test('table : cellules, commune sans ligne propre, qualité (contrat échu encore actif, titulaires non TPM)', () => {
  const t = tableOf();
  assert.equal(t.cells.size, 12);
  assert.equal(t.cells.get('d1|2026-01').state, 'contrat');
  assert.equal(t.cells.get('d3|2026-01').state, 'sans_contrat');
  assert.equal(t.cells.get('d3|2026-03').providerId, 'tohana');
  assert.equal(t.cells.get('c1|2026-01').own, false); // C1 hérite du district (zone de contrat au district)
  assert.deepEqual(t.quality.expiredStillActive.map((c) => c.numero), ['CTR-2026-0001']);
  assert.deepEqual(t.quality.holdersNotTpm.map((h) => h.providerId), ['aina', 'tohana']);
});

test('site : commune portée avant district ; sans district → district inconnu', () => {
  const t = tableOf({ overrides: [ov({ id: 'oc', adminAreaId: 'c1', providerId: 'sahy' })] });
  assert.equal(a.cellForSite({ districtId: 'd1', communeId: 'c1' }, '2026-01', t).providerId, 'sahy');
  assert.equal(a.cellForSite({ districtId: 'd1', communeId: 'c1' }, '2026-02', t).providerId, 'aina'); // pas de modification en février
  assert.equal(a.cellForSite({ districtId: 'd1', communeId: 'c2' }, '2026-01', t).providerId, 'aina');
  assert.equal(a.cellForSite({ districtId: null, communeId: null }, '2026-01', t).state, 'district_inconnu');
});

test('segments : fusion des mois identiques ; empreinte stable et sensible', () => {
  const t = tableOf();
  const cellsD3 = ['2026-03', '2026-01', '2026-02'].map((m) => t.cells.get(`d3|${m}`));
  const s = a.segments(cellsD3);
  assert.deepEqual(s.map((x) => [x.from, x.to, x.cell.state]), [['2026-01', '2026-02', 'sans_contrat'], ['2026-03', '2026-03', 'contrat']]);
  const all = [...t.cells.values()];
  assert.equal(a.stampOf(all), a.stampOf([...all].reverse()));
  const t2 = tableOf({ overrides: [ov()] });
  assert.notEqual(a.stampOf(all), a.stampOf([...t2.cells.values()]));
});

test('zone de contrat détachée : indice « à resélectionner » sur la zone de même nom, jamais un TPM deviné', () => {
  const AMBOVOMBE = { id: 'd9', depth: 2, name: 'Ambovombe', path: 'Androy > Ambovombe', lineage: ['r1'] };
  const t = tableOf({ areas: [D1, D3, AMBOVOMBE] });
  const c = t.cells.get('d9|2026-01');
  assert.equal(c.state, 'sans_contrat');
  assert.equal(c.providerId, null, 'aucun TPM deviné');
  assert.ok(c.flags.includes('zone_a_reselectionner'));
  assert.deepEqual(c.detached, [{ contractId: 'k1', numero: 'CTR-2026-0001', contractLabel: 'CTR-2026-0001' }]);
  // Pas d'indice là où un contrat couvre, ni sur une zone d'un autre nom.
  assert.equal(t.cells.get('d1|2026-01').flags.includes('zone_a_reselectionner'), false);
  assert.equal(t.cells.get('d3|2026-01').flags.includes('zone_a_reselectionner'), false);
  // Le contrat ne couvre plus le mois : plus d'indice.
  const later = tableOf({ areas: [AMBOVOMBE], months: ['2027-06'] });
  assert.equal(later.cells.get('d9|2027-06').flags.includes('zone_a_reselectionner'), false);
  // Réimport qui renomme : « Ampanihy » (zone du contrat) ↔ « Ampanihy Ouest » (découpage), même région.
  const miaro = contract({ id: 'k5', numero: 'CTR-5', numeroFla: 'FLA-5', zones: [{ adminAreaId: null, path: 'Atsimo Andrefana > Ampanihy' }] });
  const zones = a.detachedZones([miaro], ['2026-01']);
  assert.deepEqual(a.detachedHintFor({ name: 'Ampanihy Ouest', regionName: 'Atsimo-Andrefana' }, '2026-01', zones), [{ contractId: 'k5', numero: 'CTR-5', contractLabel: 'FLA-5' }]);
  assert.deepEqual(a.detachedHintFor({ name: 'Ampanihy Ouest', regionName: 'Androy' }, '2026-01', zones), [], 'autre région');
  assert.deepEqual(a.detachedHintFor({ name: 'Ampa', regionName: 'Atsimo Andrefana' }, '2026-01', zones), [], 'préfixe trop court');
  assert.deepEqual(a.detachedHintFor({ name: 'Ampanihy Ouest' }, '2026-02', zones), [], 'mois non couvert par la plage lue');
});

test('segments : une décision sur plusieurs mois (même lot, même raison) = un seul segment ; deux raisons = deux', () => {
  const same = tableOf({ overrides: [ov({ id: 'o1', batchId: 'b1' }), ov({ id: 'o2', month: '2026-02', batchId: 'b1' })] });
  const cells = ['2026-01', '2026-02', '2026-03'].map((m) => same.cells.get(`d1|${m}`));
  assert.deepEqual(a.segments(cells).map((x) => [x.from, x.to, x.cell.state]), [['2026-01', '2026-02', 'modifie'], ['2026-03', '2026-03', 'contrat']]);
  const two = tableOf({ overrides: [ov({ id: 'o1', batchId: 'b1' }), ov({ id: 'o2', month: '2026-02', batchId: 'b2', reason: 'Autre raison, autre décision' })] });
  const cells2 = ['2026-01', '2026-02'].map((m) => two.cells.get(`d1|${m}`));
  assert.deepEqual(a.segments(cells2).map((x) => [x.from, x.to]), [['2026-01', '2026-01'], ['2026-02', '2026-02']]);
});

const targetsOf = (t, areaIds, months) => areaIds.flatMap((id) => months.map((m) => ({ areaId: id, month: m, cell: t.cells.get(`${id}|${m}`) })));

test('planOverrides : région de 3 districts × 12 mois dont un déjà RANO par contrat', () => {
  const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
  const ranoD2 = contract({ id: 'kr', numero: 'CTR-R', partnerId: 'rano', partnerName: 'RANO', dateDebut: '2026-01-01', dateFin: '2026-12-31', zones: [zone(D2)] });
  const t = a.buildZoneTable({ areas: [D1, D2, D3], months, contracts: [ranoD2], overrides: [], partners });
  const plan = a.planOverrides({ targets: targetsOf(t, ['d1', 'd2', 'd3'], months), providerId: 'rano', reason: 'Collecte confiée à RANO' });
  assert.equal(plan.upserts.length, 24);
  assert.equal(plan.counts.created, 24);
  assert.equal(plan.counts.sameAsContract, 12);
  assert.equal(plan.deletes.length, 0);
  assert.equal(plan.log.length, 24);
  const row = plan.upserts.find((u) => u.areaId === 'd1');
  assert.deepEqual([row.expectedState, row.expectedProviderId, row.expectedLabel], ['sans_contrat', null, 'Sans contrat']);
});

test('planOverrides : même TPM avec une nouvelle raison → modifier / confirmer, sans doublon', () => {
  const t = tableOf({ overrides: [ov()] });
  const p = a.planOverrides({ targets: targetsOf(t, ['d1'], ['2026-01']), providerId: 'ypa', reason: 'Nouvelle raison du bureau' });
  assert.equal(p.upserts.length, 1);
  assert.equal(p.log[0].action, 'modifier');
  const same = a.planOverrides({ targets: targetsOf(t, ['d1'], ['2026-01']), providerId: 'ypa', reason: 'Collecte confiée à YPA' });
  assert.equal(same.upserts.length, 0);
  assert.equal(same.counts.unchanged, 1);
  // Modification périmée (le contrat a changé) : la reconfirmer est « confirmer ».
  const stale = a.buildZoneTable({ areas: [D1], months: ['2026-01'], contracts: [contract({ partnerId: 'tohana', partnerName: 'TOHANA', zones: [zone(D1)] })], overrides: [ov()], partners });
  const c = a.planOverrides({ targets: targetsOf(stale, ['d1'], ['2026-01']), providerId: 'ypa', reason: 'Collecte confiée à YPA' });
  assert.equal(c.log[0].action, 'confirmer');
  assert.equal(c.upserts[0].expectedProviderId, 'tohana');
});

test('planOverrides : choisir la valeur du contrat supprime la modification ; null sur sans contrat = rien à faire', () => {
  const t = tableOf({ overrides: [ov()] });
  const p = a.planOverrides({ targets: targetsOf(t, ['d1'], ['2026-01']), providerId: 'aina', reason: null });
  assert.deepEqual(p.deletes, ['o1']);
  assert.equal(p.log[0].action, 'revenir_contrat');
  assert.equal(p.upserts.length, 0);
  const n = a.planOverrides({ targets: targetsOf(tableOf(), ['d3'], ['2026-01']), providerId: null, reason: null });
  assert.equal(n.counts.nothingToChange, 1);
  assert.equal(n.upserts.length + n.deletes.length, 0);
  const r = a.planRevert({ targets: targetsOf(t, ['d1', 'd2'], ['2026-01']) });
  assert.deepEqual(r.deletes, ['o1']);
});

/** Liens de la règle commune (lot 8) : un titulaire par contrat. */
const linksOf = (contracts) => contracts.map((c) => ({ partnerId: c.partnerId, contractId: c.id, numero: c.numero, status: c.status,
  dateDebut: c.dateDebut, dateFin: c.dateFin, terminationDate: c.terminationDate, monitoring: c.monitoring, via: ['titulaire'] }));

test('visitDecision : valeur de la zone, autre valeur, null, keep, non sélectionnable', () => {
  const t = tableOf();
  const cell = t.cells.get('d1|2026-01');
  const sel = a.selectableProviders({ links: linksOf([AINA, TOHANA]), partners, months: ['2026-01'] });
  const visit = { id: 'v1', month: '2026-01', providerId: 'rano' };
  assert.deepEqual(a.visitDecision({ visit, cell, request: { action: 'set', providerId: 'aina' }, selectable: sel }), { source: 'zone' });
  assert.deepEqual(a.visitDecision({ visit, cell, request: { action: 'zone' }, selectable: sel }), { source: 'zone' });
  assert.deepEqual(a.visitDecision({ visit, cell, request: { action: 'set', providerId: 'ypa' }, selectable: sel }), { error: 'reason_required' });
  assert.deepEqual(a.visitDecision({ visit, cell, request: { action: 'set', providerId: null, reason: 'Visite annulée par le bureau' }, selectable: sel }),
    { source: 'visite', providerId: null, reason: 'Visite annulée par le bureau' });
  assert.deepEqual(a.visitDecision({ visit, cell, request: { action: 'keep', reason: 'Saisi par le bureau, vérifié' }, selectable: sel }),
    { source: 'visite', providerId: 'rano', reason: 'Saisi par le bureau, vérifié' });
  // TOHANA ne tient aucun contrat en janvier (début en mars) et n est pas de type TPM : non sélectionnable.
  assert.deepEqual(a.visitDecision({ visit, cell, request: { action: 'set', providerId: 'tohana', reason: 'Raison valable ici' }, selectable: sel }), { error: 'provider_not_selectable' });
});

test('prestataires : la règle commune (lot 8) — actifs (contrats couvrants) puis autres TPM actifs ; inactif exclu', () => {
  const sel = a.selectableProviders({ links: linksOf([AINA, TOHANA]), partners, months: ['2026-02', '2026-03'] });
  const [contrat, tpm] = sel.groups;
  // Décision D1 (retour 115, lot 8) : un titulaire partenaire de mise en œuvre n'est jamais proposé
  // comme TPM dans une liste de choix (l'estampille des visites, elle, reste inchangée : retour 114).
  assert.deepEqual(contrat.providers.map((h) => h.id), []);
  assert.deepEqual(tpm.providers.map((p) => p.id), ['rano', 'sahy', 'ypa']);
  assert.deepEqual(a.notSelectableMonths('tohana', ['2026-02', '2026-03'], sel), ['2026-02', '2026-03']);
  // Un TPM titulaire de son propre contrat : « Actif selon contrat » sur les mois du contrat.
  const own = a.selectableProviders({ links: linksOf([{ ...TOHANA, partnerId: 'sahy', partnerName: 'SAHY Monitoring' }]), partners, months: ['2026-02', '2026-03'] });
  assert.deepEqual(own.groups[0].providers.map((h) => [h.id, h.months, h.contracts.map((c) => c.numero)]), [['sahy', ['2026-03'], ['CTR-2026-0002']]]);
  assert.deepEqual(a.notSelectableMonths('sahy', ['2026-02', '2026-03'], own), ['2026-02'], 'hors des mois de son contrat : règle inchangée');
  assert.deepEqual(a.notSelectableMonths('ypa', ['2026-02'], sel), []);
  assert.deepEqual(a.notSelectableMonths('old', ['2026-02'], sel), ['2026-02']);
  assert.deepEqual(a.activeProviders({ links: linksOf([AINA, TOHANA]), partners, month: '2026-10' }).map((p) => p.id), ['tohana']);
});

test('D1 : le TPM d un contrat est le TPM rattaché (plan, facture) ; à défaut son titulaire', () => {
  const links = [
    { partnerId: 'aina', contractId: 'k1', via: ['titulaire'] },
    { partnerId: 'rano', contractId: 'k1', via: ['plan', 'rapport'] },
    { partnerId: 'sahy', contractId: 'k1', via: ['visite'] }, // une visite découle de la règle : jamais un lien de TPM
    { partnerId: 'old', contractId: 'k1', via: ['rapport'] }, // fiche désactivée
    { partnerId: 'tohana', contractId: 'k2', via: ['plan'] }, // pas de type TPM
  ];
  const tpms = a.tpmsByContract(links, partners);
  assert.deepEqual(tpms.get('k1'), [{ id: 'rano', name: 'RANO Control' }]);
  assert.equal(tpms.has('k2'), false);
  const withTpm = { ...AINA, tpms: tpms.get('k1') };
  const d = a.defaultFor(D1, '2026-01', [withTpm]);
  assert.deepEqual([d.state, d.providerId, d.contractId], ['contrat', 'rano', 'k1']);
  assert.deepEqual(a.contractTpms(TOHANA), [{ id: 'tohana', name: 'TOHANA' }], 'sans TPM rattaché : le titulaire');
  // Deux TPM rattachés au même contrat : « plusieurs », TPM par défaut = ordre du nom.
  const two = a.defaultFor(D1, '2026-01', [{ ...AINA, tpms: [{ id: 'ypa', name: 'YPA' }, { id: 'rano', name: 'RANO Control' }] }]);
  assert.deepEqual([two.state, two.providerId, two.candidates.length], ['a_arbitrer', 'rano', 2]);
  const q = a.qualityOf({ contracts: [withTpm, TOHANA], partners, months: ['2026-03'] });
  assert.deepEqual(q.contractsWithoutTpm.map((c) => c.numero), ['CTR-2026-0002']);
  assert.deepEqual(q.holdersNotTpm.map((h) => h.providerId), ['tohana']);
});

test('restampPlan : seulement les lignes qui changent ; deuxième passage vide', () => {
  const t = tableOf();
  const visits = [
    { id: 'v1', districtId: 'd1', communeId: 'c1', month: '2026-01', providerId: null, zoneState: null, contractId: null, dated: true },
    { id: 'v2', districtId: 'd1', communeId: null, month: '2026-01', providerId: 'aina', zoneState: 'contrat', contractId: 'k1' },
    { id: 'v3', districtId: null, communeId: null, month: '2026-01', providerId: null, zoneState: null, contractId: null },
  ];
  const plan = a.restampPlan(visits, t);
  assert.deepEqual(plan.map((p) => [p.id, p.providerId, p.zoneState]), [['v1', 'aina', 'contrat'], ['v3', null, 'district_inconnu']]);
  const applied = visits.map((v) => { const p = plan.find((x) => x.id === v.id); return p ? { ...v, ...p } : v; });
  assert.deepEqual(a.restampPlan(applied, t), []);
  const s = a.summarizeRestamp(plan);
  assert.deepEqual(s.byState, { contrat: 1, district_inconnu: 1 });
  assert.deepEqual(s.moves, [{ fromProviderId: null, toProviderId: 'aina', visits: 1, datedVisits: 1 }]);
});

test('districtAreaFor : unique, absent, ambigu', () => {
  const areas = [{ id: 'd1', key: 'bekily', regionKey: 'androy' }, { id: 'dx', key: 'manja', regionKey: 'menabe' }, { id: 'dy', key: 'manja', regionKey: 'autre' }];
  assert.equal(a.districtAreaFor('bekily', 'androy', areas), 'd1');
  assert.equal(a.districtAreaFor('bekily', '', areas), 'd1');
  assert.equal(a.districtAreaFor('bekily', 'menabe', areas), null);
  assert.equal(a.districtAreaFor('manja', '', areas), null); // ambigu sans région
  assert.equal(a.districtAreaFor('manja', 'menabe', areas), 'dx');
  assert.equal(a.districtAreaFor('—', '', areas), null);
});

test('plusieurs contrats : choisir explicitement le TPM par défaut est une décision (modification), le signal disparaît', () => {
  const x = contract({ id: 'kx', numero: 'CTR-2', partnerId: 'ypa', partnerName: 'YPA', zones: [zone(D1)] });
  const y = contract({ id: 'ky', numero: 'CTR-1', partnerId: 'rano', partnerName: 'RANO', zones: [zone(D1)] });
  const t = a.buildZoneTable({ areas: [D1], months: ['2026-01'], contracts: [x, y], overrides: [], partners });
  const plan = a.planOverrides({ targets: [{ areaId: 'd1', month: '2026-01', cell: t.cells.get('d1|2026-01') }], providerId: 'rano', reason: 'Arbitrage entre deux contrats' });
  assert.equal(plan.counts.created, 1);
  assert.deepEqual([plan.upserts[0].expectedState, plan.upserts[0].expectedProviderId], ['a_arbitrer', 'rano']);
  const after = a.buildZoneTable({
    areas: [D1], months: ['2026-01'], contracts: [x, y], partners,
    overrides: [ov({ providerId: 'rano', expectedState: 'a_arbitrer', expectedProviderId: 'rano' })],
  });
  const c = after.cells.get('d1|2026-01');
  assert.deepEqual([c.state, c.providerId, c.contractId, c.flags.includes('a_confirmer')], ['modifie', 'rano', 'ky', false]);
});
