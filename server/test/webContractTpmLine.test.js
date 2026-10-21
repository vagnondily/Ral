/**
 * Ligne « TPM » d'un contrat et colonne « TPM » d'un titulaire (vérification croisée, points 8 à 10) :
 *  - 8 : les zones suivies CE MOIS viennent des cellules de l'onglet Affectation des TPM
 *    (tpmAttribution.contractZoneFollow), jamais du nombre de zones — modification, indisponibilité
 *    ou autre contrat compris ; sans cellule pour une zone : la phrase toujours vraie ;
 *  - 9 : titulaire sans contrat qui couvre le mois → « — », jamais « Interne » (roles.holderTpmCell) ;
 *  - 10 : détail d'un brouillon, d'un contrat en validation ou rejeté → « — », comme la liste
 *    (roles.contractTpmKind) ; « Interne — … » pour un contrat qui couvre des mois sans TPM seulement.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const WEB = path.join(__dirname, '../../web/src');
const load = async (t, rel) => {
  const file = path.join(WEB, rel);
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};
const source = (t, rel) => {
  const file = path.join(WEB, rel);
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return fs.readFileSync(file, 'utf8');
};
// Traduction neutre : la phrase française, variables remplacées.
const tr = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined ? `{${k}}` : String(v[k])));

const SAHY = { id: 'sahy', name: 'SAHY Monitoring' };
const zones = [{ adminAreaId: 'amb', path: 'Anosy > Amboasary Sud' }, { adminAreaId: 'bet', path: 'Anosy > Betroka' }];
const cellOf = (o) => ({ state: 'contrat', providerId: 'sahy', providerName: 'SAHY Monitoring', monitoredBy: 'tpm',
  contractId: 'ctr2', numero: 'CTR-2026-0002', contractLabel: 'FLA-2025-TOH-SAMS-004', ...o });
const tableOf = (cells) => ({ today: '2026-10', rows: [
  { id: 'reg', name: 'Autre district', cells: [cellOf({ providerId: 'ypa', providerName: 'YPA', contractId: 'ctr3' })] },
  ...Object.entries(cells).map(([id, c]) => ({ id, name: id === 'amb' ? 'Amboasary Sud' : 'Betroka', cells: [c] })),
] });

test('8 : zones suivies ce mois d\'après les cellules de l\'onglet — modification d\'une zone', async (t) => {
  const w = await load(t, 'lib/tpmAttribution.js'); if (!w) return;
  // Scénario du constat : Betroka modifiée vers RANO Control pour le mois, Amboasary Sud reste au contrat.
  const table = tableOf({ amb: cellOf(), bet: cellOf({ state: 'modifie', providerId: 'rano', providerName: 'RANO Control' }) });
  const f = w.contractZoneFollow(zones, [SAHY], table);
  assert.deepEqual([f.total, f.followed, f.others.map((o) => o.name)], [2, 1, ['Betroka']]);
  assert.equal(w.contractZoneFollowText(tr, f, 'ctr2'), 'suit 1 des 2 zones ce mois · Betroka : RANO Control (modification)');
  // Sans modification : les deux zones, ou la seule zone.
  const all = w.contractZoneFollow(zones, [SAHY], tableOf({ amb: cellOf(), bet: cellOf() }));
  assert.equal(w.contractZoneFollowText(tr, all, 'ctr2'), 'suit les 2 zones du contrat ce mois');
  assert.equal(w.contractZoneFollowText(tr, w.contractZoneFollow(zones.slice(0, 1), [SAHY], tableOf({ amb: cellOf() })), 'ctr2'),
    'suit la zone du contrat ce mois');
});

test('8 : indisponibilité et autre contrat — la cellule dit qui suit la zone, jamais « zones en suivi interne » d\'office', async (t) => {
  const w = await load(t, 'lib/tpmAttribution.js'); if (!w) return;
  // SAHY indisponible : Amboasary Sud passe en interne, mais Betroka reste à RANO Control (modification).
  const table = tableOf({
    amb: cellOf({ state: 'indisponible', providerId: null, providerName: null, monitoredBy: 'interne', contractId: null,
      unavailable: [{ providerId: 'sahy', providerName: 'SAHY Monitoring', reason: 'Équipe mobilisée ailleurs' }] }),
    bet: cellOf({ state: 'modifie', providerId: 'rano', providerName: 'RANO Control' }),
  });
  assert.equal(w.contractZoneFollowText(tr, w.contractZoneFollow(zones, [SAHY], table), 'ctr2'),
    'ne suit aucune zone du contrat ce mois · Amboasary Sud : Interne (TPM indisponible) · Betroka : RANO Control (modification)');
  // Un autre contrat de suivi couvre la zone avec un TPM disponible (« s'il en reste, ils décident »).
  const other = tableOf({ amb: cellOf(), bet: cellOf({ providerId: 'ypa', providerName: 'YPA', contractId: 'ctr3', contractLabel: 'FLA-2025-MIA-RES-007' }) });
  assert.equal(w.contractZoneFollowText(tr, w.contractZoneFollow(zones, [SAHY], other), 'ctr2'),
    'suit 1 des 2 zones ce mois · Betroka : YPA (autre contrat : FLA-2025-MIA-RES-007)');
  // Plusieurs TPM sur le contrat : une zone suivie par l'un d'eux est suivie.
  const two = tableOf({ amb: cellOf(), bet: cellOf({ state: 'a_arbitrer', providerId: 'rano', providerName: 'RANO Control' }) });
  assert.equal(w.contractZoneFollow(zones, [SAHY, { id: 'rano' }], two).followed, 2);
});

test('8 : sans cellule pour une zone (réponse absente, zone à resélectionner, région entière) — la phrase toujours vraie', async (t) => {
  const w = await load(t, 'lib/tpmAttribution.js'); if (!w) return;
  const table = tableOf({ amb: cellOf(), bet: cellOf() });
  assert.equal(w.contractZoneFollow(zones, [SAHY], null), null, 'réponse absente (erreur)');
  assert.equal(w.contractZoneFollow([...zones, { adminAreaId: null, path: 'Ancienne zone' }], [SAHY], table), null, 'zone détachée');
  assert.equal(w.contractZoneFollow([{ adminAreaId: 'region-anosy', path: 'Anosy' }], [SAHY], table), null, 'aucune ligne pour la zone');
  assert.equal(w.contractZoneFollowText(tr, null, 'ctr2'), w.ZONE_FOLLOW_DEFAULT);
  assert.match(w.ZONE_FOLLOW_DEFAULT, /sauf modification ou indisponibilité/);
});

test('8 : trois zones nommées au plus, puis « +n autre(s) »', async (t) => {
  const w = await load(t, 'lib/tpmAttribution.js'); if (!w) return;
  const many = Array.from({ length: 5 }, (_, i) => ({ adminAreaId: `z${i}` }));
  const table = { rows: many.map((z, i) => ({ id: z.adminAreaId, name: `Zone ${i}`, cells: [cellOf({ state: 'modifie', providerId: 'rano', providerName: 'RANO Control' })] })) };
  assert.equal(w.contractZoneFollowText(tr, w.contractZoneFollow(many, [SAHY], table), 'ctr2'),
    'ne suit aucune zone du contrat ce mois · Zone 0 : RANO Control (modification) · Zone 1 : RANO Control (modification) · Zone 2 : RANO Control (modification) · +2 autre(s)');
});

test('8 et 10 : la ligne « TPM » du détail lit les cellules et la règle de la liste, plus le nombre de zones', (t) => {
  const src = source(t, 'pages/contracts/ContractDetailPage.jsx'); if (!src) return;
  const fn = src.slice(src.indexOf('function ContractTpm('), src.indexOf('\n}\n', src.indexOf('function ContractTpm(')));
  assert.match(fn, /contractTpmKind\(contract\)/, 'même règle que la liste des contrats');
  assert.match(fn, /contractZoneFollow\(zones, list, zoneTable\)/, 'zones lues dans les cellules');
  assert.doesNotMatch(src, /zones=\{\(detail\.areas \|\| \[\]\)\.length\}/, 'plus le nombre de zones');
  assert.doesNotMatch(src, /'suit les \{n\} zones du contrat'|zones en suivi interne/, 'plus les phrases déduites du nombre de zones');
  // « Interne — … » seulement pour 'interne' ; « — » pour 'aucun' (brouillon, en validation, rejeté).
  const aucun = fn.slice(fn.indexOf("kind === 'aucun'"), fn.indexOf("kind === 'interne'"));
  assert.match(aucun, /aucun mois couvert tant que le contrat n\\'est pas actif/);
  assert.doesNotMatch(aucun, /Interne/);
  const interne = fn.slice(fn.indexOf("kind === 'interne'"));
  assert.match(interne.slice(0, interne.indexOf('}')), /Interne — suivi par l\\'équipe S&E/);
  // Mois courant du serveur : `today` de la réponse fait foi.
  assert.match(src, /t\.today !== month/);
});

test('10 : brouillon, en validation, rejeté → « aucun » ; actif ou résilié sans TPM → « interne »', async (t) => {
  const r = await load(t, 'lib/roles.js'); if (!r) return;
  const none = { state: 'aucun', tpms: [] };
  assert.deepEqual(['brouillon', 'en_validation', 'rejete', 'actif', 'resilie'].map((status) => r.contractTpmKind({ status, tpm: none })),
    ['aucun', 'aucun', 'aucun', 'interne', 'interne']);
  assert.equal(r.contractTpmKind({ status: 'actif', tpm: { tpms: [SAHY] } }), 'tpm');
});

test('9 : colonne TPM d\'un titulaire — « — » sans contrat qui couvre le mois, « Interne » pour un contrat tenu sans TPM', async (t) => {
  const r = await load(t, 'lib/roles.js'); if (!r) return;
  // ASSOCIATION AINA : son seul contrat a pris fin (heldContracts filtrés par le mois) → « — ».
  assert.deepEqual(r.holderTpmCell({ heldContracts: [], tpms: [] }), { names: [], internal: false, none: true });
  assert.deepEqual(r.holderTpmCell({ heldContracts: [{ id: 'c1', hasTpm: false }], tpms: [] }), { names: [], internal: true, none: false });
  assert.deepEqual(r.holderTpmCell({ heldContracts: [{ id: 'c1', hasTpm: true }], tpms: [{ name: 'RANO Control' }] }),
    { names: ['RANO Control'], internal: false, none: false });
  assert.deepEqual(r.holderTpmCell({ heldContracts: [{ id: 'c1', hasTpm: true }, { id: 'c2', hasTpm: false }], tpms: [{ name: 'RANO Control' }] }),
    { names: ['RANO Control'], internal: true, none: false }, 'deux contrats : l\'un suivi par un TPM, l\'autre en interne');
  assert.deepEqual(r.holderTpmCell(null), { names: [], internal: false, none: true });
  const src = source(t, 'pages/ProvidersPage.jsx'); if (!src) return;
  assert.match(src, /holderTpmCell\(p\)/);
  assert.doesNotMatch(src, /\|\| tr\(ROLE_LABELS\.noTpm\)/, 'plus de repli « Interne » quand la liste des TPM est vide');
});

test('9 : le serveur dit pour chaque contrat tenu s\'il a un TPM (contractTpm.partnerContracts)', () => {
  const { contractTpmViews, partnerContracts } = require('../src/modules/tpm/contractTpm');
  const partners = [{ id: 'h', name: 'Titulaire', typeCode: 'prestataire', active: true }, { id: 'p', name: 'RANO Control', typeCode: 'tpm', active: true }];
  const contracts = [
    { id: 'c1', numero: 'CTR-1', partnerId: 'h', partnerName: 'Titulaire', status: 'actif' },
    { id: 'c2', numero: 'CTR-2', partnerId: 'h', partnerName: 'Titulaire', status: 'actif' },
  ];
  const views = contractTpmViews(contracts, [{ partnerId: 'p', contractId: 'c1', via: ['rapport'] }], partners);
  assert.deepEqual(partnerContracts(contracts, views).get('h').held.map((c) => [c.id, c.hasTpm]), [['c1', true], ['c2', false]]);
});
