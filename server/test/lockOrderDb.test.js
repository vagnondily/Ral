/**
 * Lot « verrous » — ordre des verrous EN BASE RÉELLE, sur demande :
 *   MEMS_TEST_DATABASE_URL      superutilisateur d'une base JETABLE (son nom contient « test »),
 *                               migrée puis peuplée (npm run seed && npm run seed:test) ;
 *   MEMS_TEST_APP_DATABASE_URL  rôle applicatif mems2_app sur la MÊME base (RLS active, comme l'API).
 * Sans ces variables le test est ignoré.
 *
 * Ordre de tous les écrivains (tpm/visitLocks) : rattachements → mois des visites → lignes (sites,
 * localités) par identifiant → verrou d'attribution du compte → le reste. Chaque test met deux vrais
 * écrivains face à face ; une 3ᵉ connexion ne fait que RETARDER le premier une fois ses lignes prises
 * (verrou de table qu'il demande ensuite), le temps que le second se mette à attendre. Avant le lot :
 * le second attendait EN TENANT le verrou d'attribution (ou des lignes dans un autre ordre) et l'un des
 * deux finissait en 40P01 « deadlock detected » (503). Après : il attend sans tenir le verrou
 * d'attribution, et les deux aboutissent. Tout ce qu'un test écrit est supprimé à la fin.
 */
const SU_URL = process.env.MEMS_TEST_DATABASE_URL;
const APP_URL = process.env.MEMS_TEST_APP_DATABASE_URL;
const dbName = (u) => { try { return decodeURIComponent(new URL(u).pathname.slice(1)); } catch { return ''; } };
const enabled = Boolean(SU_URL && APP_URL && /test/i.test(dbName(SU_URL)) && dbName(SU_URL) === dbName(APP_URL));
if (enabled) process.env.APP_DATABASE_URL = APP_URL;
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');

const SKIP = enabled ? false : 'base jetable absente (MEMS_TEST_DATABASE_URL / MEMS_TEST_APP_DATABASE_URL, nom contenant « test »)';
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

let su = null;
async function connect() {
  const { Client } = require('pg');
  const c = new Client({ connectionString: SU_URL });
  await c.connect();
  return c;
}
async function q(sql, params) {
  if (!su) su = await connect();
  return (await su.query(sql, params)).rows;
}
test.after(async () => {
  if (su) await su.end();
  if (enabled) await require('../src/config/db').pool.end();
});

const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, code: e.code, status: e.statusCode, msg: String(e.message) }));
async function waitFor(pred, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await pred()) return true; await sleep(15); }
  return false;
}
/** Nombre de sessions de la base qui attendent un verrou (hors la 3ᵉ connexion). */
const waiting = async (except) => (await q(`SELECT count(*)::int AS n FROM pg_stat_activity
  WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> ALL ($1::int[])`, [except]))[0].n;
/** Le verrou d'attribution du compte est-il libre ? Essai dans une transaction aussitôt annulée. */
async function attributionFree(T) {
  const { ATTRIBUTION_KEY } = require('../src/modules/tpm/tpmAttribution.repository');
  const c = await connect();
  try {
    await c.query('BEGIN');
    const { rows: [r] } = await c.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok', [ATTRIBUTION_KEY(T)]);
    await c.query('ROLLBACK');
    return r.ok;
  } finally { await c.end(); }
}
/**
 * Duel orchestré : `first` démarre et se bloque sur le verrou que tient `hold` (pris après ses lignes) ;
 * `second` démarre et se met à attendre ; on relève si le verrou d'attribution est libre à ce moment,
 * puis on libère `hold`. Rend { a, b, attributionFreeWhileWaiting }.
 */
