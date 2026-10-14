const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const server = require('../src/modules/common/period');

// web/src/lib/period.js (module ES pur) testé ici, comme webCharts.test.js.
const load = async (t) => {
  const file = path.join(__dirname, '../../web/src/lib/period.js');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};
const byId = (list) => Object.fromEntries(list.map((p) => [p.id, p.period]));

test('préréglages : bornés au mois courant T, janvier – juin de l\'année précédente avant juillet', async (t) => {
  const m = await load(t); if (!m) return;
  for (const T of ['2026-01', '2026-06', '2026-07', '2026-10', '2026-12']) {
    for (const p of m.presets(T, '2026-01')) {
      assert.ok(p.period.from <= p.period.to, `${T} ${p.id} ordonné`);
      assert.ok(p.period.to <= T, `${T} ${p.id} ne dépasse pas T`);
    }
  }
  const oct = byId(m.presets('2026-10', '2026-07'));
  assert.deepEqual(oct.latest, { from: '2026-07', to: '2026-07' });
  assert.deepEqual(oct.this_month, { from: '2026-10', to: '2026-10' });
  assert.deepEqual(oct.last_month, { from: '2026-09', to: '2026-09' });
  assert.deepEqual(oct.this_quarter, { from: '2026-10', to: '2026-10' });
  assert.deepEqual(oct.prev_quarter, { from: '2026-07', to: '2026-09' });
  assert.deepEqual(oct.this_half, { from: '2026-07', to: '2026-10' });
  assert.equal(oct.prev_half, undefined, 'semestre précédent = janvier – juin : proposé une seule fois');
  assert.deepEqual(oct.jan_jun, { from: '2026-01', to: '2026-06' });
  assert.deepEqual(oct.ytd, { from: '2026-01', to: '2026-10' });
  assert.deepEqual(oct.last_year, { from: '2025-01', to: '2025-12' });
  assert.deepEqual(oct.last_12, { from: '2025-11', to: '2026-10' });
  const jun = byId(m.presets('2026-06'));
  assert.deepEqual(jun.jan_jun, { from: '2025-01', to: '2025-06' });
  assert.deepEqual(jun.prev_half, { from: '2025-07', to: '2025-12' });
  assert.deepEqual(jun.this_half, { from: '2026-01', to: '2026-06' });
  assert.equal(jun.latest, undefined, 'sans dernier mois connu');
  const jan = byId(m.presets('2026-01'));
  assert.deepEqual(jan.last_month, { from: '2025-12', to: '2025-12' });
  assert.deepEqual(jan.prev_quarter, { from: '2025-10', to: '2025-12' });
  assert.deepEqual(jan.jan_jun, { from: '2025-01', to: '2025-06' });
  const jul = byId(m.presets('2026-07'));
  assert.deepEqual(jul.jan_jun, { from: '2026-01', to: '2026-06' });
  const dec = byId(m.presets('2026-12', '2026-12'));
  assert.equal(dec.latest, undefined, 'dernier mois = mois courant : pas de doublon');
  assert.deepEqual(dec.this_quarter, { from: '2026-10', to: '2026-12' });
  // Documents (concepteur) : l'année civile entière est proposée en plus.
  assert.deepEqual(byId(m.presets('2026-10', null, { withFullYear: true })).this_year, { from: '2026-01', to: '2026-12' });
  // Paramètres des libellés en texte : tr() formate les nombres (« Année 2 025 » sinon).
  for (const p of m.presets('2026-10', '2026-07', { withFullYear: true })) {
    for (const v of [...Object.values(p.params || {}), ...Object.values((p.hint && p.hint.params) || {})]) {
      assert.equal(typeof v, 'string', `${p.id} : paramètre ${v} en texte`);
    }
  }
  assert.equal(m.presetOf({ from: '2026-01', to: '2026-06' }, m.presets('2026-10')), 'jan_jun');
  assert.equal(m.presetOf({ from: '2026-02', to: '2026-03' }, m.presets('2026-10')), null);
});

