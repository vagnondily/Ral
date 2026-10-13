const test = require('node:test');
const assert = require('node:assert/strict');
const { orgKey, buildPartnerIndex, resolvePartner, buildAgentIndex, resolveAgent } = require('../src/modules/common/partyMatch');

const partners = [
  { id: 'p1', name: 'Association TOMPY', shortName: null },
  { id: 'p2', name: 'LALANA', shortName: null },
  { id: 'p3', name: 'YPA', shortName: null },
  { id: 'p4', name: 'Organisation Non Gouvernementale AINA', shortName: 'ONG AINA' },
];
const pIndex = buildPartnerIndex(partners);

test('clé d\'organisation : sans accents, casse ni mots génériques', () => {
  assert.equal(orgKey('Association TOMPY'), 'tompy');
  assert.equal(orgKey('ONG  Aïna'), 'aina');
});

test('partenaire : code avec libellé SPSS, texte « organisation - lieu », sigle — appliqué seulement si exact', () => {
  assert.equal(resolvePartner(pIndex, { raw: '2', label: 'LALANA' }).partner.id, 'p2');
  assert.equal(resolvePartner(pIndex, { raw: 'TOMPY - Ampanihy' }).partner.id, 'p1');
  assert.equal(resolvePartner(pIndex, { raw: 'Lalana - Manakara' }).partner.id, 'p2');
  assert.equal(resolvePartner(pIndex, { raw: '4', label: 'ONG AINA' }).partner.id, 'p4');
  const near = resolvePartner(pIndex, { raw: '6', label: 'YP' });
  assert.equal(near.status, 'propose');
  assert.equal(near.partner, null);
  assert.equal(near.candidates[0].id, 'p3');
  assert.equal(resolvePartner(pIndex, { raw: '999', label: 'Autres' }).status, 'introuvable');
  assert.equal(resolvePartner(pIndex, { raw: '' }).status, 'vide');
});

test('partenaire : deux organisations de même nom → ambigu, rien d\'appliqué', () => {
  const idx = buildPartnerIndex([{ id: 'a', name: 'TOMPY' }, { id: 'b', name: 'Association Tompy' }]);
  const r = resolvePartner(idx, { raw: 'TOMPY' });
  assert.equal(r.status, 'ambigu');
  assert.equal(r.partner, null);
});

test('agent : code d\'enquêteur puis nom exact, dans le partenaire reconnu ; jamais un nom seulement proche', () => {
  const agents = [
    { id: 'a1', partnerId: 'p1', name: 'Rakoto Jean', code: 'E-07' },
    { id: 'a2', partnerId: 'p2', name: 'Rakoto Jean', code: null },
    { id: 'a3', partnerId: 'p2', name: 'Rasoa Marie', code: '37' },
  ];
  const idx = buildAgentIndex(agents);
  assert.equal(resolveAgent(idx, { raw: 'e 07', partnerId: 'p1' }).agent.id, 'a1');
  assert.equal(resolveAgent(idx, { raw: '37', label: 'Rasoa Marie' }).agent.id, 'a3'); // nom exact, unique
  // Code seul sans partenaire reconnu, ou code d'un autre prestataire : proposé, jamais appliqué.
  const noPartner = resolveAgent(idx, { raw: 'E-07' });
  assert.equal(noPartner.status, 'propose');
  assert.equal(noPartner.agent, null);
  assert.equal(resolveAgent(idx, { raw: 'E-07', partnerId: 'p2' }).status, 'propose');
  // Bon code, bon partenaire, mais le libellé nomme quelqu'un d'autre : proposé.
  const other = resolveAgent(idx, { raw: '37', label: 'Ratsimba Hery', partnerId: 'p2' });
  assert.equal(other.status, 'propose');
  assert.equal(other.candidates[0].id, 'a3');
  assert.equal(resolveAgent(idx, { raw: '5', label: 'Rakoto Jean', partnerId: 'p2' }).agent.id, 'a2');
  assert.equal(resolveAgent(idx, { raw: '5', label: 'Rakoto Jean' }).status, 'ambigu');
  assert.equal(resolveAgent(idx, { raw: '9', label: 'Rakoto Jeanne' }).status, 'introuvable');
});

test('relecture : un code tenu par quelqu\'un d\'autre que le libellé reçu n\'est jamais proposé', () => {
  const idx = buildAgentIndex([
    { id: 'b1', partnerId: 'p1', name: 'Randria Paul', code: '85' },
    { id: 'b2', partnerId: 'p1', name: 'Rabe Luc', code: '12' },
    { id: 'b3', partnerId: 'p2', name: 'Rabe Luc', code: '40' },
  ]);
  // Dans le partenaire : le code 12 est à Rabe Luc, mais le libellé nomme Randria Paul (même partenaire) → lui.
  const named = resolveAgent(idx, { raw: '12', label: 'Randria Paul', partnerId: 'p1' });
  assert.equal(named.status, 'nom');
  assert.equal(named.agent.id, 'b1');
  // Partenaire de la fiche sans ce code : le porteur du code 85 ailleurs s'appelle autrement → introuvable.
  assert.equal(resolveAgent(idx, { raw: '85', label: 'Rakotomalala Hery', partnerId: 'p3' }).status, 'introuvable');
  // Même personne numérotée autrement dans une autre fiche : proposée (libellé identique).
  const same = resolveAgent(idx, { raw: '40', label: 'Rabe  luc', partnerId: 'p3' });
  assert.equal(same.status, 'propose');
  assert.deepEqual(same.candidates.map((a) => a.id), ['b3']);
  // Sans libellé : le code seul reste une proposition.
  assert.equal(resolveAgent(idx, { raw: '85' }).status, 'propose');
});

test('relecture 2 : un même nom écrit « NOM Prénom » ou « Prénom NOM » désigne la même personne', () => {
  const idx = buildAgentIndex([{ id: 'c1', partnerId: 'p1', name: 'RABE Luc', code: '7' }]);
  const r = resolveAgent(idx, { raw: '99', label: 'Luc Rabe', partnerId: 'p1' });
  assert.equal(r.status, 'nom');
  assert.equal(r.agent.id, 'c1');
});