async function duel(T, { holdSql, holdParams = [], first, firstBlockedOn, second }) {
  const hold = await connect();
  try {
    await hold.query('BEGIN');
    await hold.query(holdSql, holdParams);
    const pa = settle(first());
    assert.ok(await waitFor(async () => (await q(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()
      AND wait_event_type = 'Lock' AND query ~ $1`, [firstBlockedOn]))[0].n > 0), `premier écrivain retenu (${firstBlockedOn})`);
    const pb = settle(second());
    const done = { b: false }; pb.then(() => { done.b = true; });
    // Le second se met à attendre (ou a déjà fini, s'il n'a rien à attendre).
    await waitFor(async () => done.b || (await waiting([hold.processID])) >= 2);
    const free = await attributionFree(T);
    await hold.query('COMMIT');
    const [a, b] = [await pa, await pb];
    return { a, b, attributionFreeWhileWaiting: free };
  } finally {
    await hold.query('ROLLBACK').catch(() => {});
    await hold.end();
  }
}
const why = (r) => (r.ok ? 'ok' : `${r.code || r.status} ${r.msg}`);

async function fixture() {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  const [{ id: U }] = await q("SELECT id FROM users WHERE tenant_id = $1 AND email = 'admin@mems.mg'", [T]);
  const { currentMonth } = require('../src/modules/tpm/rbmMath');
  const Y = Number(currentMonth().slice(0, 4)) + 1; // exercice à venir : mois toujours ouverts, sans grille d'activité
  return { T, U, Y };
}

test('#7 écrivain de sites (sites FOR UPDATE puis attribution) × coche du plan / nouvelle visite sur le même site : jamais d interblocage',
  { skip: SKIP, timeout: 120000 }, async () => {
    const { T, U, Y } = await fixture();
    const field = require('../src/modules/tpm/field.repository');
    const sites = await q(`SELECT s.id, s.programme_synergies AS syn FROM sites s WHERE s.tenant_id = $1 AND s.zone_district_id IS NOT NULL
                             AND NOT EXISTS (SELECT 1 FROM site_visits v WHERE v.site_id = s.id AND v.period_month >= $2::date) ORDER BY s.id LIMIT 2`, [T, `${Y}-01-01`]);
    assert.equal(sites.length, 2);
    try {
      for (const [i, second] of [
        [0, (S) => field.setPlannedMonths(T, U, { year: Y, changes: [{ siteId: S, month: 1, planned: true }] })],
        [1, (S) => field.createVisit(T, U, { siteId: S, periodMonth: `${Y}-02`, status: 'planifie' })],
      ]) {
        const S = sites[i].id;
        const r = await duel(T, {
          holdSql: 'LOCK TABLE location_match_queue IN SHARE MODE', // retient l'écrivain de sites APRÈS « sites FOR UPDATE »
          first: () => field.bulkUpdateSites(T, U, { year: Y, siteIds: [S], set: { synergies: 1 } }),
          firstBlockedOn: 'location_match_queue',
          second: () => second(S),
        });
        assert.equal(r.attributionFreeWhileWaiting, true, `visite ${i} : attend la ligne du site sans tenir le verrou d'attribution`);
        assert.equal(why(r.a), 'ok', 'écrivain de sites');
        assert.equal(why(r.b), 'ok', 'écrivain de visites');
      }
      assert.equal((await q('SELECT count(*)::int AS n FROM site_visits WHERE site_id = ANY($1::uuid[]) AND period_month >= $2::date',
        [sites.map((s) => s.id), `${Y}-01-01`]))[0].n, 2, 'les deux visites sont écrites');
    } finally {
      await q('DELETE FROM site_visits WHERE site_id = ANY($1::uuid[]) AND period_month >= $2::date', [sites.map((s) => s.id), `${Y}-01-01`]);
      for (const s of sites) await q('UPDATE sites SET programme_synergies = $2 WHERE id = $1', [s.id, s.syn]);
    }
  });

test('#8 Localités (aire FOR UPDATE puis attribution) × modification de TPM sur la même zone : jamais d interblocage',
  { skip: SKIP, timeout: 120000 }, async () => {
    const { T, U, Y } = await fixture();
    const loc = require('../src/modules/settings/localities.repository');
    const attr = require('../src/modules/tpm/tpmAttribution.service');
    const month = `${Y}-03`;
    const districts = await q('SELECT id, name FROM admin_areas WHERE tenant_id = $1 AND depth = 2 ORDER BY id', [T]);
    let pick = null;
    for (const d of districts) {
      const target = { areaIds: [d.id], regionIds: [], from: month, to: month };
      for (const p of await q("SELECT p.id FROM partners p JOIN partner_types t ON t.id = p.partner_type_id WHERE p.tenant_id = $1 AND t.code = 'tpm' AND p.active ORDER BY p.name", [T])) {
        const v = await attr.preview(T, { target, mode: 'modifier', providerId: p.id, reason: 'Essai de verrous concurrents' });
        if (!v.notSelectable.length && (v.counts.created || v.counts.updated)) { pick = { d, target, providerId: p.id, stamp: v.stamp }; break; }
      }
      if (pick) break;
    }
    assert.ok(pick, 'une zone et un TPM sélectionnable pour une modification');
    const { d, target, providerId, stamp } = pick;
    let batch = null;
    try {
      const r = await duel(T, {
        holdSql: 'LOCK TABLE location_match_queue IN SHARE MODE', // retient updateArea APRÈS « aire FOR UPDATE »
        first: () => loc.updateArea(T, d.id, { name: `${d.name} (essai)` }),
        firstBlockedOn: 'location_match_queue',
        second: () => attr.setOverrides(T, { userId: U }, { target, providerId, reason: 'Essai de verrous concurrents', stamp }),
      });
      if (r.b.ok) batch = r.b.v.batchId;
      assert.equal(r.attributionFreeWhileWaiting, true, 'la modification attend la ligne de la zone sans tenir le verrou d\'attribution');
      assert.equal(why(r.a), 'ok', 'Localités');
      assert.equal(why(r.b), 'ok', 'modification de TPM');
    } finally {
      await loc.updateArea(T, d.id, { name: d.name });
      await q('DELETE FROM tpm_zone_overrides WHERE tenant_id = $1 AND admin_area_id = $2 AND period_month = $3::date', [T, d.id, `${month}-01`]);
      if (batch) await q('DELETE FROM tpm_attribution_log WHERE tenant_id = $1 AND batch_id = $2', [T, batch]);
      const { withTenantTransaction } = require('../src/config/db');
      const { restampVisitsTx } = require('../src/modules/tpm/tpmAttribution.repository');
      await withTenantTransaction(T, (c) => restampVisitsTx(c, T, { months: [month], areaIds: [d.id] }));
    }
  });

test('#9 « Effacer les planifications » × ré-estampille (changement de rôle) : lignes prises dans le même ordre, jamais d interblocage',
  { skip: SKIP, timeout: 180000 }, async () => {
    const { T, U, Y } = await fixture();
    const field = require('../src/modules/tpm/field.repository');
    const planAuto = require('../src/modules/tpm/planAuto.service');
    const settings = require('../src/modules/settings/settings.repository');
    const [aina] = await q("SELECT id, name, active, partner_type_id AS type FROM partners WHERE tenant_id = $1 AND name = 'ASSOCIATION AINA'", [T]);
    const sites = await q('SELECT id FROM sites WHERE tenant_id = $1 ORDER BY id LIMIT 200', [T]);
    try {
      await field.setPlannedMonths(T, U, { year: Y, changes: sites.flatMap((s) => [{ siteId: s.id, month: 1, planned: true }, { siteId: s.id, month: 2, planned: true }]) });
      // La 3ᵉ connexion tient la 2ᵉ ligne dans l'ordre d'un parcours de l'index (mois, puis emplacement) :
      // un effacement dans cet ordre en tiendrait une, la ré-estampille (ordre des identifiants) en prendrait
      // d'autres avant de l'attendre — cycle. Dans l'ordre des identifiants, l'un attend l'autre, sans cycle.
      const [, second] = await q(`SELECT v.id FROM site_visits v WHERE v.tenant_id = $1 AND v.status = 'planifie' AND v.provider_source = 'zone'
                                AND v.visit_date IS NULL AND v.agent IS NULL AND v.period_month BETWEEN $2::date AND $3::date ORDER BY v.period_month, v.ctid LIMIT 2`,
      [T, `${Y}-01-01`, `${Y}-02-01`]);
      const r = await duel(T, {
        holdSql: 'SELECT 1 FROM site_visits WHERE id = $1 FOR KEY SHARE', holdParams: [second.id],
        first: () => planAuto.clearPlanned(T, { year: Y, from: 1, to: 2 }),
        firstBlockedOn: 'DELETE FROM site_visits',
        second: () => settings.updatePartner(T, aina.id, { name: aina.name, partnerTypeId: aina.type, active: !aina.active }, { actorId: U }),
      });
      assert.equal(why(r.a), 'ok', 'effacement');
      assert.equal(why(r.b), 'ok', 'changement de rôle (ré-estampille)');
      assert.ok(r.a.v.deleted >= 2 * sites.length - 5, `visites effacées : ${r.a.v.deleted}`);
    } finally {
      await settings.updatePartner(T, aina.id, { name: aina.name, partnerTypeId: aina.type, active: aina.active });
      await q('DELETE FROM site_visits WHERE tenant_id = $1 AND site_id = ANY($2::uuid[]) AND period_month BETWEEN $3::date AND $4::date',
        [T, sites.map((s) => s.id), `${Y}-01-01`, `${Y}-02-01`]);
    }
  });

test('#11 import de planning et import du registre × coche / nouvelle visite du même site × mois : verrou du mois d abord, 409 propre',
  { skip: SKIP, timeout: 120000 }, async () => {
    const { T, U, Y } = await fixture();
    const field = require('../src/modules/tpm/field.repository');
    const slug = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const codeOf = (s) => `${slug(s.district)}--${slug(s.commune)}--${slug(s.name)}`.slice(0, 120);
    // Sites dont le code est déjà la clé d'import (district, commune, nom) : l'import les retrouve.
    const cand = await q(`SELECT id, code, district, commune, fokontany, name, activity, location_id AS "locationId" FROM sites
                           WHERE tenant_id = $1 AND activity IS NOT NULL AND district IS NOT NULL AND commune IS NOT NULL ORDER BY id`, [T]);
    const free = [];
    for (const s of cand) {
      if (free.length === 2) break;
      const code = codeOf(s);
      if (s.code === code || !(await q('SELECT 1 FROM sites WHERE tenant_id = $1 AND code = $2', [T, code])).length) free.push({ ...s, newCode: code });
    }
    assert.equal(free.length, 2);
    const touched = free.map((s) => s.id);
    try {
      for (const s of free) await q('UPDATE sites SET code = $2 WHERE id = $1', [s.id, s.newCode]);
      // 1. Import de planning (mois M) pendant la création d'une visite du même site × M.
      const [S1, S2] = free;
      const m1 = `${Y}-04`;
      const r1 = await duel(T, {
        holdSql: 'LOCK TABLE location_match_queue IN SHARE MODE', // retient l'import APRÈS sa visite écrite
        first: () => field.importPlanning(T, U, m1, [{ district: S1.district, commune: S1.commune, fokontany: S1.fokontany, name: S1.name, activity: S1.activity }]),
        firstBlockedOn: 'location_match_queue',
        second: () => field.createVisit(T, U, { siteId: S1.id, periodMonth: m1, activity: S1.activity, status: 'planifie' }),
      });
      assert.equal(r1.attributionFreeWhileWaiting, true, 'la création attend le mois sans tenir le verrou d\'attribution');
      assert.equal(why(r1.a), 'ok', 'import de planning');
      assert.equal(r1.a.v.visitsCreated, 1);
      assert.equal(r1.b.status, 409, `création : ${why(r1.b)}`);
      // 2. Import du registre (mois prévu) pendant une coche du même site × mois.
      const r2 = await duel(T, {
        holdSql: 'LOCK TABLE location_match_queue IN SHARE MODE',
        first: () => field.importLocations(T, U, { year: Y, rows: [{ locationId: S2.locationId || undefined, name: S2.name, admin2: S2.district, admin3: S2.commune, activity: S2.activity,
          planned: [5], security: 0, synergies: 0, newPartner: 0, experiencedPartner: 0, issuesProcess: 0, issuesPartnerReport: 0, issuesCFM: 0, fraud: 0 }] }, { commit: true }),
        firstBlockedOn: 'location_match_queue',
        second: () => field.setPlannedMonths(T, U, { year: Y, changes: [{ siteId: S2.id, month: 5, planned: true }] }),
      });
      assert.equal(r2.attributionFreeWhileWaiting, true, 'la coche attend le mois sans tenir le verrou d\'attribution');
      assert.equal(why(r2.a), 'ok', 'import du registre');
      assert.equal(why(r2.b), 'ok', 'coche');
      assert.equal(r2.b.v.added, 0, 'la visite existe déjà : rien d\'ajouté');
    } finally {
      await q('DELETE FROM site_visits WHERE site_id = ANY($1::uuid[]) AND period_month >= $2::date', [touched, `${Y}-01-01`]);
      for (const s of free) await q('UPDATE sites SET code = $2 WHERE id = $1', [s.id, s.code]);
    }
  });
