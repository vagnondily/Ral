const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Liste de choix d'un objet métier (web/src/lib/entityPicker.js) et options contrat / TPM
// (web/src/lib/tpmPickers.js, règle du retour 58) — logique pure.
const webFile = (...p) => path.join(__dirname, '../../web/src', ...p);
const load = async (t, name) => {
  const file = webFile('lib', name);
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};

test('recherche sans accents ni casse, tous les mots, dans le libellé, la précision ou les mots-clés', async (t) => {
  const m = await load(t, 'entityPicker.js'); if (!m) return;
  const opts = [
    { value: '1', label: 'FLA-2025-001', sub: 'ONG Fanilo · Mars 2025 – févr. 2026', keywords: ['Ezaka Conseil'] },
    { value: '2', label: 'FLA-2025-002', sub: 'Association Tsiry' },
    { value: '3', label: 'Évaluation Sud' },
  ];
  assert.deepEqual(m.filterOptions(opts, '').map((o) => o.value), ['1', '2', '3']);
  assert.deepEqual(m.filterOptions(opts, 'fanilo').map((o) => o.value), ['1']);
  assert.deepEqual(m.filterOptions(opts, 'EZAKA').map((o) => o.value), ['1'], 'mot-clé (TPM du contrat)');
  assert.deepEqual(m.filterOptions(opts, 'evaluation').map((o) => o.value), ['3'], 'sans accent');
  assert.deepEqual(m.filterOptions(opts, '2025 tsiry').map((o) => o.value), ['2'], 'tous les mots');
  assert.deepEqual(m.filterOptions(opts, 'introuvable'), []);
});

test('groupes dans l\'ordre demandé, options sans groupe d\'abord, ordre interne conservé', async (t) => {
  const m = await load(t, 'entityPicker.js'); if (!m) return;
  const opts = [
    { value: 'a', label: 'A', group: 'Autres' }, { value: 'b', label: 'B', group: 'Du contrat' },
    { value: 'c', label: 'C' }, { value: 'd', label: 'D', group: 'Autres' }, { value: 'e', label: 'E', group: 'Inconnu' },
  ];
  const g = m.groupOptions(opts, ['Du contrat', 'Autres']);
  assert.deepEqual(g.map((x) => x.group), ['', 'Du contrat', 'Autres', 'Inconnu']);
  assert.deepEqual(g[2].items.map((o) => o.value), ['a', 'd']);
  assert.deepEqual(m.flatOptions(g).map((o) => o.value), ['c', 'b', 'a', 'd', 'e']);
  assert.deepEqual(m.flatOptions([{ group: '', items: [{ value: 'x', disabled: true }, { value: 'y' }] }]).map((o) => o.value), ['y'], 'option désactivée sautée');
});

test('clavier : ↓ ↑ bouclent, Début / Fin aux extrémités, liste vide = aucune', async (t) => {
  const m = await load(t, 'entityPicker.js'); if (!m) return;
  assert.equal(m.moveActive(-1, 3, 'ArrowDown'), 0);
  assert.equal(m.moveActive(2, 3, 'ArrowDown'), 0);
  assert.equal(m.moveActive(0, 3, 'ArrowUp'), 2);
  assert.equal(m.moveActive(1, 3, 'Home'), 0);
  assert.equal(m.moveActive(1, 3, 'End'), 2);
  assert.equal(m.moveActive(1, 0, 'ArrowDown'), -1);
  assert.equal(m.showSearch(new Array(7).fill({})), false);
  assert.equal(m.showSearch(new Array(8).fill({})), true);
});

const CONTRACTS = [
  { id: 'k1', numero: 'FLA-2025-001', partnerName: 'ONG Fanilo', dateDebut: '2025-03-01', dateFin: '2026-02-28' },
  { id: 'k2', numero: 'FLA-2026-004', partnerName: 'Association Tsiry', dateDebut: '2026-01-01', dateFin: '2026-12-31' },
  { id: 'k3', numero: 'FLA-2026-009', partnerName: 'ONG Fanilo', dateDebut: '2026-06-01', dateFin: null },
];
const TPMS = { k1: [{ id: 'p1', name: 'Ezaka Conseil' }], k2: [{ id: 'p2', name: 'Miray Suivi' }], k3: [{ id: 'p1', name: 'Ezaka Conseil' }, { id: 'p2', name: 'Miray Suivi' }] };
const tpmsOf = (id) => TPMS[id] || [];
const LABELS = { covering: 'Couvrent oct. 2026', others: 'Autres contrats actifs', tpm: 'TPM' };

test('contrats : n° en libellé, partenaire · période · TPM en précision, ceux qui couvrent le mois d\'abord', async (t) => {
  const m = await load(t, 'tpmPickers.js'); if (!m) return;
  const { options, order } = m.contractOptions(CONTRACTS, { month: '2026-10', tpmsOf, fmtPeriod: (a, b) => `${a}→${b}`, labels: LABELS });
  assert.deepEqual(order, ['Couvrent oct. 2026', 'Autres contrats actifs']);
  const byId = Object.fromEntries(options.map((o) => [o.value, o]));
  assert.equal(byId.k1.label, 'FLA-2025-001');
  assert.equal(byId.k1.sub, 'ONG Fanilo · 2025-03→2026-02 · TPM : Ezaka Conseil');
  assert.equal(byId.k1.group, 'Autres contrats actifs', 'fini en février 2026');
  assert.equal(byId.k2.group, 'Couvrent oct. 2026');
  assert.equal(byId.k3.group, 'Couvrent oct. 2026', 'sans date de fin : ouvert');
  assert.equal(byId.k3.sub, 'ONG Fanilo · TPM : Ezaka Conseil, Miray Suivi', 'sans fin : pas de période affichée');
  assert.ok(byId.k1.keywords.includes('Ezaka Conseil'), 'recherche par TPM');
  const flat = m.contractOptions(CONTRACTS, { tpmsOf });
  assert.deepEqual(flat.order, []);
  assert.ok(flat.options.every((o) => o.group === undefined), 'sans mois : pas de groupes');
  assert.equal(m.contractCovers({ dateDebut: '2026-10-15', dateFin: '2026-10-20' }, '2026-10'), true, 'mois partiellement couvert');
  assert.equal(m.contractCovers({ dateDebut: '2026-11-01' }, '2026-10'), false);
});

