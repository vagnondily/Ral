const test = require('node:test');
const assert = require('node:assert/strict');
const { roleOf, contractTpmViews, partnerContracts, contractNo } = require('../src/modules/tpm/contractTpm');

const partners = [
  { id: 'aina', name: 'ASSOCIATION AINA', typeCode: 'prestataire', active: true },
  { id: 'miaro', name: 'MIARO', typeCode: 'prestataire', active: true },
  { id: 'rano', name: 'RANO Control', typeCode: 'tpm', active: true },
  { id: 'sahy', name: 'SAHY Monitoring', typeCode: 'tpm', active: true },
  { id: 'old', name: 'Ancien TPM', typeCode: 'tpm', active: false },
];
const contracts = [
  { id: 'c1', numero: 'CTR-1', numeroFla: 'FLA-AIN-1', partnerId: 'aina', partnerName: 'ASSOCIATION AINA', status: 'actif' },
  { id: 'c2', numero: 'CTR-2', numeroFla: null, partnerId: 'sahy', partnerName: 'SAHY Monitoring', status: 'actif' },
  { id: 'c3', numero: 'CTR-3', numeroFla: 'FLA-MIA-3', partnerId: 'miaro', partnerName: 'MIARO', status: 'actif' },
];
const links = [
  { partnerId: 'aina', contractId: 'c1', via: ['titulaire'] },
  { partnerId: 'rano', contractId: 'c1', via: ['plan', 'rapport'] },
  { partnerId: 'sahy', contractId: 'c2', via: ['titulaire'] },
  { partnerId: 'miaro', contractId: 'c3', via: ['titulaire'] },
  { partnerId: 'old', contractId: 'c3', via: ['rapport'] },
  { partnerId: 'sahy', contractId: 'c3', via: ['visite'] },
];

test('rôle d\'un partenaire selon son type', () => {
  assert.deepEqual(['tpm', 'prestataire', 'cabinet', null].map(roleOf), ['tpm', 'mise_en_oeuvre', 'autre', 'autre']);
});

test('TPM d\'un contrat : rattaché par plan / facture, sinon le titulaire s\'il est un TPM, sinon aucun', () => {
  const v = contractTpmViews(contracts, links, partners);
  assert.deepEqual(v.get('c1'), { state: 'rattache', tpms: [{ id: 'rano', name: 'RANO Control', via: ['plan', 'rapport'] }] });
  assert.deepEqual(v.get('c2'), { state: 'titulaire', tpms: [{ id: 'sahy', name: 'SAHY Monitoring', via: ['titulaire'] }] });
  // TPM inactif et simple visite : jamais le TPM du contrat ; le titulaire (mise en œuvre) n'est pas un TPM.
  assert.deepEqual(v.get('c3'), { state: 'aucun', tpms: [] });
});

test('partenaires vus depuis leurs contrats : contrats tenus, contrats suivis, TPM de leurs contrats', () => {
  const v = contractTpmViews(contracts, links, partners);
  const p = partnerContracts(contracts, v);
  assert.deepEqual(p.get('aina').held.map((c) => c.id), ['c1']);
  assert.deepEqual(p.get('aina').tpms, [{ id: 'rano', name: 'RANO Control' }]);
  assert.deepEqual(p.get('rano').monitored.map((c) => [c.id, c.holderName]), [['c1', 'ASSOCIATION AINA']]);
  assert.deepEqual(p.get('rano').held, []);
  // Un TPM titulaire de son propre contrat : tenu ET suivi, sans être son propre TPM.
  assert.deepEqual([p.get('sahy').held.length, p.get('sahy').monitored.length, p.get('sahy').tpms.length], [1, 1, 0]);
  assert.deepEqual(p.get('miaro').tpms, []);
  // Chaque contrat tenu dit s'il a un TPM (« Interne » seulement pour un contrat tenu sans TPM).
  assert.deepEqual(p.get('aina').held.map((c) => [c.id, c.hasTpm]), [['c1', true]]);
  assert.deepEqual(p.get('miaro').held.map((c) => [c.id, c.hasTpm]), [['c3', false]]);
  assert.deepEqual(p.get('sahy').held.map((c) => [c.id, c.hasTpm]), [['c2', true]], 'un TPM titulaire suit son propre contrat');
  assert.equal('hasTpm' in p.get('rano').monitored[0], false, 'contrats suivis : forme inchangée');
});

test('n° affiché d\'un contrat : FLA, sinon numéro interne', () => {
  assert.equal(contractNo(contracts[0]), 'FLA-AIN-1');
  assert.equal(contractNo(contracts[1]), 'CTR-2');
  assert.equal(contractNo(null), null);
});

test('un TPM titulaire de son propre contrat le SUIT encore après sa première facture ou son premier plan', () => {
  const own = [{ partnerId: 'sahy', contractId: 'c2', via: ['titulaire', 'rapport'] }];
  const v = contractTpmViews([contracts[1]], own, partners);
  assert.deepEqual(v.get('c2'), { state: 'rattache', tpms: [{ id: 'sahy', name: 'SAHY Monitoring', via: ['rapport'] }] });
  const p = partnerContracts([contracts[1]], v);
  assert.deepEqual([p.get('sahy').held.map((c) => c.id), p.get('sahy').monitored.map((c) => c.id), p.get('sahy').tpms], [['c2'], ['c2'], []]);
});

test('verrou d\'écriture d\'un contrat : FOR NO KEY UPDATE (les clés étrangères vers lui passent), FOR UPDATE pour la suppression seule', async () => {
  const repo = require('../src/modules/contracts/contracts.repository');
  const sqlOf = async (opts) => {
    let sql = '';
    await repo.getContract({ query: async (text) => { sql = text; return { rows: [] }; } }, 't', 'c1', opts);
    return sql.trim();
  };
  assert.match(await sqlOf({ forUpdate: true }), /FOR NO KEY UPDATE OF c$/);
  assert.match(await sqlOf({ forUpdate: true, forDelete: true }), /\bFOR UPDATE OF c$/);
  assert.doesNotMatch(await sqlOf({ forUpdate: true, forDelete: true }), /NO KEY/);
  assert.doesNotMatch(await sqlOf({}), /FOR (NO KEY )?UPDATE/);
  // Aucune colonne de clé dans un UPDATE de contrat : listée (même inchangée), elle reprendrait la ligne FOR UPDATE.
  const keys = new Set(repo.CONTRACT_KEY_COLUMNS);
  assert.deepEqual(Object.values(repo.CONTRACT_UPDATE_COLUMNS).filter((c) => keys.has(c)), []);
  let sql = '';
  const all = Object.fromEntries(Object.keys(repo.CONTRACT_UPDATE_COLUMNS).map((k) => [k, null]));
  await repo.updateContract({ query: async (text) => { sql = text; return { rowCount: 1 }; } }, 't', 'c1', 1, all);
  const set = sql.slice(sql.indexOf('SET') + 3, sql.indexOf('WHERE'));
  for (const k of repo.CONTRACT_KEY_COLUMNS) assert.doesNotMatch(set, new RegExp(`\\b${k}\\s*=`), k);
});
