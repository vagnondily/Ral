/**
 * Réparations r3_mois_de_collecte / r4_mois_de_collecte_2ans et relecture des dates (« Appliquer aux
 * soumissions ») SANS base : un faux client PostgreSQL rejoue les requêtes de
 * monitoring.repository.rederiveCollectionDatesTx sur une table en mémoire.
 * Vérifie : lignes changées seulement, UPDATE … FROM (VALUES …) par lots,
 * requêtes l'une après l'autre sur le même client, idempotence.
 */
process.env.NODE_ENV = 'production'; // logger sans transport « pretty » (pas de thread)
process.env.LOG_LEVEL = 'silent';

const test = require('node:test');
const assert = require('node:assert/strict');
const repo = require('../src/modules/monitoring/monitoring.repository');
const { repairCollectionMonths, REPAIRS } = require('../src/db/dataRepairs');

const T = '11111111-1111-1111-1111-111111111111';
const F = '22222222-2222-2222-2222-222222222222';

/** Faux client : table monitoring_submissions en mémoire, surcharges de mapping, journal des requêtes. */
function fakeClient(rows, { overrides = [] } = {}) {
  const log = [];
  let busy = false;
  const client = {
    log,
    async query(sql, params = []) {
      assert.equal(busy, false, 'requêtes en parallèle sur le même client');
      busy = true;
      await new Promise((r) => setImmediate(r));
      busy = false;
      log.push({ sql, params });
      const mine = rows.filter((r) => r.tenant_id === params[0] && r.form_id === params[1]);
      if (/jsonb_object_keys/.test(sql)) return { rows: [...new Set(mine.flatMap((r) => Object.keys(r.data)))].map((k) => ({ k })) };
      if (/^SELECT count\(\*\)::int AS n FROM monitoring_submissions/.test(sql)) return { rows: [{ n: mine.length }] };
      if (/FROM monitoring_field_map/.test(sql)) return { rows: overrides.filter((o) => o.dimension === params[2]) };
      if (/jsonb_object_agg/.test(sql)) {
        const keys = params[2];
        return {
          rows: mine.map((r) => {
            const d = Object.fromEntries(keys.filter((k) => k in r.data).map((k) => [k, r.data[k]]));
            return { id: r.id, periodMonth: r.period_month, submittedAt: r.submitted_at, uploadMonth: r.upload_month, dates: Object.keys(d).length ? d : null };
          }),
        };
      }
      if (/^\s*UPDATE monitoring_submissions s SET period_month/.test(sql)) {
        assert.match(sql, /FROM \(VALUES /);
        assert.ok(params.length <= 65535, 'limite de paramètres PostgreSQL');
        let n = 0;
        for (let i = 2; i < params.length; i += 4) {
          const row = mine.find((r) => r.id === params[i]);
          if (!row) continue;
          Object.assign(row, { period_month: params[i + 1], submitted_at: new Date(params[i + 2]), upload_month: params[i + 3] });
          n += 1;
        }
        return { rowCount: n, rows: [] };
      }
      throw new Error(`requête inattendue : ${sql.slice(0, 80)}`);
    },
  };
  return client;
}

const sub = (id, data, periodMonth, extra = {}) => ({
  id, tenant_id: T, form_id: F, data, period_month: periodMonth, submitted_at: null, upload_month: null, ...extra,
});

test('soumissions déjà importées : mois de collecte recalculé, lignes changées seulement, idempotent', async () => {
  const rows = [
    sub('a', { SvyDate: 13988505600, '@_submission_time': 13988628765 }, '2026-01-01'), // même mois (SMP réel)
    sub('b', { SvyDate: '2026-01-28', _submission_time: '2026-02-03T05:00:00Z' }, '2026-02-01'), // → janvier
    sub('c', { site_present: '1' }, '2026-05-01'), // données de démonstration sans date : jamais touchées
    sub('d', { SvyDate: 13929667200, '@_submission_time': 13994498165 }, '2026-04-01'), // SvyDate 2024, plus de 2 ans : réception
    { ...sub('x', { SvyDate: '2026-01-02', _submission_time: '2026-03-01' }, '2026-03-01'), form_id: 'autre-fiche' },
  ];
  const client = fakeClient(rows);
  const first = await repo.rederiveCollectionDatesTx(client, T, F);
  assert.deepEqual(first, { updates: 3, total: 4, monthChanged: 1, unreadable: 0, undated: 1, tooOld: 1, lateUpload: 0, withoutUpload: 1 });
  assert.equal(rows[1].period_month, '2026-01-01');
  assert.equal(rows[1].upload_month, '2026-02-01');
  assert.equal(rows[1].submitted_at.toISOString(), '2026-01-28T00:00:00.000Z');
  assert.equal(rows[0].period_month, '2026-01-01');
  assert.equal(rows[0].upload_month, '2026-01-01');
  assert.equal(rows[3].period_month, '2026-04-01');
  assert.equal(rows[2].period_month, '2026-05-01'); // inchangée
  assert.equal(rows[2].upload_month, null);
  assert.equal(rows[4].period_month, '2026-03-01'); // autre fiche : jamais touchée
  const updates = client.log.filter((q) => /^\s*UPDATE/.test(q.sql));
  assert.equal(updates.length, 1, 'une seule instruction multi-lignes, pas une par soumission');
  assert.equal(updates[0].params.length, 2 + 3 * 4);
  assert.deepEqual(updates[0].params.slice(0, 2), [T, F]);

  // Rejouée : plus rien à changer, aucune écriture.
  client.log.length = 0;
  const again = await repo.rederiveCollectionDatesTx(client, T, F);
  assert.equal(again.updates, 0);
  assert.equal(client.log.filter((q) => /^\s*UPDATE/.test(q.sql)).length, 0);
});

test('date d\'enquête choisie dans « Mapping MEMS » : la colonne choisie, puis « aucune »', async () => {
  const rows = [sub('a', { SvyDate: '2026-02-01', DateVisite: '2026-01-20', _submission_time: '2026-02-03T08:00:00Z' }, '2026-02-01')];
  const overrides = [{ dimension: 'survey_date', columnName: 'DateVisite' }];
  await repo.rederiveCollectionDatesTx(fakeClient(rows, { overrides }), T, F);
  assert.equal(rows[0].period_month, '2026-01-01');
  overrides[0].columnName = ''; // « aucune » : mois de réception
  await repo.rederiveCollectionDatesTx(fakeClient(rows, { overrides }), T, F);
  assert.equal(rows[0].period_month, '2026-02-01');
  assert.equal(rows[0].submitted_at.toISOString(), '2026-02-03T08:00:00.000Z');
});

test('fiche sans colonne de date : toutes les soumissions comptées « sans date », aucune lecture des réponses, aucune écriture', async () => {
  const client = fakeClient([sub('a', { q1: 'oui' }, '2026-03-01'), sub('b', { q1: 'non' }, null)]);
  assert.deepEqual(await repo.rederiveCollectionDatesTx(client, T, F),
    { updates: 0, total: 2, monthChanged: 0, unreadable: 0, undated: 2, tooOld: 0, lateUpload: 0, withoutUpload: 2 });
  assert.equal(client.log.filter((q) => /jsonb_object_agg|UPDATE/.test(q.sql)).length, 0);
});

test('règle des 2 ans (r4) : envoi tardif rangé par r3 au mois de l\'envoi → mois de l\'enquête ; SvyDate illisible → end', async () => {
  const rows = [
    // Valeurs réelles SMP : collecte de septembre 2025 envoyée en avril 2026, rangée en avril par la fenêtre de 92 jours.
    sub('smp', { SvyDate: 13977964800, '@_submission_time': 13996750892 }, '2026-04-01', { upload_month: '2026-04-01', submitted_at: new Date('2026-04-14T00:00:00Z') }),
    // SvyDate illisible, end lisible, sans date de réception.
    sub('end', { SvyDate: '15/01/2026', end: '2026-01-15T10:00:00Z' }, null),
    // Plus de 2 ans avant l'envoi (GD réel : SvyDate 2022) : reste au mois de l'envoi.
    sub('gd', { SvyDate: '2022-08-10', _submission_time: '2026-03-01T08:00:00Z' }, '2026-03-01', { upload_month: '2026-03-01', submitted_at: new Date('2026-03-01T08:00:00Z') }),
  ];
  const client = fakeClient(rows);
  const r = await repo.rederiveCollectionDatesTx(client, T, F);
  assert.equal(rows[0].period_month, '2025-09-01');
  assert.equal(rows[0].upload_month, '2026-04-01');
  assert.equal(rows[1].period_month, '2026-01-01');
  assert.equal(rows[1].upload_month, null);
  assert.equal(rows[2].period_month, '2026-03-01');
  assert.deepEqual([r.lateUpload, r.tooOld, r.withoutUpload, r.monthChanged, r.total], [1, 1, 1, 2, 3]);
  // Rejouée : plus rien à écrire.
  client.log.length = 0;
  assert.equal((await repo.rederiveCollectionDatesTx(client, T, F)).updates, 0);
  assert.equal(client.log.filter((q) => /^\s*UPDATE/.test(q.sql)).length, 0);
});

test('gros volume : écritures par lots sous la limite de paramètres de PostgreSQL', async () => {
  const rows = Array.from({ length: 15001 }, (_, i) => sub(`id${i}`, { SvyDate: '2026-01-28', _submission_time: '2026-02-03T05:00:00Z' }, '2026-02-01'));
  const client = fakeClient(rows);
  const r = await repo.rederiveCollectionDatesTx(client, T, F);
  assert.equal(r.updates, 15001);
  const updates = client.log.filter((q) => /^\s*UPDATE/.test(q.sql));
  assert.equal(updates.length, 2);
  assert.ok(rows.every((x) => x.period_month === '2026-01-01'));
});

test('réparations r3 et r4 : verrou des rattachements d\'abord, puis chaque fiche l\'une après l\'autre', async () => {
  const keys = REPAIRS.map((r) => r.key);
  assert.ok(keys.includes('r3_mois_de_collecte'), 'r3 enregistrée');
  // r4 rejoue le calcul avec la règle des 2 ans là où r3 a déjà tourné (clé nouvelle), après r3.
  assert.ok(keys.indexOf('r4_mois_de_collecte_2ans') > keys.indexOf('r3_mois_de_collecte'), 'r4 enregistrée après r3');
  assert.equal(REPAIRS.find((r) => r.key === 'r4_mois_de_collecte_2ans').run, repairCollectionMonths);
  assert.equal(new Set(keys).size, keys.length, 'clés uniques');
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push('forms');
      assert.match(sql, /FROM monitoring_forms WHERE tenant_id = \$1/);
      assert.deepEqual(params, [T]);
      return { rows: [{ id: 'f1' }, { id: 'f2' }] };
    },
  };
  let pending = 0;
  const monitoring = {
    async rederiveCollectionDatesTx(c, tenantId, formId) {
      assert.equal(pending, 0, 'fiches traitées l\'une après l\'autre');
      pending += 1;
      await new Promise((r) => setImmediate(r));
      pending -= 1;
      calls.push(`rederive:${formId}`);
      return formId === 'f1'
        ? { updates: 3, total: 10, monthChanged: 2, unreadable: 1, undated: 0, tooOld: 1, lateUpload: 4, withoutUpload: 0 }
        : { updates: 0, total: 5, monthChanged: 0, unreadable: 0, undated: 5, tooOld: 0, lateUpload: 0, withoutUpload: 5 };
    },
  };
  const places = { async lockSubmissionLinksTx(c, tenantId) { assert.equal(tenantId, T); calls.push('lock'); } };
  const out = await repairCollectionMonths(client, T, { monitoring, places });
  assert.deepEqual(calls, ['lock', 'forms', 'rederive:f1', 'rederive:f2']);
  assert.deepEqual(out, { forms: 2, submissions: 15, updated: 3, monthChanged: 2, unreadable: 1, undated: 5, tooOld: 1, lateUpload: 4, withoutUpload: 5 });
});
