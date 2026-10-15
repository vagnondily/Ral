const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { rbmCounts } = require('../src/modules/tpm/rbmSummary');

// Compteurs RBM des écrans (web/src/lib/rbmCounts.js) lus dans la réponse de /rbm/counts :
// mêmes chiffres que l'ancien calcul du navigateur sur la liste complète des sites.
const file = path.join(__dirname, '../../web/src/lib/rbmCounts.js');
const load = async (t) => {
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};

// L'ancien calcul des écrans (Synthèse, Couverture & performance), ligne à ligne.
function oldScreenStats(rows) {
  const s = { total: 0, due: 0, elevee: 0, moyenne: 0, faible: 0 };
  for (const x of rows || []) { s.total += 1; s[x.riskLevel] = (s[x.riskLevel] || 0) + 1; if (x.due) s.due += 1; }
  return s;
}

test('compteurs RBM des écrans : la réponse du serveur redonne les chiffres calculés avant dans le navigateur', async (t) => {
  const v = await load(t); if (!v) return;
  const rows = [
    { riskLevel: 'elevee', due: true, toPlan: true, forbidden: false },
    { riskLevel: 'elevee', due: true, toPlan: false, forbidden: true },
    { riskLevel: 'faible', due: false, toPlan: false, forbidden: false },
    { riskLevel: 'moyenne', due: true, toPlan: true, forbidden: false },
  ];
  const s = v.rbmStatsOf(rbmCounts(rows));
  const old = oldScreenStats(rows);
  for (const k of ['total', 'due', 'elevee', 'moyenne', 'faible']) assert.equal(s[k], old[k], k);
  assert.equal(s.toPlan, rows.filter((x) => x.toPlan).length); // Affectation & visites
  assert.equal(s.dueOpen, rows.filter((x) => x.due && !x.forbidden).length); // Priorités du mois
});

test('compteurs RBM des écrans : réponse absente → zéros (comme une liste vide)', async (t) => {
  const v = await load(t); if (!v) return;
  assert.deepEqual(v.rbmStatsOf(null), { total: 0, due: 0, dueOpen: 0, toPlan: 0, elevee: 0, moyenne: 0, faible: 0 });
  assert.deepEqual(v.rbmStatsOf(null), oldScreenStats([]) && { ...oldScreenStats([]), dueOpen: 0, toPlan: 0 });
});