test('periodLabel : parité web / serveur sur 20 cas, français et anglais, formes longue et courte', async (t) => {
  const m = await load(t); if (!m) return;
  const cases = [
    ['2026-07', '2026-07'], ['2026-01', '2026-06'], ['2026-01', '2026-12'], ['2025-10', '2026-03'], ['2025-11', '2026-10'],
    ['2026-02', '2026-02'], ['2026-08', '2026-09'], ['2024-01', '2024-12'], ['2024-01', '2025-12'], ['2026-12', '2027-01'],
    ['2026-03', '2026-05'], ['2026-05', '2026-05'], ['2021-11', '2026-10'], ['2026-04', '2026-12'], ['2026-01', '2026-11'],
    ['2025-12', '2025-12'], ['2026-06', '2026-07'], ['2023-02', '2023-08'], ['2026-09', '2026-10'], ['2026-10', '2026-10'],
  ];
  assert.equal(cases.length, 20);
  for (const [from, to] of cases) {
    for (const lang of ['fr', 'en']) {
      for (const short of [false, true]) {
        assert.equal(m.periodLabel({ from, to }, lang, { short }), server.periodLabel({ from, to }, lang, { short }), `${from}…${to} ${lang} ${short}`);
      }
    }
  }
  assert.equal(m.periodLabel({ from: '2026-01', to: '2026-06' }, 'fr', { short: true }), 'Janv. – juin 2026');
});

test('URL : lecture et écriture de la période dans le hash, autres paramètres gardés', async (t) => {
  const m = await load(t); if (!m) return;
  const h = m.writeHashPeriod('#/dashboard/couverture', { from: '2026-01', to: '2026-06' });
  assert.equal(h, '#/dashboard/couverture?from=2026-01&to=2026-06');
  assert.deepEqual(m.readHashPeriod(h), { from: '2026-01', to: '2026-06' });
  assert.equal(m.writeHashPeriod('#/x?tab=2&month=2026-07', null), '#/x?tab=2');
  assert.equal(m.writeHashPeriod('#/x?tab=2', { from: '2026-07', to: '2026-07' }), '#/x?tab=2&from=2026-07&to=2026-07');
  assert.deepEqual(m.readHashPeriod('#/x?month=2026-07'), { from: '2026-07', to: '2026-07' });
  assert.equal(m.readHashPeriod('#/x'), null);
  assert.equal(m.readHashPeriod('#/x?from=2026-06&to=2026-01'), null, 'ordre inversé : ignoré');
  assert.equal(m.readHashPeriod('#/x?from=2020-01&to=2026-01'), null, 'au-delà de 60 mois : ignoré');
  assert.equal(m.readHashPeriod('#/x?from=2026-13&to=2026-14'), null);
});

test('normalize, monthsOf, summarizeCounts, session', async (t) => {
  const m = await load(t); if (!m) return;
  assert.deepEqual(m.normalize({ from: '2026-06', to: '2026-01' }), { from: '2026-01', to: '2026-06' });
  assert.equal(m.normalize({ from: 'x', to: '2026-01' }), null);
  assert.deepEqual(m.monthsOf({ from: '2025-12', to: '2026-02' }), ['2025-12', '2026-01', '2026-02']);
  assert.deepEqual(m.summarizeCounts({ from: '2026-01', to: '2026-06' }, { '2026-01': 50, '2026-02': 70, '2026-03': 0, '2026-05': 54, '2026-06': 50, '2026-07': 99 }),
    { months: 6, submissions: 224, emptyMonths: 2 });
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  m.writeSessionPeriod(storage, { from: '2026-01', to: '2026-06' });
  assert.deepEqual(m.readSessionPeriod(storage), { from: '2026-01', to: '2026-06' });
  m.writeSessionPeriod(storage, null);
  assert.equal(m.readSessionPeriod(storage), null);
  storage.setItem(m.SESSION_KEY, '{oops');
  assert.equal(m.readSessionPeriod(storage), null, 'valeur illisible ignorée');
  const broken = { getItem: () => { throw new Error('bloqué'); }, setItem: () => { throw new Error('bloqué'); } };
  assert.equal(m.readSessionPeriod(broken), null);
  assert.doesNotThrow(() => m.writeSessionPeriod(broken, { from: '2026-01', to: '2026-01' }));
  assert.deepEqual(m.periodQuery({ from: '2026-01', to: '2026-06' }), { from: '2026-01', to: '2026-06' });
  assert.deepEqual(m.periodQuery(null), {});
});

