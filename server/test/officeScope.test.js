/**
 * Périmètre d'un bureau (common/officeScope) — pur : le bureau et TOUTES ses antennes, à tous les
 * niveaux (comme officeTreeSql des tableaux de bord) ; bureau national = tout ; bureau racine du
 * suivi interne.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { officeScopeIds, rootOfficeOf } = require('../src/modules/common/officeScope');

// Hiérarchie des données de démonstration : Bureau Fort Dauphin › Antenne Ambovombe › {Bekily, Tsihombe}.
const offices = [
  { id: 'nat', name: 'Bureau Antananarivo', national: true },
  { id: 'fd', name: 'Bureau Fort Dauphin', parentId: null },
  { id: 'amb', name: 'Antenne Ambovombe', parentId: 'fd' },
  { id: 'bek', name: 'Antenne Bekily', parentId: 'amb' },
  { id: 'tsi', name: 'Antenne Tsihombe', parentId: 'amb' },
  { id: 'amo', name: 'Antenne Amboasary', parentId: 'fd' },
  { id: 'tul', name: 'Bureau Toliara', parentId: null },
];

test('périmètre : le bureau et toutes ses antennes, à tous les niveaux', () => {
  assert.deepEqual([...officeScopeIds(offices, 'fd')].sort(), ['amb', 'amo', 'bek', 'fd', 'tsi']);
  assert.deepEqual([...officeScopeIds(offices, 'amb')].sort(), ['amb', 'bek', 'tsi']);
  assert.deepEqual([...officeScopeIds(offices, 'bek')], ['bek']);
  assert.equal(officeScopeIds(offices, 'nat'), null);          // national : tout le registre
  assert.equal(officeScopeIds(offices, null), null);           // pas de filtre
  assert.deepEqual([...officeScopeIds(offices, 'inconnu')], ['inconnu']); // bureau inconnu : aucun site
  // Un cycle de parenté ne boucle jamais.
  const cyc = [{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }];
  assert.deepEqual([...officeScopeIds(cyc, 'a')].sort(), ['a', 'b']);
});

test('suivi interne : le bureau racine d\'une antenne (jamais le bureau national)', () => {
  assert.deepEqual(rootOfficeOf(offices, 'bek'), { id: 'fd', name: 'Bureau Fort Dauphin' });
  assert.deepEqual(rootOfficeOf(offices, 'fd'), { id: 'fd', name: 'Bureau Fort Dauphin' });
  assert.deepEqual(rootOfficeOf([...offices, { id: 'x', name: 'Bureau X', parentId: 'nat' }], 'x'), { id: 'x', name: 'Bureau X' });
  assert.equal(rootOfficeOf(offices, null), null);
  assert.deepEqual(rootOfficeOf([{ id: 'a', parentId: 'b', name: 'A' }, { id: 'b', parentId: 'a', name: 'B' }], 'a').id, 'b');
});
