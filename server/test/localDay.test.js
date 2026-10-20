/**
 * Jour LOCAL de l'application (common/localDay) et horloge de la planification automatique
 * (planAuto.service clockOf / todayFor) : entre minuit et 3 h à Madagascar, le jour UTC est encore la
 * veille — le plan se juge sur le jour local ; le jour courant n'entre dans l'empreinte que si le
 * mois courant fait partie de la période.
 */
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secret-de-test-de-l-horloge-du-plan-0123456789abcdef';
const test = require('node:test');
const assert = require('node:assert/strict');
const { localDay, appTimeZone, formatterFor, clearFormatterCache, DEFAULT_TZ } = require('../src/modules/common/localDay');
const { withFrozenClock } = require('./helpers/frozenClock');
const { clockOf, todayFor, serverClock } = require('../src/modules/tpm/planAuto.service');
const { currentMonth } = require('../src/modules/tpm/rbmMath');
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
  // Fuseau de l'application par défaut (Madagascar), quel que soit APP_TIMEZONE de l'environnement.
  const saved = process.env.APP_TIMEZONE;
  delete process.env.APP_TIMEZONE;
  let eve; let next;
  try {
    eve = clockOf({}, new Date('2026-10-20T20:59:00Z'));     // 23 h 59 à Madagascar
    next = clockOf({}, new Date('2026-10-20T21:01:00Z'));    // 0 h 01 le 21
  } finally {
    if (saved === undefined) delete process.env.APP_TIMEZONE; else process.env.APP_TIMEZONE = saved;
  }
  assert.equal(eve.today, '2026-10-20');
  assert.equal(next.today, '2026-10-21');
  assert.equal(fp(eve, 2027, [1, 2, 3]), fp(next, 2027, [1, 2, 3]));
  assert.equal(fp(eve, 2026, [11, 12]), fp(next, 2026, [11, 12]));
  assert.notEqual(fp(eve, 2026, [10, 11, 12]), fp(next, 2026, [10, 11, 12]));
});

test('un seul mois courant : rbmMath.currentMonth = mois du jour local ; fuseau effectif exposé', () => {
  const saved = process.env.APP_TIMEZONE;
  try {
    delete process.env.APP_TIMEZONE;
    assert.equal(currentMonth(), localDay().slice(0, 7));
    assert.equal(appTimeZone(), 'Indian/Antananarivo');
    process.env.APP_TIMEZONE = 'Pas/UnFuseau';
    assert.equal(appTimeZone(), 'UTC');                       // fuseau invalide : UTC, comme localDay
    process.env.APP_TIMEZONE = 'Europe/Paris';
    assert.equal(appTimeZone(), 'Europe/Paris');
    assert.equal(currentMonth(), localDay(new Date(), 'Europe/Paris').slice(0, 7));
  } finally {
    if (saved === undefined) delete process.env.APP_TIMEZONE; else process.env.APP_TIMEZONE = saved;
  }
});

test('GET /api/tpm/plan-auto/clock : le mois que l\'aperçu accepte (jour local), pour tout utilisateur connecté', async () => {
  const express = require('express');
  const request = require('supertest');
  const jwt = require('jsonwebtoken');
  const routes = require('../src/modules/tpm/planAuto.routes');
  const { errorHandler } = require('../src/middleware/errors');
  const app = express();
  app.use(express.json());
  app.use('/api/tpm/plan-auto', routes);
  app.use(errorHandler);
  const viewer = jwt.sign({ sub: 'u2', tenantId: '11111111-1111-1111-1111-111111111111', role: 'viewer' }, process.env.JWT_SECRET);
  assert.equal((await request(app).get('/api/tpm/plan-auto/clock')).status, 401);
  const res = await request(app).get('/api/tpm/plan-auto/clock').set({ Authorization: `Bearer ${viewer}` });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ['now', 'timeZone', 'today']);
  assert.equal(res.body.now, clockOf({}).now);
  assert.equal(res.body.today.slice(0, 7), res.body.now);
  // Dernier soir du mois en UTC = déjà le 1ᵉʳ à Madagascar : l'écran propose le mois que le serveur accepte.
  const saved = process.env.APP_TIMEZONE;
  try {
    delete process.env.APP_TIMEZONE;
    assert.deepEqual(serverClock(new Date('2026-10-31T22:30:00Z')), { now: '2026-11', today: '2026-11-01', timeZone: 'Indian/Antananarivo' });
  } finally {
    if (saved === undefined) delete process.env.APP_TIMEZONE; else process.env.APP_TIMEZONE = saved;
  }
});

