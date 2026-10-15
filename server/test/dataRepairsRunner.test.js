/**
 * Réparations de données au démarrage (db/dataRepairs.runDataRepairs) — SANS base : une fausse
 * base joue le verrou consultatif (attente réelle, libéré à la fin de la transaction) et la marque
 * data_repairs (visible seulement après COMMIT). Vérifie le contrat demandé pour la reprise du
 * retour 58 et toutes les autres :
 *  - deux instances de l'API lancées ensemble ne jouent une réparation qu'UNE fois par compte ;
 *  - une réparation déjà faite ne se rejoue pas ; un échec n'est pas marqué (retenté), n'arrête ni
 *    les autres comptes ni les autres réparations, est journalisé, et runDataRepairs ne rejette
 *    jamais (l'API reste démarrée) ;
 *  - R58 prend le verrou des rattachements AVANT d'écrire (même ordre que l'API).
 * Le comportement réel en base (verrou, transaction, visites jamais touchées) : tpmRepairDb.test.js.
 */
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runDataRepairs, REPAIRS, repairTpmZones } = require('../src/db/dataRepairs');

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** Fausse base : verrous consultatifs de transaction (file d'attente par clé), marques après COMMIT. */
function fakeDb({ tenants = ['t1', 't2'], failTenants = false } = {}) {
  const tails = new Map();
  const markers = new Set();
  const acquire = (key) => {
    const prev = tails.get(key) || Promise.resolve();
    let release;
    const mine = new Promise((r) => { release = r; });
    tails.set(key, prev.then(() => mine));
    return prev.then(() => release);
  };
  const withTenantTransaction = async (tenantId, fn) => {
    const held = [];
    const staged = [];
    const client = {
      query: async (sql, params) => {
        if (/pg_advisory_xact_lock/.test(sql)) { held.push(await acquire(params[0])); return { rows: [] }; }
        if (/^SELECT 1 FROM data_repairs/.test(sql)) return { rows: markers.has(`${params[0]}|${params[1]}`) ? [{ one: 1 }] : [] };
        if (/^INSERT INTO data_repairs/.test(sql)) { staged.push(`${params[0]}|${params[1]}`); return { rows: [] }; }
        throw new Error(`requête inattendue : ${sql}`);
      },
    };
    try {
      const out = await fn(client);
      for (const m of staged) markers.add(m); // COMMIT : la marque devient visible…
      return out;
    } finally {
      for (const release of held) release(); // … et le verrou est rendu (fin de transaction)
    }
  };
  const pool = {
    query: async () => {
      if (failTenants) throw new Error('connexion refusée');
      return { rows: tenants.map((id) => ({ id })) };
    },
  };
  return { pool, withTenantTransaction, markers };
}

function fakeLogger() {
  const lines = { info: [], error: [] };
  return { lines, info: (o, m) => lines.info.push({ o, m }), error: (o, m) => lines.error.push({ o, m }), warn: () => {} };
}

test('deux instances lancées ensemble : chaque réparation tourne UNE fois par compte, la seconde trouve la marque', async () => {
  const db = fakeDb();
  const runs = [];
  const repair = { key: 'r_test', run: async (client, tenantId) => { runs.push(tenantId); await sleep(15); return { changed: 3 }; } };
  const deps = { ...db, logger: fakeLogger() };
  const [a, b] = await Promise.all([runDataRepairs({ repairs: [repair], deps }), runDataRepairs({ repairs: [repair], deps })]);
  assert.deepEqual(runs.sort(), ['t1', 't2'], 'une exécution par compte, jamais deux');
  for (const t of ['t1', 't2']) {
    const statuses = [...a, ...b].filter((r) => r.tenant === t).map((r) => r.status).sort();
    assert.deepEqual(statuses, ['done', 'skipped']);
  }
  assert.deepEqual([...db.markers].sort(), ['t1|r_test', 't2|r_test']);
  // Rejouée plus tard : rien ne tourne.
  const again = await runDataRepairs({ repairs: [repair], deps });
  assert.deepEqual(again.map((r) => r.status), ['skipped', 'skipped']);
  assert.equal(runs.length, 2);
});

test('un échec : journalisé, non marqué (retenté au démarrage suivant), les autres comptes continuent, jamais de rejet', async () => {
  const db = fakeDb();
  const log = fakeLogger();
  let attempts = 0;
  const repair = {
    key: 'r_fail',
    run: async (client, tenantId) => { attempts += 1; if (tenantId === 't1') throw new Error('boom'); return { ok: true }; },
  };
  const report = await runDataRepairs({ repairs: [repair, { key: 'r_next', run: async () => ({}) }], deps: { ...db, logger: log } });
  assert.deepEqual(report.map((r) => `${r.tenant}:${r.key}:${r.status}`),
    ['t1:r_fail:failed', 't1:r_next:done', 't2:r_fail:done', 't2:r_next:done']);
  assert.equal(db.markers.has('t1|r_fail'), false, 'un échec n\'est jamais marqué');
  assert.equal(log.lines.error.length, 1);
  assert.equal(log.lines.error[0].o.repair, 'r_fail');
  assert.match(log.lines.error[0].m, /retentée au prochain démarrage/);
  // Démarrage suivant : seule la réparation en échec est retentée.
  const next = await runDataRepairs({ repairs: [repair], deps: { ...db, logger: log } });
  assert.deepEqual(next.map((r) => `${r.tenant}:${r.status}`), ['t1:failed', 't2:skipped']);
  assert.equal(attempts, 3);
});

test('comptes illisibles (base indisponible) : journalisé, aucune réparation, la promesse se résout (l\'API reste démarrée)', async () => {
  const log = fakeLogger();
  const db = fakeDb({ failTenants: true });
  const report = await runDataRepairs({ repairs: [{ key: 'r', run: async () => { throw new Error('jamais appelé'); } }], deps: { ...db, logger: log } });
  assert.deepEqual(report, []);
  assert.equal(log.lines.error.length, 1);
  assert.match(log.lines.error[0].m, /réparations de données impossibles/);
});

test('R58 : verrou des rattachements AVANT toute écriture, zones des sites puis TPM des contrats ; visites gardées rendues', async () => {
  const calls = [];
  const places = { lockSubmissionLinksTx: async () => { calls.push('lock'); } };
  const tpm = {
    refreshSiteZonesTx: async () => { calls.push('zones'); return { changed: 4 }; },
    applyContractsTx: async (client, tenantId, actorId, opts) => {
      calls.push('apply');
      assert.equal(actorId, null, 'aucun auteur : reprise automatique');
      assert.equal(opts.period, undefined, 'toutes les visites prévues du compte');
      return { visits: 10, converted: 2, changed: 3, byState: { contrat: 9, sans_contrat: 1 }, kept: { reasoned: 1, done: 5, invoiced: 2 } };
    },
  };
  const out = await repairTpmZones({}, 't1', { places, tpm });
  assert.deepEqual(calls, ['lock', 'zones', 'apply']);
  assert.deepEqual(out, { zones: 4, visits: 10, converted: 2, changed: 3, byState: { contrat: 9, sans_contrat: 1 }, kept: { reasoned: 1, done: 5, invoiced: 2 } });
  const r58 = REPAIRS.find((r) => r.key === 'r58_tpm_zones');
  assert.equal(r58.run, repairTpmZones);
});
