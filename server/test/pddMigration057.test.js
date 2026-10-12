/**
 * Migration 057 : la normalisation SQL des modalités reprend EXACTEMENT les
 * synonymes de l'import (pddImport.MODALITIES) — une dérive entre les deux
 * laisserait en base une valeur que l'import aurait ramenée à sa forme canonique.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('migration 057 : mêmes synonymes de modalité que l\'import (aucune dérive)', () => {
  const { MODALITIES, modalityKey } = require('../src/modules/pdd/pddImport');
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/057_pdd_modality_check.sql'), 'utf8');
  const lists = {};
  for (const m of sql.matchAll(/WHEN k IN \(([^)]*)\) THEN '(\w+)'/g)) lists[m[2]] = m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(lists, MODALITIES);
  assert.match(sql, /CHECK \(modality IS NULL OR modality IN \('Inkind', 'CBT', 'Mixte'\)\)/);
  // La clé SQL (translate + lower + [^a-z0-9]) suit la clé de l'import sur les cas réels.
  assert.equal(modalityKey(' Transfert Monétaire '), 'transfertmonetaire');
  assert.equal(modalityKey('Dénrées'), 'denrees');
});
