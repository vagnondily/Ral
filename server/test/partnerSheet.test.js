const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSheet, contractRows, budgetRecap, reportSummary, mergeZones, shapeTimeline } = require('../src/modules/partners/partnerSheet');

const fig = (o) => ({
  id: 'c1', numero: 'CTR-1', status: 'actif', holderId: 'h1', holderName: 'Aina', dateDebut: '2026-01-01', dateFin: '2026-12-31',
  terminationDate: null, feePct: '0.07', directCents: '1000000001', monitoringCents: '200000000', providerActualCents: '50000000',
  providerPendingCents: '10000000', contractActualCents: '80000000', providerPlannedCents: '60000000', ...o,
});
const link = (o) => ({ contractId: 'c1', partnerId: 'p1', status: 'actif', dateDebut: '2026-01-01', dateFin: '2026-12-31', monitoring: true, via: ['rapport'], ...o });

test('contrats : total de l\'accord = direct + commission (centimes entiers), part du prestataire, consommation du contrat', () => {
  const [r] = contractRows([fig()], [link()], { partnerId: 'p1', month: '2026-10' });
  assert.equal(r.total, 10700000.01, '10 000 000,01 + 7 % arrondi au centime');
  assert.equal(r.monitoringBudget, 2000000);
  assert.deepEqual([r.providerActual, r.providerPending, r.providerPlanned, r.contractActual], [500000, 100000, 600000, 800000]);
  assert.equal(r.consumption, 40);
  assert.equal(r.remaining, 1200000);
  assert.deepEqual([r.isHolder, r.via, r.coversMonth], [false, ['rapport'], true]);
  // Contrat de suivi actif présent dans la Consolidation : même Réalisé, même projection.
  const cons = new Map([['c1', { actual: 900000, monthsRemaining: 3, projectedOverrun: -5000 }]]);
  const [c] = contractRows([fig()], [link()], { partnerId: 'p1', month: '2026-10', consolidation: cons });
  assert.deepEqual([c.contractActual, c.consumption, c.monthsRemaining, c.projectedOverrun], [900000, 45, 3, -5000]);
  // Sans ligne de suivi : consommation « — », jamais 0 %.
  const [z] = contractRows([fig({ monitoringCents: '0', contractActualCents: '0' })], [link({ monitoring: false })], { partnerId: 'h1', month: '2027-01' });
  assert.deepEqual([z.consumption, z.remaining, z.isHolder, z.coversMonth], [null, null, true, false]);
});

test('récapitulatif : sommes en centimes ; la consommation ne compte que les contrats de suivi', () => {
  const rows = contractRows([fig(), fig({ id: 'c2', numero: 'CTR-2', monitoringCents: '0', contractActualCents: '0', providerActualCents: '0' })],
    [link(), link({ contractId: 'c2', monitoring: false })], { partnerId: 'p1', month: '2026-10' });
  const b = budgetRecap(rows);
  assert.deepEqual([b.contracts, b.monitoringContracts, b.monitoringBudget, b.providerActual, b.consumption, b.providerShare],
    [2, 1, 2000000, 500000, 40, 25]);
  assert.equal(budgetRecap([]).consumption, null);
});

