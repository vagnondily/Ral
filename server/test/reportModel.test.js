const test = require('node:test');
const assert = require('node:assert/strict');
const { parseReport, safeParseReport, periodLabel, variableValues, dataNeeds, DATASETS } = require('../src/modules/reports/reportModel');
const { SYSTEM_TEMPLATES } = require('../src/modules/reports/reportTemplates');

const PERIOD = { from: '2026-01', to: '2026-05' };

test('chaque modèle système est un rapport valide (schéma strict)', () => {
  assert.ok(SYSTEM_TEMPLATES.length >= 5);
  for (const tpl of SYSTEM_TEMPLATES) {
    const r = safeParseReport({ title: tpl.name, period: PERIOD, page: tpl.page, blocks: tpl.blocks });
    assert.ok(r.success, `${tpl.key}: ${JSON.stringify(r.error && r.error.issues.slice(0, 2))}`);
  }
});

test('texte riche : aucun HTML accepté, types de nœuds et de blocs fermés', () => {
  const base = { title: 'X', period: PERIOD, blocks: [] };
  assert.equal(safeParseReport({ ...base, blocks: [{ id: 'a', type: 'text', params: { doc: { nodes: [{ t: 'script', c: [{ x: 'alert(1)' }] }] } } }] }).success, false);
  assert.equal(safeParseReport({ ...base, blocks: [{ id: 'a', type: 'html', params: { html: '<img onerror>' } }] }).success, false);
  assert.equal(safeParseReport({ ...base, blocks: [{ id: 'a', type: 'text', params: { doc: { nodes: [{ t: 'p', c: [{ x: 'ok', b: true, v: 'periode' }] }] } } }] }).success, true);
  assert.equal(safeParseReport({ ...base, blocks: [{ id: 'a', type: 'text', params: { doc: { nodes: [{ t: 'p', c: [{ x: '', v: 'Bad-Var' }] }] } } }] }).success, false);
});

test('intégrité : identifiants de blocs uniques (y compris dans un bloc répété), période ordonnée, jeu de données connu', () => {
  const dup = { title: 'X', period: PERIOD, blocks: [{ id: 'a', type: 'divider', params: {} }, { id: 'r', type: 'repeat', params: { over: 'activity', blocks: [{ id: 'a', type: 'pagebreak', params: {} }] } }] };
  assert.match(JSON.stringify(safeParseReport(dup).error.issues), /double/);
  assert.equal(safeParseReport({ title: 'X', period: { from: '2026-05', to: '2026-01' }, blocks: [] }).success, false);
  assert.equal(safeParseReport({ title: 'X', period: PERIOD, blocks: [{ id: 't', type: 'table', params: { dataset: 'inconnu' } }] }).success, false);
  // Pas de répétition imbriquée.
  const nested = { title: 'X', period: PERIOD, blocks: [{ id: 'r', type: 'repeat', params: { over: 'activity', blocks: [{ id: 'r2', type: 'repeat', params: { over: 'bureau', blocks: [{ id: 'x', type: 'divider', params: {} }] } }] } }] };
  assert.equal(safeParseReport(nested).success, false);
});

test('libellé de période', () => {
  assert.equal(periodLabel({ from: '2026-01', to: '2026-05' }), 'Janvier à mai 2026');
  assert.equal(periodLabel({ from: '2026-08', to: '2026-08' }), 'Août 2026');
  assert.equal(periodLabel({ from: '2026-01', to: '2026-12' }), 'Année 2026');
  assert.equal(periodLabel({ from: '2025-10', to: '2026-03' }), 'Octobre 2025 à mars 2026');
});

test('variables et besoins en données (dédupliqués)', () => {
  const v = variableValues(PERIOD, { coverage: 59, sites_visited: 753 }, new Date('2026-06-02T08:00:00Z'));
  assert.equal(v.periode, 'Janvier à mai 2026'); assert.equal(v.coverage, 59); assert.equal(v.date_edition, '2026-06-02');
  const r = parseReport({ title: 'X', period: PERIOD, blocks: [
    { id: 'a', type: 'table', params: { dataset: 'activity_coverage' } },
    { id: 'b', type: 'chart', params: { dataset: 'activity_coverage' } },
    { id: 'c', type: 'kpis', params: { metrics: ['coverage'] } },
  ] });
  const needs = dataNeeds(r.blocks);
  assert.equal(needs.filter((n) => n.name === 'activity_coverage').length, 1);
  assert.equal(needs.filter((n) => n.kind === 'kpis').length, 1);
  for (const d of Object.values(DATASETS)) assert.ok(d.columns.length >= 1 && d.label);
});