test('TPM : ses contrats en précision ; le contrat choisi, ses TPM d\'abord', async (t) => {
  const m = await load(t, 'tpmPickers.js'); if (!m) return;
  const partners = [{ id: 'p1', name: 'Ezaka Conseil' }, { id: 'p2', name: 'Miray Suivi' }, { id: 'p3', name: 'Nouveau TPM' }];
  const labels = { ofContract: 'TPM de ce contrat', others: 'Autres prestataires TPM', noContract: 'Aucun contrat de suivi rattaché' };
  const none = m.tpmOptions(partners, { contracts: CONTRACTS, tpmsOf, labels });
  assert.deepEqual(none.order, [], 'sans contrat choisi : une seule liste');
  assert.equal(none.options[0].sub, 'FLA-2025-001, FLA-2026-009');
  assert.equal(none.options[2].sub, 'Aucun contrat de suivi rattaché');
  const k2 = m.tpmOptions(partners, { contracts: CONTRACTS, contractId: 'k2', tpmsOf, labels });
  assert.deepEqual(k2.order, ['TPM de ce contrat', 'Autres prestataires TPM']);
  assert.deepEqual(k2.options.map((o) => o.group), ['Autres prestataires TPM', 'TPM de ce contrat', 'Autres prestataires TPM']);
});

test('le contrat propose son TPM, le TPM son contrat (retour 58), sans écraser un choix cohérent', async (t) => {
  const m = await load(t, 'tpmPickers.js'); if (!m) return;
  const empty = { partnerId: '', contractId: '' };
  assert.deepEqual(m.withContract(empty, 'k1', tpmsOf), { partnerId: 'p1', contractId: 'k1' }, 'un seul TPM : pris');
  assert.deepEqual(m.withContract(empty, 'k3', tpmsOf), { partnerId: '', contractId: 'k3' }, 'deux TPM : choix laissé');
  assert.deepEqual(m.withContract({ partnerId: 'p2', contractId: '' }, 'k3', tpmsOf), { partnerId: 'p2', contractId: 'k3' }, 'TPM du contrat : gardé');
  assert.deepEqual(m.withContract({ partnerId: 'p1', contractId: 'k1' }, 'k2', tpmsOf), { partnerId: 'p2', contractId: 'k2' }, 'changement de contrat : son TPM unique remplace l\'ancien');
  assert.deepEqual(m.withContract({ partnerId: 'p1', contractId: 'k1' }, '', tpmsOf), { partnerId: 'p1', contractId: '' });
  assert.deepEqual(m.withPartner(empty, 'p2', CONTRACTS, tpmsOf), { partnerId: 'p2', contractId: '' }, 'deux contrats (k2, k3) : choix laissé');
  assert.deepEqual(m.withPartner(empty, 'p3', CONTRACTS, tpmsOf), { partnerId: 'p3', contractId: '' });
  assert.deepEqual(m.withPartner(empty, 'p1', [CONTRACTS[0]], tpmsOf), { partnerId: 'p1', contractId: 'k1' }, 'un seul contrat : pris');
  assert.deepEqual(m.withPartner({ partnerId: '', contractId: 'k2' }, 'p1', CONTRACTS, tpmsOf), { partnerId: 'p1', contractId: 'k2' }, 'contrat déjà choisi : jamais changé');
});

test('au plus N options affichées, le reste compté (jamais tronqué en silence)', async (t) => {
  const m = await load(t, 'entityPicker.js'); if (!m) return;
  const groups = [{ group: 'A', items: [{ value: '1' }, { value: '2' }] }, { group: 'B', items: [{ value: '3' }, { value: '4' }, { value: '5' }] }];
  const r = m.limitGroups(groups, 3);
  assert.deepEqual(r.groups.map((g) => [g.group, g.items.map((o) => o.value)]), [['A', ['1', '2']], ['B', ['3']]]);
  assert.equal(r.hidden, 2);
  assert.equal(m.limitGroups(groups, 0).hidden, 0, 'sans limite');
  assert.deepEqual(m.limitGroups(groups, 2).groups.map((g) => g.group), ['A'], 'groupe vide retiré');
});

test('nombre décimal dans la langue de l\'interface : virgule en français, point en anglais', async (t) => {
  const m = await load(t, 'format.js'); if (!m) return;
  m.setFormatLocale('fr');
  assert.equal(m.formatDecimal(63.14), '63,1');
  assert.equal(m.formatDecimal(31.5, 1), '31,5');
  assert.equal(m.formatDecimal(1234.5, 1), '1 234,5', 'séparateur de milliers insécable lisible');
  assert.equal(m.formatDecimal(Number.NaN), '—');
  m.setFormatLocale('en');
  assert.equal(m.formatDecimal(63.14), '63.1');
  m.setFormatLocale('fr');
});
