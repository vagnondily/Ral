/**
 * Tiroir « Générer le plan de suivi » — règles pures du front (web/src/lib/planAuto.js) :
 * bureaux en arbre (toute antenne choisissable), décimales du CSV « base de budget » au séparateur
 * de la langue, libellé des unités de suivi interne.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const load = async (t) => {
  const file = path.join(__dirname, '../../web/src/lib/planAuto.js');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};
const tr = (s, p = {}) => s.replace(/\{(\w+)\}/g, (_, k) => String(p[k]));

test('bureaux en arbre : chaque antenne, à tous les niveaux, est proposée sous son bureau', async (t) => {
  const m = await load(t); if (!m) return;
  const list = m.officeOptions([
    { id: 'bek', name: 'Antenne Bekily', parentId: 'amb' },
    { id: 'fd', name: 'Bureau Fort Dauphin', parentId: null },
    { id: 'tsi', name: 'Antenne Tsihombe', parentId: 'amb' },
    { id: 'amb', name: 'Antenne Ambovombe', parentId: 'fd' },
    { id: 'amo', name: 'Antenne Amboasary', parentId: 'fd' },
    { id: 'nat', name: 'Bureau Antananarivo', national: true },
  ]);
  assert.deepEqual(list.map((o) => [o.id, o.depth]), [['nat', 0], ['fd', 0], ['amo', 1], ['amb', 1], ['bek', 2], ['tsi', 2]]);
  assert.equal(list.find((o) => o.id === 'nat').national, true);
  assert.match(list.find((o) => o.id === 'bek').label, /^ {4}↳ Antenne Bekily$/);
  // Parent absent ou cycle : jamais perdu.
  assert.deepEqual(m.officeOptions([{ id: 'a', name: 'A', parentId: 'b' }, { id: 'b', name: 'B', parentId: 'a' }]).map((o) => o.id).sort(), ['a', 'b']);
});

test('CSV « base de budget » : décimales au séparateur de la langue (Excel en français), libellé des bureaux', async (t) => {
  const m = await load(t); if (!m) return;
  assert.equal(m.csvDecimal(1.5, 'fr-FR'), '1,5');
  assert.equal(m.csvDecimal(1.5, 'en-GB'), '1.5');
  assert.equal(m.csvDecimal(2, 'fr-FR'), 2);
  assert.equal(m.csvDecimal(null), '');
  const preview = { byTpm: [
    { assigned: true, tpm: 'YPA', visits: 3, planned: 2, agentDays: 3, agentsPeak: 1, vehiclesPeak: 1,
      perMonth: [{ month: '2026-11', visits: 3, count: 2, agentDays: 3, agents: 1, vehiclesPeak: 1, vehiclesAvg: 0.7, workingDays: 20, workingDaysSource: 'mmr' }] },
    { assigned: false, tpm: null, officeName: 'Bureau Toliara', visits: 1, planned: 1, agentDays: 1, agentsPeak: 1, vehiclesPeak: 1,
      perMonth: [{ month: '2026-11', visits: 1, count: 1, agentDays: 1, agents: 1, vehiclesPeak: 1, vehiclesAvg: 1, workingDays: 20, workingDaysSource: 'parametre' }] },
  ] };
  const rows = m.budgetCsvRows(preview, tr, 'fr-FR');
  assert.equal(rows[1][7], '0,7');
  assert.equal(rows[3][0], 'Bureau Toliara (suivi interne)');
  assert.equal(rows[3][7], 1);
  assert.equal(m.unitLabel({ assigned: false }, tr), 'Bureau (suivi interne)');
});