test('fiche : statut selon contrat, visites du mois (jamais « 0 % » sans affectation), rapports à valider', () => {
  const s = buildSheet({
    partner: { id: 'p1', name: 'YPA' }, links: [link()], contracts: [fig()],
    counts: { month: '2026-10', today: '2026-10-14', visitsAssigned: 0, visitsRealised: 0, agentsActive: 2, agentsTotal: 3, submissions12: 9, submissionsExcluded12: 1 },
    reports: [{ kind: 'financier', status: 'soumis', n: 2 }, { kind: 'technique', status: 'valide', n: 1 }],
    lastEval: { id: 'e1', score: '13.3', band: 'bon' }, zones: [], districts: [],
  });
  assert.equal(s.status.state, 'actif');
  assert.equal(s.facts.visits.rate, null);
  assert.equal(s.facts.submissions.excludedRate, 10);
  assert.deepEqual([s.facts.reports.total, s.facts.reports.toValidate], [3, 2]);
  assert.equal(s.facts.evaluation.score, 13.3);
  // Bloc « Fiche 360° » du concepteur de rapport : contrat en cours et compteurs à l'ancienne forme.
  assert.deepEqual([s.facts.contract.status, s.facts.contract.numero, s.facts.contract.budget, s.facts.contract.consumption, s.facts.invoicesPending],
    ['mesure', 'CTR-1', 2000000, 40, 2]);
  assert.deepEqual(reportSummary([{ kind: 'autre', status: 'soumis', n: 4 }]).total, 0);
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

test('rôles (retour 113) : le titulaire voit le TPM de ses contrats, le TPM les contrats qu\'il suit', () => {
  const { providerListRows } = require('../src/modules/partners/partnerSheet');
  const contracts = [{ id: 'c1', numero: 'CTR-1', numeroFla: 'FLA-1', partnerId: 'h1', partnerName: 'Aina', status: 'actif' }];
  const views = new Map([['c1', { state: 'rattache', tpms: [{ id: 'p1', name: 'YPA', via: ['rapport'] }] }]]);
  const rows = providerListRows([
    { id: 'h1', name: 'Aina', typeCode: 'prestataire', today: '2026-10-14' },
    { id: 'p1', name: 'YPA', typeCode: 'tpm', today: '2026-10-14' },
    { id: 'x1', name: 'Cabinet X', typeCode: 'cabinet', today: '2026-10-14' },
  ], [link(), link({ partnerId: 'h1', via: ['titulaire'] })], { contracts, views });
  const [aina, ypa, cab] = rows;
  assert.deepEqual([aina.role, aina.heldContracts.map((c) => c.numeroFla), aina.tpms.map((t) => t.name)], ['mise_en_oeuvre', ['FLA-1'], ['YPA']]);
  assert.deepEqual([ypa.role, ypa.monitoredContracts.map((c) => [c.numeroFla, c.holderName]), ypa.heldContracts], ['tpm', [['FLA-1', 'Aina']], []]);
  assert.deepEqual([cab.role, cab.heldContracts, cab.tpms], ['autre', [], []]);
  // Fiche du titulaire : son TPM ; ligne de contrat : n° FLA, rôle du titulaire, TPM du contrat.
  const s = buildSheet({
    partner: { id: 'h1', name: 'Aina', typeCode: 'prestataire' }, links: [link({ partnerId: 'h1', via: ['titulaire'] })], contracts: [fig({ numeroFla: 'FLA-1' })],
    counts: { month: '2026-10', today: '2026-10-14' }, reports: [], lastEval: null, zones: [], districts: [],
    tpmViews: views, partnerTypes: new Map([['h1', 'prestataire'], ['p1', 'tpm']]),
  });
  assert.deepEqual([s.role, s.tpms, s.contracts[0].numeroFla, s.contracts[0].holderRole, s.contracts[0].tpm.state],
    ['mise_en_oeuvre', [{ id: 'p1', name: 'YPA' }], 'FLA-1', 'mise_en_oeuvre', 'rattache']);
});

test('rôle d\'un partenaire changé (type ou fiche active) : réestampille des visites prévues', () => {
  const { roleChanged } = require('../src/modules/partners/partnerRole');
  assert.equal(roleChanged({ partnerTypeId: 't1', active: true }, { partnerTypeId: 't1', active: true }), false);
  assert.equal(roleChanged({ partnerTypeId: 't1', active: true }, { partnerTypeId: 't2', active: true }), true);
  assert.equal(roleChanged({ partnerTypeId: 't1', active: true }, { partnerTypeId: 't1', active: false }), true);
  assert.equal(roleChanged(null, { partnerTypeId: 't1', active: true }), false);
  // Même UUID en majuscules (zod `.uuid()` l'accepte) : pas un changement de rôle — ni verrou d'attribution ni réestampille.
  const id = '0f6cbd00-aaaa-4bbb-8ccc-1234567890ab';
  assert.equal(roleChanged({ partnerTypeId: id, active: true }, { partnerTypeId: id.toUpperCase(), active: true }), false);
  const { changesRole } = require('../src/modules/partners/partnerRole');
  assert.equal(changesRole({ name: 'YPA', partnerTypeId: id, active: true }, { name: 'YPA', partnerTypeId: id.toUpperCase(), active: true }), false);
});

test('changement de rôle : verrou d\'attribution seulement si le rôle change VRAIMENT, et toujours AVANT la ligne', async () => {
  const { roleForUpdateTx, ROLE_LOCK } = require('../src/modules/partners/partnerRole');
  // Faux client : chaque SELECT de la fiche rend la ligne suivante de `rows` ; les étapes sont notées.
  const run = async (rows, patch) => {
    const steps = []; const queue = [...rows];
    const client = { query: async (text) => {
      if (/pg_advisory_xact_lock/.test(text)) steps.push('attribution');
      else if (/FROM partners/.test(text)) { steps.push(/FOR NO KEY UPDATE$/.test(text) ? 'ligne' : 'lecture'); assert.doesNotMatch(text, /FOR UPDATE/); return { rows: [queue.shift()].filter(Boolean) }; }
      else if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/.test(text)) steps.push(text.split(' partner_role_lock')[0]);
      return { rows: [] };
    } };
    return { row: await roleForUpdateTx(client, 'tenant', 'p1', patch), steps };
  };
  assert.equal(ROLE_LOCK, 'FOR NO KEY UPDATE');
  const ypa = { name: 'YPA', partnerTypeId: 't', active: true };
  // Ce que l'écran envoie toujours ({ name, partnerTypeId, active }) — renommage seul : jamais le verrou d'attribution.
  assert.deepEqual((await run([ypa, ypa], { name: 'YPA 2', partnerTypeId: 't', active: true })).steps,
    ['lecture', 'SAVEPOINT', 'ligne', 'RELEASE SAVEPOINT']);
  // Type ou fiche active changés : verrou d'attribution, PUIS la ligne.
  for (const patch of [{ partnerTypeId: 't2', active: true }, { partnerTypeId: 't', active: false }, { active: false }]) {
    assert.deepEqual((await run([ypa, ypa], patch)).steps, ['lecture', 'attribution', 'ligne'], JSON.stringify(patch));
  }
  // Rôle changé entre la lecture et le verrou (autre enregistrement validé) : la ligne est rendue
  // (ROLLBACK TO SAVEPOINT) AVANT le verrou d'attribution, puis reprise.
  const moved = { ...ypa, partnerTypeId: 't3' };
  const r = await run([ypa, moved, moved], { name: 'YPA', partnerTypeId: 't', active: true });
  assert.deepEqual(r.steps, ['lecture', 'SAVEPOINT', 'ligne', 'ROLLBACK TO SAVEPOINT', 'RELEASE SAVEPOINT', 'attribution', 'ligne']);
  assert.deepEqual(r.row, moved, 'l\'état comparé est celui lu SOUS verrou');
  // Fiche absente : rien de verrouillé.
  assert.deepEqual(await run([], { active: false }), { row: null, steps: ['lecture'] });
});

test('changement de rôle : rôle après le patch, vrai changement, `name` dans l\'UPDATE seulement s\'il change', () => {
  const { roleAfter, changesRole, nameChanges } = require('../src/modules/partners/partnerRole');
  const before = { name: 'YPA', partnerTypeId: 't', active: true };
  assert.deepEqual(roleAfter(before, {}), { partnerTypeId: 't', active: true });
  assert.deepEqual(roleAfter(before, { partnerTypeId: '', active: null }), { partnerTypeId: 't', active: true }, 'vide ou null = inchangé');
  assert.deepEqual(roleAfter(before, { partnerTypeId: 't2', active: false }), { partnerTypeId: 't2', active: false });
  assert.equal(changesRole(before, { name: 'X', partnerTypeId: 't', active: true }), false, 'valeurs renvoyées telles quelles');
  assert.equal(changesRole(before, { active: false }), true);
  assert.equal(changesRole(before, { partnerTypeId: 't2' }), true);
  assert.equal(nameChanges(before, 'YPA'), false, 'nom renvoyé tel quel (l\'écran l\'envoie toujours)');
  for (const n of [undefined, null, '']) assert.equal(nameChanges(before, n), false);
  assert.equal(nameChanges(before, 'YPA Madagascar'), true);
  assert.equal(nameChanges(before, 'ypa'), true, 'la casse est un vrai changement');
});

test('titulaire : visites suivies en interne de ses zones — la cellule nomme son contrat (sans TPM, ou TPM indisponible)', () => {
  const { internalCellContracts, holderInternalVisits } = require('../src/modules/partners/partnerSheet');
  const sansTpm = { state: 'sans_tpm', default: { noTpm: [{ contractId: 'K' }, { contractId: 'L' }], candidates: [] } };
  const indispo = { state: 'indisponible', default: { candidates: [{ providerId: 'ypa', contractId: 'K' }, { providerId: 'sahy', contractId: 'M' }] }, override: null };
  const suspendue = { state: 'indisponible', default: { candidates: [{ providerId: 'ypa', contractId: 'K' }, { providerId: 'sahy', contractId: 'M' }] }, override: { providerId: 'sahy' } };
  assert.deepEqual(internalCellContracts(sansTpm), ['K', 'L']);
  assert.deepEqual(internalCellContracts(indispo), ['K', 'M']);
  assert.deepEqual(internalCellContracts(suspendue), ['M'], 'modification suspendue : le contrat du TPM choisi');
  for (const c of [null, {}, { state: 'contrat', default: { candidates: [{ contractId: 'K' }] } }, { state: 'sans_contrat', default: { noTpm: [] } }]) {
    assert.deepEqual(internalCellContracts(c), [], JSON.stringify(c));
  }
  const visits = [
    { status: 'planifie', cell: sansTpm }, { status: 'realise', cell: indispo }, { status: 'annule', cell: sansTpm },
    { status: 'planifie', cell: suspendue }, { status: 'planifie', cell: { state: 'sans_contrat', default: { noTpm: [] } } },
  ];
  assert.deepEqual(holderInternalVisits(visits, ['K']), { visitsInternal: 2, visitsInternalRealised: 1 }, 'annulée et autres contrats exclus');
  assert.deepEqual(holderInternalVisits(visits, []), { visitsInternal: 0, visitsInternalRealised: 0 });
});