test('periodParams (client API, pq) : plage → from/to, ancien mois → month, rien → aucun paramètre', async (t) => {
  const m = await load(t); if (!m) return;
  assert.deepEqual(m.periodParams({ from: '2026-01', to: '2026-06' }), { from: '2026-01', to: '2026-06' });
  assert.deepEqual(m.periodParams({ from: '2026-07', to: '2026-07', extra: 1 }), { from: '2026-07', to: '2026-07' });
  assert.deepEqual(m.periodParams('2026-07'), { month: '2026-07' }, 'appelant pas encore passé à la plage');
  for (const v of [null, undefined, '', {}, { from: '2026-01' }, 0]) assert.deepEqual(m.periodParams(v), {}, String(JSON.stringify(v)));
  // Le serveur lit ?month=M exactement comme ?from=M&to=M (parsePeriod).
  const fromMonth = server.parsePeriod(m.periodParams('2026-07'));
  const fromRange = server.parsePeriod(m.periodParams({ from: '2026-07', to: '2026-07' }));
  assert.deepEqual(fromMonth, fromRange);
  assert.deepEqual(server.parsePeriod(m.periodParams(null)), { ok: true, period: null });
});

test('chevauchement (jumeau du serveur) et vues enregistrées : « AAAA-MM » converti, jamais rejeté', async (t) => {
  const m = await load(t); if (!m) return;
  const p = { from: '2026-02', to: '2026-06' };
  for (const [s, e] of [['2026-01-01', '2026-03-01'], ['2026-01-01', null], ['2026-06', null], ['2026-07-01', '2026-09-01'], ['2026-02-15', '2026-02-15']]) {
    assert.equal(m.overlaps(p, s, e), server.overlaps(p, s, e), `${s}…${e}`);
  }
  assert.equal(m.overlaps(null, '2020-01'), true);
  assert.deepEqual(m.periodFromSaved('2026-07'), { from: '2026-07', to: '2026-07' });
  assert.deepEqual(m.periodFromSaved({ from: '2026-01', to: '2026-06', extra: 1 }), { from: '2026-01', to: '2026-06' });
  assert.equal(m.periodFromSaved(''), '');
  assert.equal(m.periodFromSaved('n\'importe quoi'), '');
  assert.equal(m.periodFromSaved({ from: '2026-06', to: '2026-01' }), '');
});

test('erreurs de période du serveur : phrase française à traduire, mêmes codes que le serveur', async (t) => {
  const m = await load(t); if (!m) return;
  assert.deepEqual(Object.keys(m.PERIOD_ERRORS).sort(), Object.keys(server.PERIOD_MESSAGES).sort());
  const e = m.periodError({ code: 'period_span', maxSpan: 60, span: 72 });
  assert.equal(e.text, 'Période trop longue : {maxSpan} mois au plus (demandé : {span}).');
  assert.equal(e.params.span, 72);
  assert.equal(m.periodError({ code: 'autre' }), null);
  // Même phrase que le serveur, une fois les variables remplacées.
  const fill = (s, p) => s.replace(/\{(\w+)\}/g, (_, k) => p[k]);
  assert.equal(fill(m.PERIOD_ERRORS.period_order, { from: '2026-06', to: '2026-01' }), server.PERIOD_MESSAGES.period_order({ from: '2026-06', to: '2026-01' }));
  assert.equal(fill(m.PERIOD_ERRORS.period_span, { maxSpan: 60, span: 61 }), server.PERIOD_MESSAGES.period_span({ maxSpan: 60, span: 61 }));
});
