const test = require('node:test');
const assert = require('node:assert/strict');
const { isDue, frequencyFor, monthsBetween } = require('../src/modules/tpm/rbmMath');

test('frequency follows risk (élevée mensuelle, faible trimestrielle)', () => {
  assert.equal(frequencyFor('elevee'), 1);
  assert.equal(frequencyFor('moyenne'), 2);
  assert.equal(frequencyFor('faible'), 3);
  assert.equal(frequencyFor('inconnu'), 3); // défaut
});

test('monthsBetween counts calendar months', () => {
  assert.equal(monthsBetween('2026-01', '2026-04'), 3);
  assert.equal(monthsBetween('2025-11', '2026-02'), 3);
  assert.equal(monthsBetween('2026-05', '2026-05'), 0);
});

test('isDue: never visited is always due; otherwise by risk frequency', () => {
  assert.equal(isDue('faible', null, '2026-05'), true);        // jamais visité
  // élevée (mensuelle) : due dès le mois suivant
  assert.equal(isDue('elevee', '2026-04', '2026-05'), true);
  assert.equal(isDue('elevee', '2026-05', '2026-05'), false);  // déjà visité ce mois
  // faible (trimestrielle) : pas due avant 3 mois
  assert.equal(isDue('faible', '2026-03', '2026-05'), false);  // 2 mois < 3
  assert.equal(isDue('faible', '2026-02', '2026-05'), true);   // 3 mois ≥ 3
  // moyenne (bimestrielle)
  assert.equal(isDue('moyenne', '2026-04', '2026-05'), false); // 1 < 2
  assert.equal(isDue('moyenne', '2026-03', '2026-05'), true);  // 2 ≥ 2
  // dernière visite dans le futur → non due
  assert.equal(isDue('elevee', '2026-06', '2026-05'), false);
});

// ---- Retour n° 48 : une visite seulement PLANIFIÉE n'est jamais la dernière visite
const { lastVisitOf, plannedVisits, visitState, addMonths, toMonth } = require('../src/modules/tpm/rbmMath');

test('lastVisitOf : la plus récente entre visite réalisée, collecte réelle et registre, avec sa source', () => {
  assert.deepEqual(lastVisitOf({}), { month: null, source: null });
  assert.deepEqual(lastVisitOf({ fieldVisitMonth: '2026-07' }), { month: '2026-07', source: 'visite' });
  assert.deepEqual(lastVisitOf({ fieldVisitMonth: '2026-07', dataVisitMonth: '2026-09' }), { month: '2026-09', source: 'donnees' });
  assert.deepEqual(lastVisitOf({ dataVisitMonth: '2026-05', lastVisitDate: '2026-08-14' }), { month: '2026-08', source: 'registre' });
  // À égalité : la visite réalisée prime, puis les données.
  assert.deepEqual(lastVisitOf({ fieldVisitMonth: '2026-09', dataVisitMonth: '2026-09', lastVisitDate: '2026-09-02' }), { month: '2026-09', source: 'visite' });
  assert.deepEqual(lastVisitOf({ dataVisitMonth: '2026-09', lastVisitDate: '2026-09-02' }), { month: '2026-09', source: 'donnees' });
  // Valeurs illisibles ignorées.
  assert.deepEqual(lastVisitOf({ fieldVisitMonth: 'x', dataVisitMonth: '2026-13' }), { month: null, source: null });
});

test('lastVisitOf ignore les mois prévus : une visite planifiée ne compte pas', () => {
  assert.deepEqual(lastVisitOf({ plannedMonths: ['2026-10'], plannedVisitMonth: '2026-10' }), { month: null, source: null });
});

test('plannedVisits : prochaine visite prévue (≥ mois cible) et visite prévue passée non réalisée', () => {
  assert.deepEqual(plannedVisits(['2026-11', '2026-08', '2026-10', '2026-10'], '2026-10'), { nextPlannedMonth: '2026-10', latePlannedMonth: '2026-08' });
  assert.deepEqual(plannedVisits(['2026-12'], '2026-10'), { nextPlannedMonth: '2026-12', latePlannedMonth: null });
  assert.deepEqual(plannedVisits(['2026-06', '2026-08'], '2026-10'), { nextPlannedMonth: null, latePlannedMonth: '2026-08' });
  assert.deepEqual(plannedVisits(null, '2026-10'), { nextPlannedMonth: null, latePlannedMonth: null });
  assert.deepEqual(plannedVisits([], '2026-10'), { nextPlannedMonth: null, latePlannedMonth: null });
});

test('visitState : seule une visite réalisée (ou une collecte) rend un site à jour ; la visite prévue est rendue à part', () => {
  // Cas du retour : jamais visité, seulement une visite PRÉVUE en octobre.
  const planned = visitState({ fieldVisitMonth: null, dataVisitMonth: null, lastVisitDate: null, plannedMonths: ['2026-10'] }, '2026-10');
  assert.deepEqual(planned, { lastVisitMonth: null, lastVisitSource: null, nextPlannedMonth: '2026-10', latePlannedMonth: null });
  assert.equal(isDue('elevee', planned.lastVisitMonth, '2026-10'), true, 'jamais visité ⇒ à suivre, même avec une visite prévue');
  // Réalisée en septembre + prévue en octobre : la dernière visite est septembre.
  const done = visitState({ fieldVisitMonth: '2026-09', plannedMonths: ['2026-10'] }, '2026-10');
  assert.equal(done.lastVisitMonth, '2026-09'); assert.equal(done.lastVisitSource, 'visite'); assert.equal(done.nextPlannedMonth, '2026-10');
  assert.equal(isDue('elevee', done.lastVisitMonth, '2026-10'), true);   // mensuel : 1 mois ≥ 1
  assert.equal(isDue('moyenne', done.lastVisitMonth, '2026-10'), false); // bimestriel : 1 < 2
});

test('addMonths / toMonth', () => {
  assert.equal(addMonths('2026-11', 3), '2027-02');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-10-15', 0), '2026-10');
  assert.equal(addMonths(null, 2), null);
  assert.equal(addMonths('2026-10', null), null);
  assert.equal(toMonth('2026-07-31'), '2026-07');
  assert.equal(toMonth('2026-00'), null);
  assert.equal(toMonth(undefined), null);
});
