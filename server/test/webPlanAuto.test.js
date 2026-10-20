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
  assert.equal(rows[3][0], 'Interne — Bureau Toliara');
  assert.equal(rows[3][7], 1);
  assert.equal(m.unitLabel({ assigned: false }, tr), 'Interne (équipe S&E)');
});

test('jours de collecte : la même règle écrite partout (une journée par agent et par date), en français et en anglais', async (t) => {
  const root = path.join(__dirname, '../../web/src');
  const enFile = path.join(root, 'locales/en.js');
  if (!fs.existsSync(enFile)) { t.skip('web/ absent'); return; }
  const en = (await import(pathToFileURL(enFile).href)).default;
  // Littéraux tr('…') des écrans qui décrivent les jours de collecte (échappements \' rendus).
  const literals = (rel) => [...fs.readFileSync(path.join(root, rel), 'utf8').matchAll(/tr\('((?:[^'\\]|\\.)*)'/g)]
    .map((m) => m[1].replace(/\\'/g, '\''));
  const screens = ['pages/monitoring/FieldVisitsPage.jsx', 'pages/monitoring/CalcDocsPage.jsx', 'pages/tpm/PlanBudgetDrawer.jsx', 'pages/monitoring/PlanAutoDrawer.jsx'];
  const about = screens.flatMap((f) => literals(f).filter((s) => /jours? de (collecte|visite)|jour\(s\) de collecte|journée\(s\) de visite/i.test(s)).map((s) => [f, s]));
  assert.ok(about.length >= 6, `phrases trouvées : ${about.length}`);
  for (const [f, s] of about) {
    assert.ok(!/visites datées|visite\(s\) datée\(s\)/.test(s), `${f} : ancienne règle « visites datées » — ${s}`);
    assert.ok(Object.prototype.hasOwnProperty.call(en, s), `${f} : sans anglais — ${s}`);
    assert.ok(!/dated visits|dated visit\(s\)/i.test(en[s]), `${f} : ancienne règle en anglais — ${en[s]}`);
  }
  // La règle elle-même : carte, page des calculs et « Sites affectés » du budget prévisionnel.
  const rule = (f) => about.filter(([g]) => g === f).some(([, s]) => /une (journée )?par agent et par date/.test(s));
  for (const f of screens.slice(0, 3)) assert.ok(rule(f), `${f} : « une journée par agent et par date »`);
  // La différence avec les journées-agent du plan (visite de plusieurs jours) est dite, des deux côtés.
  const multi = about.filter(([, s]) => /plusieurs jours/.test(s));
  assert.ok(multi.some(([f]) => f.endsWith('PlanAutoDrawer.jsx')) && multi.some(([f]) => f.endsWith('CalcDocsPage.jsx')));
  for (const [, s] of multi) assert.match(en[s], /several days/);
});

test('mois courant de l\'écran = celui du serveur (jour local), jamais le jour UTC', async (t) => {
  const m = await load(t); if (!m) return;
  // 31 octobre 22 h 30 UTC = 1ᵉʳ novembre 1 h 30 à Madagascar.
  const late = new Date('2026-10-31T22:30:00Z');
  assert.equal(m.zonedDay(late), '2026-11-01');
  assert.equal(m.zonedDay(late, 'UTC'), '2026-10-31');
  assert.equal(m.zonedDay(late, 'Pas/UnFuseau'), '2026-10-31');
  // Horloge du serveur lue : elle seule compte.
  assert.deepEqual(m.planClock({ now: '2026-11', today: '2026-11-01', timeZone: 'Indian/Antananarivo' }, late), { now: '2026-11', today: '2026-11-01', source: 'server' });
  assert.deepEqual(m.planClock({ now: '2026-12' }, late), { now: '2026-12', today: '2026-12-01', source: 'server' });
  // Pas encore lue (ou illisible) : jour du fuseau de l'application, pas l'UTC.
  assert.deepEqual(m.planClock(null, late), { now: '2026-11', today: '2026-11-01', source: 'local' });
  assert.deepEqual(m.planClock({ now: '2026-13' }, late), { now: '2026-11', today: '2026-11-01', source: 'local' });
  // Période proposée : exercice courant depuis le mois courant ; exercice à venir : toute l'année.
  assert.deepEqual(m.defaultPeriod(2026, '2026-11'), { from: '2026-11', to: '2026-12' });
  assert.deepEqual(m.defaultPeriod('2027', '2026-11'), { from: '2027-01', to: '2027-12' });
  // Le tiroir lit l'horloge du serveur et ne calcule plus son mois en UTC.
  const src = fs.readFileSync(path.join(__dirname, '../../web/src/pages/monitoring/PlanAutoDrawer.jsx'), 'utf8');
  assert.match(src, /api\.planAutoClock\(\)/);
  assert.match(src, /planClock\(serverClock\)\.now/);
  assert.doesNotMatch(src, /toISOString\(\)\.slice\(0, 7\)|setUTCMonth/);
  assert.match(fs.readFileSync(path.join(__dirname, '../../web/src/api/client.js'), 'utf8'), /planAutoClock: \(\) => request\('\/api\/tpm\/plan-auto\/clock'\)/);
});
