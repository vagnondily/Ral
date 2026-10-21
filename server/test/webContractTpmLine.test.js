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
