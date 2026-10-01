const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreSite, monthsSinceVisit } = require('../src/modules/tpm/rbmScore');

test('site sans problème ni retard ⇒ score faible, priorité basse', () => {
  const r = scoreSite({ lastVisitMonth: '2026-09' }, { targetMonth: '2026-10', mmrInterval: 3 });
  assert.equal(r.finalScore, 0);
  assert.equal(r.finalLabel, 'Faible');
  assert.equal(r.priority, 0);
  assert.equal(r.due, false);           // 1 mois < intervalle 3
});

test('problème urgent (CFM=2) ⇒ score et priorité élevés, drapeau urgent', () => {
  const r = scoreSite({ issuesCFM: 2, lastVisitMonth: '2026-09' }, { targetMonth: '2026-10', mmrInterval: 3 });
  assert.equal(r.urgentFlags, true);
  assert.equal(r.finalScore, 2);
  assert.equal(r.priority, 2);
  assert.equal(r.priorityLabel, 'Haute');
});

test('fraude suspectée ⇒ urgent même sans autre critère', () => {
  const r = scoreSite({ fraud: 1 }, { targetMonth: '2026-10', mmrInterval: 6 });
  assert.equal(r.urgentFlags, true);
  assert.equal(r.finalScore, 2);
});

test('jamais visité ⇒ en retard (due) et priorité au moins moyenne', () => {
  const r = scoreSite({ lastVisitMonth: null }, { targetMonth: '2026-10', mmrInterval: 3 });
  assert.equal(r.neverVisited, true);
  assert.equal(r.overdue, true);
  assert.equal(r.due, true);
  assert.ok(r.priority >= 1);
});

test('retard vs intervalle MMR : due dès que le délai est atteint', () => {
  assert.equal(scoreSite({ lastVisitMonth: '2026-08' }, { targetMonth: '2026-10', mmrInterval: 2 }).due, true);  // 2 ≥ 2
  assert.equal(scoreSite({ lastVisitMonth: '2026-09' }, { targetMonth: '2026-10', mmrInterval: 2 }).due, false); // 1 < 2
});

test('cumul de critères moyens ⇒ score moyen', () => {
  const r = scoreSite({ synergies: 1, beneficiaryOver200: 1 }, { targetMonth: '2026-10', mmrInterval: 3 });
  assert.equal(r.urgentFlags, false);
  assert.equal(r.riskPoints, 2);
  assert.equal(r.finalScore, 1);
});

test('monthsSinceVisit calcule l\'écart en mois', () => {
  assert.equal(monthsSinceVisit('2026-07', '2026-10'), 3);
  assert.equal(monthsSinceVisit('2025-12', '2026-02'), 2);
  assert.equal(monthsSinceVisit(null, '2026-10'), null);
});
