/**
 * Règles de visualisation du concepteur (web/src/lib/reportViz.js, lot 7a) — module web pur,
 * importé ici comme webCharts.test.js : axe à zéro, palette en ordre fixe, jamais de rouge pour
 * une série, « Autres » au-delà de 7 catégories, légende dès 2 séries, pied de figure.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const load = async (t) => {
  const file = path.join(__dirname, '../../web/src/lib/reportViz.js');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};

test('axe des valeurs : zéro toujours compris ; pourcentages sur 0–100 ; écart négatif symétrique sur zéro', async (t) => {
  const v = await load(t); if (!v) return;
  const s = v.zeroScale([137, 12, 40]);
  assert.equal(s.min, 0); assert.ok(s.max >= 137); assert.equal(s.ticks[0], 0);
  assert.deepEqual(v.zeroScale([12.5, 88], { percent: true }), { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] });
  const big = v.zeroScale([112], { percent: true });
  assert.equal(big.min, 0); assert.ok(big.max >= 112);
  const neg = v.zeroScale([-2.3, 7.9]);
  assert.ok(neg.min <= -2.3 && neg.max >= 7.9);
  assert.ok(neg.ticks.includes(0), 'zéro est une graduation');
  assert.deepEqual(v.zeroScale([]), { min: 0, max: 1, ticks: [0, 1] });
  // Jamais d'échelle brisée : graduations régulières.
  const steps = neg.ticks.slice(1).map((x, i) => Math.round((x - neg.ticks[i]) * 1e9));
  assert.equal(new Set(steps).size, 1);
});

test('couleurs : ordre fixe de la palette validée, prévu / réalisé ambre et bleu, jamais de rouge', async (t) => {
  const v = await load(t); if (!v) return;
  assert.deepEqual(v.PALETTE, ['#0f6cbd', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6']);
  assert.deepEqual(v.seriesColors(['a', 'b', 'c']), { a: '#0f6cbd', b: '#eb6834', c: '#1baf7a' });
  assert.deepEqual(v.seriesColors(['x']), { x: '#0f6cbd' });
  assert.deepEqual(v.seriesColors(['planned', 'done']), { planned: '#c77700', done: '#0f6cbd' });
  const many = v.seriesColors(Array.from({ length: 20 }, (_, i) => `s${i}`));
  for (const c of Object.values(many)) assert.equal(v.isReservedRed(c), false, c);
  for (const c of [...v.PALETTE, ...v.RAMP, v.SINGLE, ...Object.values(v.PLAN_ACTUAL)]) assert.equal(v.isReservedRed(c), false, c);
  assert.equal(v.isReservedRed('#D13438'), true);
});

test('plus de 7 catégories : les 6 plus grandes et « Autres » (somme du reste) ; lignes de total ignorées', async (t) => {
  const v = await load(t); if (!v) return;
  const rows = Array.from({ length: 10 }, (_, i) => ({ label: `c${i}`, n: i + 1 }));
  const g = v.groupOthers([...rows, { label: 'Total', n: 55, _total: true }], { valueKeys: ['n'], labelKey: 'label', othersLabel: 'Others' });
  assert.equal(g.length, 7);
  assert.deepEqual(g.slice(0, 6).map((r) => r.n), [10, 9, 8, 7, 6, 5]);
  assert.deepEqual([g[6].label, g[6].n, g[6].count], ['Others', 1 + 2 + 3 + 4, 4]);
  assert.equal(v.groupOthers(rows.slice(0, 7), { valueKeys: ['n'], labelKey: 'label' }).length, 7);
});

test('légende dès 2 séries ; séries d\'un graphique (mesure, mesures déclarées, 3 au plus)', async (t) => {
  const v = await load(t); if (!v) return;
  assert.equal(v.legendNeeded(1), false); assert.equal(v.legendNeeded(2), true);
  const data = { columns: [{ key: 'month', type: 'month' }, { key: 'planned', type: 'int' }, { key: 'done', type: 'int' }, { key: 'sitesActive', type: 'int' }, { key: 'coverage', type: 'pct' }, { key: 'm:2026-01', type: 'pct' }] };
  assert.deepEqual(v.chartSeries({ measures: ['planned', 'done'] }, data).map((c) => c.key), ['planned', 'done']);
  assert.deepEqual(v.chartSeries({}, data, { measure: 'coverage' }).map((c) => c.key), ['coverage']);
  assert.deepEqual(v.chartSeries({}, data).map((c) => c.key), ['planned', 'done', 'sitesActive']);
  assert.equal(v.categoryColumn(data).key, 'month');
});

test('conseils de forme et pied de figure (numéro, source, n, date)', async (t) => {
  const v = await load(t); if (!v) return;
  assert.equal(v.viewAdvice('donut', { rows: 8 }), 'donut_too_many');
  assert.equal(v.viewAdvice('bar', { rows: 1, series: 1 }), 'single_value');
  assert.equal(v.viewAdvice('bar', { rows: 9 }), 'too_many_categories');
  assert.equal(v.viewAdvice('table', { rows: 90 }), null);
  assert.deepEqual(v.figureFoot({ source: 'MEMS — Suivi', n: 231, nLabel: 'soumissions', asOf: '2026-10' }), { source: 'MEMS — Suivi', n: 231, nLabel: 'soumissions', asOf: '2026-10' });
  assert.equal(v.figureFoot({ n: 3 }, { showN: false }).n, null);
  assert.equal(v.figureFoot({ source: 'auto' }, { source: 'Saisie' }).source, 'Saisie');
  assert.equal(v.rampColor(0, 10), v.RAMP[0]); assert.equal(v.rampColor(10, 10), v.RAMP[v.RAMP.length - 1]); assert.equal(v.rampColor(null, 10), null);
});

test('retour 87 : étiquettes de mois — toutes droites si elles tiennent, sinon inclinées, sinon une sur k ancrée sur la dernière', async (t) => {
  const v = await load(t); if (!v) return;
  const short = ['oct. 25', 'nov. 25', 'déc. 25', 'janv. 26', 'févr. 26', 'mars 26', 'avr. 26', 'mai 26', 'juin 26', 'juil. 26', 'août 26', 'sept. 26'];
  // 12 mois abrégés sur 584 px : chacun tient dans sa case de 48 px, rien n'est incliné ni retiré.
  const a = v.axisLabelLayout(short, { plotW: 584 });
  assert.deepEqual([a.show.length, a.rotate, a.every], [12, 0, 1]);
  // Les libellés longs d'avant (« Octobre 2025 ») ne tiennent pas : jamais côte à côte.
  const long = short.map((s) => `${s}xxxxxxx`);
  const b = v.axisLabelLayout(long, { plotW: 584 });
  assert.equal(b.rotate, -40);
  assert.ok(b.height > 20, 'place réservée sous l\'axe pour les étiquettes inclinées');
  // 36 mois serrés : une sur k, droites, la DERNIÈRE toujours montrée, aucun chevauchement.
  const many = Array.from({ length: 36 }, (_, i) => `m${String(i).padStart(2, '0')} 26`);
  const c = v.axisLabelLayout(many, { plotW: 584 });
  assert.equal(c.rotate, 0);
  assert.equal(c.show[c.show.length - 1], 35);
  const slot = 584 / 36;
  const w = v.labelWidth(many[0]);
  for (let k = 1; k < c.show.length; k += 1) assert.ok((c.show[k] - c.show[k - 1]) * slot >= w, 'deux étiquettes montrées ne se touchent pas');
  // Une seule catégorie : montrée telle quelle.
  assert.deepEqual(v.axisLabelLayout(['sept. 26'], { plotW: 584 }).show, [0]);
  assert.deepEqual(v.axisLabelLayout([], { plotW: 584 }).show, []);
});

test('retour 87 : période des données dite quand elle diffère de celle du rapport', async (t) => {
  const v = await load(t); if (!v) return;
  const sept = { from: '2026-09', to: '2026-09' };
  assert.deepEqual(v.dataScope({ period: sept, dataPeriod: { from: '2025-10', to: '2026-09' } }), { kind: 'months', n: 12, to: '2026-09' });
  assert.equal(v.dataScope({ period: sept, dataPeriod: sept }), null);
  assert.equal(v.dataScope({ period: sept }), null);
  assert.deepEqual(v.dataScope({ period: sept, dataPeriod: { from: '2026-01', to: '2026-12' } }), { kind: 'year', year: '2026' });
  assert.deepEqual(v.dataScope({ period: sept, dataPeriod: { from: '2025-01', to: '2025-06' } }), { kind: 'range', from: '2025-01', to: '2025-06' });
  // Une évolution mensuelle n'est jamais « trop de catégories ».
  assert.equal(v.viewAdvice('column', { rows: 12, timeSeries: true }), null);
  assert.equal(v.viewAdvice('column', { rows: 12 }), 'too_many_categories');
});
