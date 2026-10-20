/**
 * Jour LOCAL de l'application (common/localDay) et horloge de la planification automatique
 * (planAuto.service clockOf / todayFor) : entre minuit et 3 h à Madagascar, le jour UTC est encore la
 * veille — le plan se juge sur le jour local ; le jour courant n'entre dans l'empreinte que si le
 * mois courant fait partie de la période.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { localDay, DEFAULT_TZ } = require('../src/modules/common/localDay');
const { clockOf, todayFor } = require('../src/modules/tpm/planAuto.service');
const { fingerprintInputs } = require('../src/modules/tpm/planFingerprint');

test('jour local : 22 h 30 UTC = le lendemain à Madagascar ; fuseau invalide → UTC', () => {
  const late = new Date('2026-10-20T22:30:00Z');
  assert.equal(DEFAULT_TZ, 'Indian/Antananarivo');
  assert.equal(localDay(late, 'Indian/Antananarivo'), '2026-10-21');
  assert.equal(localDay(late, 'UTC'), '2026-10-20');
  assert.equal(localDay(new Date('2026-10-20T20:59:00Z'), 'Indian/Antananarivo'), '2026-10-20');
  assert.equal(localDay(late, 'Pas/UnFuseau'), '2026-10-20');
});

test('jour local : APP_TIMEZONE est lu à chaque appel (défaut Madagascar)', () => {
  const saved = process.env.APP_TIMEZONE;
  try {
    const late = new Date('2026-10-20T22:30:00Z');
    delete process.env.APP_TIMEZONE;
    assert.equal(localDay(late), '2026-10-21');
    process.env.APP_TIMEZONE = 'UTC';
    assert.equal(localDay(late), '2026-10-20');
  } finally {
    if (saved === undefined) delete process.env.APP_TIMEZONE; else process.env.APP_TIMEZONE = saved;
  }
});

test('horloge du plan : mois et jour au jour LOCAL (dernier soir du mois en UTC = 1ᵉʳ du mois suivant)', () => {
  const saved = process.env.APP_TIMEZONE;
  try {
    delete process.env.APP_TIMEZONE;
    // 31 octobre 21 h 30 UTC = 1ᵉʳ novembre 0 h 30 à Madagascar : octobre est échu.
    assert.deepEqual(clockOf({}, new Date('2026-10-31T21:30:00Z')), { now: '2026-11', today: '2026-11-01' });
    assert.deepEqual(clockOf({}, new Date('2026-10-20T08:00:00Z')), { now: '2026-10', today: '2026-10-20' });
    // Mois imposé sans jour (tests, reprises) : du 1ᵉʳ de ce mois ; jour imposé du même mois : gardé.
    assert.deepEqual(clockOf({ now: '2026-12' }, new Date('2026-10-20T08:00:00Z')), { now: '2026-12', today: '2026-12-01' });
    assert.deepEqual(clockOf({ now: '2026-10', today: '2026-10-15' }, new Date('2026-10-20T08:00:00Z')), { now: '2026-10', today: '2026-10-15' });
    // Jour imposé d'un autre mois : ignoré.
    assert.deepEqual(clockOf({ now: '2026-11', today: '2026-10-15' }, new Date('2026-10-20T08:00:00Z')), { now: '2026-11', today: '2026-11-01' });
  } finally {
    if (saved === undefined) delete process.env.APP_TIMEZONE; else process.env.APP_TIMEZONE = saved;
  }
});

test('jour courant : seulement quand le mois courant est un mois ouvert de la période', () => {
  const clock = { now: '2026-10', today: '2026-10-20' };
  assert.equal(todayFor(clock, 2026, [10, 11, 12]), '2026-10-20');
  assert.equal(todayFor(clock, 2026, [11, 12]), null);
  assert.equal(todayFor(clock, 2027, [1, 2, 3, 10]), null);    // autre exercice
  assert.equal(todayFor(clock, '2026', [10]), '2026-10-20');
  assert.equal(todayFor(clock, 2026, []), null);
});

test('empreinte : un aperçu de 2027 fait la veille reste valable le lendemain ; un aperçu du mois en cours, non', () => {
  const inputs = { yearHasGrid: false, mmrByKey: {}, sites: [{ id: 'a', district: 'D', commune: 'C', visits: [], monthStatus: {} }] };
  const fp = (clock, year, open) => fingerprintInputs(inputs, {
    year, requested: open, months: open, fromMonth: clock.now, today: todayFor(clock, year, open), settings: {}, scope: {}, writeSchedule: false,
  }).fingerprint;
  const eve = clockOf({}, new Date('2026-10-20T20:59:00Z'));     // 23 h 59 à Madagascar
  const next = clockOf({}, new Date('2026-10-20T21:01:00Z'));    // 0 h 01 le 21
  assert.equal(eve.today, '2026-10-20');
  assert.equal(next.today, '2026-10-21');
  assert.equal(fp(eve, 2027, [1, 2, 3]), fp(next, 2027, [1, 2, 3]));
  assert.equal(fp(eve, 2026, [11, 12]), fp(next, 2026, [11, 12]));
  assert.notEqual(fp(eve, 2026, [10, 11, 12]), fp(next, 2026, [10, 11, 12]));
});