test('formateur réutilisé : un seul Intl.DateTimeFormat par fuseau, même pour un fuseau invalide', () => {
  const Real = Intl.DateTimeFormat;
  let made = 0;
  function Counting(...a) { made += 1; return new Real(...a); }
  Counting.prototype = Real.prototype;
  Counting.supportedLocalesOf = Real.supportedLocalesOf;
  Intl.DateTimeFormat = Counting;
  clearFormatterCache();   // indépendant de l'ordre des tests : aucun formateur déjà en cache
  try {
    const d = new Date('2026-10-20T22:30:00Z');
    for (let i = 0; i < 1000; i += 1) localDay(d, 'Pacific/Chatham');
    appTimeZone('Pacific/Chatham');
    assert.equal(made, 1, 'un formateur pour 1 000 appels');
    for (let i = 0; i < 1000; i += 1) localDay(d, 'Pas/UnAutreFuseau');
    assert.equal(appTimeZone('Pas/UnAutreFuseau'), 'UTC');
    assert.equal(made, 2, 'fuseau invalide : essayé une fois, repli UTC ensuite');
    assert.equal(localDay(d, 'Pas/UnAutreFuseau'), '2026-10-20');
    // Un fuseau qui n'est pas une chaîne : UTC, jamais une exception (rien à créer).
    for (const z of [{ toString() { throw new Error('x'); } }, 42, Symbol('z')]) assert.equal(localDay(d, z), '2026-10-20');
    assert.equal(appTimeZone(Object.create(null)), 'UTC');
    assert.equal(made, 2);
  } finally {
    Intl.DateTimeFormat = Real;
  }
  assert.equal(formatterFor('Indian/Antananarivo'), formatterFor('Indian/Antananarivo'));
});

test('formateur réutilisé : mêmes résultats qu\'un formateur neuf, quels que soient le fuseau et l\'instant', () => {
  const zones = ['Indian/Antananarivo', 'UTC', 'Europe/Paris', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Kolkata', 'Pacific/Chatham'];
  const instants = ['2026-10-20T20:59:59Z', '2026-10-20T21:00:00Z', '2026-10-31T22:30:00Z', '2026-12-31T21:30:00Z', '2027-02-28T23:59:59Z', '2027-03-28T01:30:00Z'];
  for (const z of zones) {
    const fresh = new Intl.DateTimeFormat('en-CA', { timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit' });
    for (const i of instants) {
      const d = new Date(i);
      assert.equal(localDay(d, z), fresh.format(d), `${z} ${i}`);
      assert.equal(localDay(d, z), localDay(d, z));
    }
  }
});

test('mois courant à l\'instant figé (31/10 22 h 30 UTC) : novembre à Madagascar, octobre en UTC', async () => {
  await withFrozenClock('2026-10-31T22:30:00Z', () => {
    assert.equal(currentMonth(), '2026-11');
    assert.deepEqual(serverClock(), { now: '2026-11', today: '2026-11-01', timeZone: 'Indian/Antananarivo' });
  });
  await withFrozenClock('2026-10-31T22:30:00Z', () => {
    assert.equal(currentMonth(), '2026-10');
    assert.deepEqual(serverClock(), { now: '2026-10', today: '2026-10-31', timeZone: 'UTC' });
  }, { timeZone: 'UTC' });
});

test('horloge figée : jamais deux à la fois ; fuseau null = défaut de l\'application ; tout est rendu, même sur une erreur', async () => {
  const saved = process.env.APP_TIMEZONE;
  const RealDate = Date;
  process.env.APP_TIMEZONE = 'Europe/Paris';
  try {
    await withFrozenClock('2026-10-31T22:30:00Z', async () => {
      assert.equal(process.env.APP_TIMEZONE, undefined, 'null : variable retirée, jamais « null »');
      assert.equal(currentMonth(), '2026-11');
      await assert.rejects(withFrozenClock('2026-01-01T00:00:00Z', () => {}), /déjà figée/);
    }, { timeZone: null });
    assert.equal(Date, RealDate);
    assert.equal(process.env.APP_TIMEZONE, 'Europe/Paris');
    await assert.rejects(withFrozenClock('2026-10-31T22:30:00Z', () => { throw new Error('boum'); }, { timeZone: 'UTC' }), /boum/);
    assert.equal(Date, RealDate);
    assert.equal(process.env.APP_TIMEZONE, 'Europe/Paris');
    await assert.rejects(withFrozenClock('pas une date', () => {}), /illisible/);
    assert.equal(Date, RealDate);
    // Après une erreur, l'horloge se fige de nouveau.
    assert.equal(await withFrozenClock('2026-10-31T22:30:00Z', () => currentMonth(), { timeZone: 'UTC' }), '2026-10');
  } finally {
    if (saved === undefined) delete process.env.APP_TIMEZONE; else process.env.APP_TIMEZONE = saved;
  }
});
