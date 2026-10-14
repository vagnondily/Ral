/**
 * Concepteur de rapport (lot 7a) : tout libellé du catalogue publié au client
 * (groupes, jeux de données, colonnes, vues, chiffres clés, variables) a son
 * anglais dans le dictionnaire de l'interface (traduit par tr()) ; les phrases
 * construites par le serveur existent dans les deux langues.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { catalogForClient } = require('../src/modules/reports/catalog');
const { VARIABLES } = require('../src/modules/reports/reportModel');
const { PHRASES } = require('../src/modules/reports/phrases');
const { SYSTEM_TEMPLATES } = require('../src/modules/reports/reportTemplates');

const loadEn = async (t) => {
  const file = path.join(__dirname, '../../web/src/locales/en.js');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return (await import(pathToFileURL(file).href)).default;
};

test('catalogue : groupes, jeux, colonnes, chiffres clés et variables ont leur anglais', async (t) => {
  const en = await loadEn(t); if (!en) return;
  const c = catalogForClient();
  const missing = new Set();
  const need = (s) => { if (s && !Object.prototype.hasOwnProperty.call(en, s)) missing.add(s); };
  c.groups.forEach((g) => need(g.label));
  for (const d of Object.values(c.datasets)) {
    need(d.label);
    d.columns.forEach((col) => need(col.label));
    if (d.reason) need(d.reason);
  }
  for (const k of Object.values(c.kpis)) need(k.label);
  Object.values(VARIABLES).forEach(need);
  assert.deepEqual([...missing], [], `phrases sans anglais : ${[...missing].join(' | ')}`);
});

test('modèles système : titres, textes d\'exemple, en-têtes et pieds ont leur anglais', async (t) => {
  const en = await loadEn(t); if (!en) return;
  const missing = new Set();
  const need = (s) => { if (s && !Object.prototype.hasOwnProperty.call(en, s)) missing.add(s); };
  const visit = (b) => {
    const p = b.params || {};
    need(p.text); need(p.title); need(p.figure && p.figure.title);
    for (const n of (p.doc && p.doc.nodes) || []) for (const s of [...(n.c || []), ...(n.items || []).flat()]) if (!s.v) need(s.x.trim() ? s.x : null);
    if (b.type === 'repeat') p.blocks.forEach(visit);
    if (b.type === 'columns') p.cols.forEach((col) => col.forEach(visit));
  };
  for (const tpl of SYSTEM_TEMPLATES) {
    need(tpl.name); need(tpl.description);
    tpl.content.blocks.forEach(visit);
    for (const band of [tpl.content.page.header, tpl.content.page.footer]) for (const e of band.elements) if (e.kind === 'text') need(e.text);
  }
  assert.deepEqual([...missing], [], `phrases sans anglais : ${[...missing].join(' | ')}`);
});

test('phrases du serveur : mêmes clés en français et en anglais', () => {
  assert.deepEqual(Object.keys(PHRASES.en).sort(), Object.keys(PHRASES.fr).sort());
  for (const k of Object.keys(PHRASES.fr)) assert.equal(typeof PHRASES.en[k], typeof PHRASES.fr[k], k);
  // Dictionnaires imbriqués (raisons, signaux, niveaux…) : mêmes clés (sauf rbm, traduction de libellés).
  for (const k of Object.keys(PHRASES.fr)) {
    if (k === 'rbm' || typeof PHRASES.fr[k] !== 'object') continue;
    assert.deepEqual(Object.keys(PHRASES.en[k]).sort(), Object.keys(PHRASES.fr[k]).sort(), k);
  }
});

test('phrases à paramètres du serveur montrées dans les rapports (parcours, état de la configuration, alertes) : anglais présent', async (t) => {
  const en = await loadEn(t); if (!en) return;
  const { EVENT_TEXT } = require('../src/modules/partners/partnerSheet');
  const { evaluateHealth } = require('../src/modules/settings/healthRules');
  const { buildAlerts } = require('../src/modules/dashboards/alertsMath');
  const missing = new Set();
  const need = (s) => { if (s && !Object.prototype.hasOwnProperty.call(en, s)) missing.add(s); };
  Object.values(EVENT_TEXT).forEach(need);
  const zero = { areas: { total: 10, communes: 4, communesWithPcode: 4 }, sites: { total: 5, withoutPcode: 0, withoutOffice: 0 }, queue: {}, submissions: { total: 0 }, tpm: { active: 0 }, profile: { currency: 'MGA', center: true }, validators: 3 };
  const many = {
    areas: { total: 10, communes: 4, communesWithPcode: 2 }, detachedZones: 2, sites: { total: 5, withoutPcode: 2, withoutOffice: 1 }, officesWithoutPerimeter: 1, activityWithoutMmr: 1,
    formsWithoutActivity: 1, formsActive: 2, queue: { entries: 3, sitesOcc: 1, submissionsOcc: 2 }, submissions: { total: 9, withoutOffice: 2, monthTotal: 5, monthWithoutCommune: 2, month: '2026-03' },
    tpm: { active: 2, withoutAgent: 1, withoutContract: 1, contractsWithoutLine: 1 }, draftPlansPast: 1, monthsWithoutRate: 1, profile: { currency: null, center: false }, validators: 1,
  };
  for (const c of [zero, many]) for (const r of evaluateHealth(c)) need(r.message.text);
  const alerts = buildAlerts({
    consolidationRows: [{ contractId: 'c', numero: 'N', overspent: true, budget: 1, actual: 2 }, { contractId: 'd', numero: 'M', budget: 10, actual: 1, pendingValidation: 20 },
      { contractId: 'e', numero: 'O', budget: 10, actual: 1, projectedOverrun: 5, projectedTotal: 15 }],
    contracts: [{ id: 'x', numero: 'X', status: 'en_validation', amendmentPending: true }, { id: 'y', numero: 'Y', status: 'actif', dateFin: '2026-01-01' }, { id: 'z', numero: 'Z', status: 'actif', dateFin: '2026-04-01' }],
    reports: [{ status: 'soumis', kind: 'technique', actions: { decide: true } }, { status: 'soumis', kind: 'financier', actions: { decide: true } }],
    field: { overall: { active: 10, rate: 0.1, realise: 1 }, byProvider: [{ key: 'p', label: 'P', active: 5, rate: 0.2, realise: 1 }, { key: 'non_affecte', total: 2 }] },
    today: '2026-03-15',
  });
  for (const a of alerts) { need(a.title); need(a.detail); need(a.cat); }
  assert.deepEqual([...missing], [], `phrases sans anglais : ${[...missing].join(' | ')}`);
});

test('pied de figure : effectifs « n = … » (nLabel) et ligne de source traduits en anglais', async (t) => {
  const en = await loadEn(t); if (!en) return;
  const { GROUPS } = require('../src/modules/reports/catalog');
  const { phrases } = require('../src/modules/reports/phrases');
  // Effectifs renvoyés par les mises en forme (en français, traduits par l'interface).
  const dir = path.join(__dirname, '../src/modules/reports/catalog');
  const labels = new Set();
  for (const f of fs.readdirSync(dir)) {
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/nLabel: '([^']+)'/g)) labels.add(m[1]);
  }
  assert.ok(labels.size > 10);
  const missing = [...labels].filter((s) => !Object.prototype.hasOwnProperty.call(en, s));
  assert.deepEqual(missing, [], `effectifs sans anglais : ${missing.join(' | ')}`);
  // « MEMS — groupe » : le groupe du catalogue est nommé en anglais dans un rapport anglais.
  for (const g of GROUPS) assert.notEqual(phrases('en').source(g.label), `MEMS — ${g.label}`, g.label);
  assert.equal(phrases('fr').source('Couverture et plan'), 'MEMS — Couverture et plan');
});
